// Receives PayMongo webhook events, verifies the signature (required —
// without this, anyone who finds this URL could POST a fake "paid" event
// and get a free booking — see decisions doc §17), then confirms the
// matching booking/subscription payment via the SECURITY DEFINER RPCs.
//
// Signature scheme verified against PayMongo's official Node SDK source
// (github.com/paymongo/paymongo-node, src/services/Webhook.js):
//   header "Paymongo-Signature": "t=<unix_ts>,te=<test_sig>,li=<live_sig>"
//   signed string: `${timestamp}.${rawBody}`
//   algorithm: HMAC-SHA256, hex digest, compared against whichever of te/li
//   is non-empty (te in test mode, li in live mode).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const WEBHOOK_SECRET = Deno.env.get('PAYMONGO_WEBHOOK_SECRET')!;

async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k, v];
    })
  );
  const timestamp = parts.t;
  const comparisonSignature = parts.te || parts.li;
  if (!timestamp || !comparisonSignature) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const computedHex = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison to avoid timing attacks on the signature check.
  if (computedHex.length !== comparisonSignature.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) diff |= computedHex.charCodeAt(i) ^ comparisonSignature.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();
  const isValid = await verifySignature(rawBody, req.headers.get('Paymongo-Signature'));
  if (!isValid) {
    return new Response(JSON.stringify({ error: 'Invalid webhook signature' }), { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const eventAttributes = payload.data?.attributes;
  const eventType: string = eventAttributes?.type;
  const resource = eventAttributes?.data; // the checkout_session (or other) resource this event is about

  // Service-role client — bypasses RLS, required since this runs with no user session.
  // Every write this function triggers still only happens through the same
  // SECURITY DEFINER RPCs the rest of the app uses, so business-rule
  // validation (correct booking status, etc.) is enforced in one place.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (eventType === 'checkout_session.payment.paid') {
    const metadata = resource?.attributes?.metadata ?? {};
    const paymentReference =
      resource?.attributes?.payments?.[0]?.data?.id ?? resource?.attributes?.payment_intent?.data?.id ?? resource?.id;

    if (metadata.payment_type === 'downpayment' && metadata.booking_id) {
      const { error } = await supabase.rpc('confirm_downpayment_paid', {
        p_booking_id: metadata.booking_id,
        p_paymongo_ref: paymentReference,
      });
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    } else if (metadata.payment_type === 'balance' && metadata.booking_id) {
      const { error } = await supabase.rpc('confirm_balance_paid', {
        p_booking_id: metadata.booking_id,
        p_paymongo_ref: paymentReference,
      });
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    } else if (metadata.payment_type === 'subscription' && metadata.user_id) {
      const { error } = await supabase.rpc('confirm_subscription_payment', {
        p_profile_id: metadata.user_id,
        p_paymongo_ref: paymentReference,
      });
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
  }

  // Always 200 on anything else (unhandled event types) so PayMongo doesn't retry forever.
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});
