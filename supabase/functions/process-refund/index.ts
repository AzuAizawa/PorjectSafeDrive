// Admin-triggered: sends a real PayMongo partial refund for a completed
// booking's security deposit, replacing the old "click a button, admin
// wires the money manually" flow.
//
// The deposit was never its own PayMongo payment — create-checkout bundles
// it into the downpayment charge (amount = downpayment + deposit). Refunding
// "just the deposit" means a partial refund of that original payment via
// PayMongo's Refunds API (POST /v1/refunds), which supports amount < the
// full paid amount. Refunds are asynchronous (pending -> processing ->
// succeeded/failed), so this only kicks the refund off; paymongo-webhook's
// `refund.updated` handling confirms the terminal result.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const PAYMONGO_SECRET_KEY = Deno.env.get('PAYMONGO_SECRET_KEY')!;

function paymongoAuthHeader() {
  return 'Basic ' + btoa(`${PAYMONGO_SECRET_KEY}:`);
}

function toCentavos(pesos: number) {
  return Math.round(pesos * 100);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });

  // Scoped to the caller's own JWT (not service role) so is_admin() inside
  // mark_deposit_refund_processing() reflects the real calling admin —
  // same pattern as create-checkout.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const bookingId = body?.booking_id;
  if (!bookingId) return new Response(JSON.stringify({ error: 'booking_id required' }), { status: 400 });

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, status, deposit_amount, deposit_paid, deposit_refunded')
    .eq('id', bookingId)
    .single();
  if (bookingError || !booking) return new Response(JSON.stringify({ error: 'Booking not found' }), { status: 404 });
  if (booking.status !== 'completed' || !booking.deposit_paid || booking.deposit_refunded) {
    return new Response(JSON.stringify({ error: 'No deposit refund pending for this booking' }), { status: 409 });
  }

  const { data: originalPaymentRef, error: refError } = await supabase.rpc('get_downpayment_paymongo_reference', {
    p_booking_id: bookingId,
  });
  if (refError || !originalPaymentRef) {
    return new Response(
      JSON.stringify({ error: 'Could not find the original PayMongo payment for this booking' }),
      { status: 500 }
    );
  }

  const refundRes = await fetch('https://api.paymongo.com/v1/refunds', {
    method: 'POST',
    headers: { Authorization: paymongoAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        attributes: {
          amount: toCentavos(booking.deposit_amount),
          payment_id: originalPaymentRef,
          reason: 'others',
          notes: `SafeDrive security deposit refund for booking ${bookingId}`,
        },
      },
    }),
  });

  if (!refundRes.ok) {
    const errBody = await refundRes.text();
    return new Response(JSON.stringify({ error: 'PayMongo refund request failed', details: errBody }), { status: 502 });
  }

  const refund = await refundRes.json();
  const refundId = refund.data.id;

  const { error: recordError } = await supabase.rpc('mark_deposit_refund_processing', {
    p_booking_id: bookingId,
    p_refund_reference: refundId,
  });
  if (recordError) {
    return new Response(JSON.stringify({ error: recordError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ refund_id: refundId, status: refund.data.attributes.status }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
