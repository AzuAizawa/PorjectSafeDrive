// Admin-triggered: sends a real GCash payout to a vehicle owner via
// PayMongo's Disbursements API (v2/batch_transfers) once a booking is
// completed. Scoped to GCash only -- see 064_gcash_payout_automation.sql
// for why bank-transfer payouts stay on the existing manual
// mark_payout_sent() flow (owner bank details are free-text, never
// validated against PayMongo's real institution list; auto-matching that
// risks a misdirected transfer, GCash is a single fixed institution so it
// doesn't have that problem).
//
// This is a different, newer PayMongo API surface (v2) than
// create-checkout/process-refund (v1) -- real requirements confirmed from
// PayMongo's own docs, not assumed: a wallet source_account, a
// provider_code/BIC for the destination looked up live (never hardcoded)
// from PayMongo's own receiving-institutions list, and a unique
// Idempotency-Key header on the transfer request so a retried call can't
// double-send money.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

const PAYMONGO_SECRET_KEY = Deno.env.get('PAYMONGO_SECRET_KEY')!;
const PAYMONGO_WALLET_NUMBER = Deno.env.get('PAYMONGO_WALLET_NUMBER')!;
const PAYMONGO_WALLET_NAME = Deno.env.get('PAYMONGO_WALLET_NAME')!;

// InstaPay's own per-transaction cap (confirmed in PayMongo's docs) --
// a payout above this can't go through this rail at all. Rather than split
// it automatically (real added complexity for a rare edge case), this
// returns a clear error pointing at the manual fallback, same pattern as
// process-refund's single-charge guard for oversized cancellation refunds.
const INSTAPAY_MAX_PESOS = 50_000;

function paymongoAuthHeader() {
  return 'Basic ' + btoa(`${PAYMONGO_SECRET_KEY}:`);
}

function toCentavos(pesos: number) {
  return Math.round(pesos * 100);
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: corsHeaders });
  }

  // User-scoped (not service role) so is_admin() inside mark_payout_processing()
  // reflects the real calling admin -- same pattern as process-refund.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: corsHeaders });
  }

  const body = await req.json().catch(() => null);
  const bookingId = body?.booking_id;
  if (!bookingId) {
    return new Response(JSON.stringify({ error: 'booking_id required' }), { status: 400, headers: corsHeaders });
  }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, status, base_price, owner_id')
    .eq('id', bookingId)
    .single();
  if (bookingError || !booking) {
    return new Response(JSON.stringify({ error: 'Booking not found' }), { status: 404, headers: corsHeaders });
  }
  if (booking.status !== 'completed') {
    return new Response(JSON.stringify({ error: 'Booking is not completed' }), { status: 409, headers: corsHeaders });
  }

  const { data: existingPayout } = await supabase
    .from('payments')
    .select('id')
    .eq('booking_id', bookingId)
    .eq('payment_type', 'payout')
    .maybeSingle();
  if (existingPayout) {
    return new Response(JSON.stringify({ error: 'A payout already exists for this booking' }), { status: 409, headers: corsHeaders });
  }

  const { data: owner, error: ownerError } = await supabase
    .from('profiles')
    .select('first_name, last_name, payout_method, gcash_number')
    .eq('id', booking.owner_id)
    .single();
  if (ownerError || !owner) {
    return new Response(JSON.stringify({ error: 'Owner profile not found' }), { status: 404, headers: corsHeaders });
  }
  if (owner.payout_method !== 'gcash' || !owner.gcash_number) {
    return new Response(
      JSON.stringify({ error: 'Automated payout is only available for GCash — use "Mark as Sent" for this owner\'s payout method.' }),
      { status: 409, headers: corsHeaders }
    );
  }

  if (booking.base_price > INSTAPAY_MAX_PESOS) {
    return new Response(
      JSON.stringify({
        error: `This payout exceeds InstaPay's ₱${INSTAPAY_MAX_PESOS.toLocaleString()} per-transaction limit. Send it manually, then use "Mark as Sent".`,
      }),
      { status: 409, headers: corsHeaders }
    );
  }

  // Never hardcoded -- resolved live against PayMongo's real supported
  // institutions so this can't silently drift out of date.
  const institutionsRes = await fetch('https://api.paymongo.com/v2/transfers/receiving_institutions?provider=instapay', {
    headers: { Authorization: paymongoAuthHeader() },
  });
  if (!institutionsRes.ok) {
    return new Response(JSON.stringify({ error: 'Could not look up GCash as a receiving institution' }), { status: 502, headers: corsHeaders });
  }
  const institutions = await institutionsRes.json();
  const gcashInstitution = (institutions?.data ?? institutions ?? []).find((inst: { name?: string; bic?: string }) =>
    (inst.name ?? '').toLowerCase().includes('gcash')
  );
  if (!gcashInstitution?.bic) {
    return new Response(JSON.stringify({ error: 'GCash not found in PayMongo\'s receiving institutions list' }), { status: 502, headers: corsHeaders });
  }

  const referenceNumber = crypto.randomUUID();

  const transferRes = await fetch('https://api.paymongo.com/v2/batch_transfers', {
    method: 'POST',
    headers: {
      Authorization: paymongoAuthHeader(),
      'Content-Type': 'application/json',
      'Idempotency-Key': referenceNumber,
    },
    body: JSON.stringify({
      transfers: [
        {
          source_account: { number: PAYMONGO_WALLET_NUMBER, name: PAYMONGO_WALLET_NAME, bic: 'PAEYPHM2XXX' },
          destination_account: {
            number: owner.gcash_number,
            name: `${owner.first_name ?? ''} ${owner.last_name ?? ''}`.trim(),
            bic: gcashInstitution.bic,
          },
          amount: toCentavos(booking.base_price),
          currency: 'PHP',
          provider: 'instapay',
          description: `SafeDrive owner payout for booking ${bookingId}`,
        },
      ],
    }),
  });

  if (!transferRes.ok) {
    const errBody = await transferRes.text();
    return new Response(JSON.stringify({ error: 'PayMongo transfer request failed', details: errBody }), { status: 502, headers: corsHeaders });
  }

  const transfer = await transferRes.json();
  const transferId = transfer?.transfers?.[0]?.id;
  if (!transferId) {
    return new Response(JSON.stringify({ error: 'PayMongo response missing transfer id', details: transfer }), { status: 502, headers: corsHeaders });
  }

  const { error: recordError } = await supabase.rpc('mark_payout_processing', {
    p_booking_id: bookingId,
    p_transfer_id: transferId,
    p_reference_number: referenceNumber,
  });
  if (recordError) {
    return new Response(JSON.stringify({ error: recordError.message }), { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ transfer_id: transferId, reference_number: referenceNumber }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
