// Admin-triggered: sends a real PayMongo refund, either for a completed
// booking's security deposit, or (added later, see 063 migration) for a
// cancelled booking's owed refund — auto-detected from the booking's status
// so the frontend doesn't need to say which case it is.
//
// The deposit was never its own PayMongo payment — create-checkout bundles
// it into the downpayment charge (amount = downpayment + deposit). Refunding
// "just the deposit" means a partial refund of that original payment via
// PayMongo's Refunds API (POST /v1/refunds), which supports amount < the
// full paid amount. Refunds are asynchronous (pending -> processing ->
// succeeded/failed), so this only kicks the refund off; paymongo-webhook's
// `refund.updated` handling confirms the terminal result.
//
// Cancellation refunds work the same way, refunded against the original
// downpayment charge — but a cancellation refund can exceed that single
// charge's amount if the booking was already fully_paid before it was
// cancelled (balance was its own separate PayMongo charge). Splitting a
// refund across two original charges automatically is real added
// complexity for an edge case; this deliberately stays scoped to the common
// case (cancelled before the balance was ever paid) and returns a clear
// error otherwise, telling admin to use the manual "mark sent" fallback
// instead — same "automate the common case, keep a manual escape hatch"
// pattern this codebase already uses for deposits/payouts.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

const PAYMONGO_SECRET_KEY = Deno.env.get('PAYMONGO_SECRET_KEY')!;

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

  // Scoped to the caller's own JWT (not service role) so is_admin() inside
  // mark_deposit_refund_processing() reflects the real calling admin —
  // same pattern as create-checkout.
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
    .select('id, status, deposit_amount, deposit_paid, deposit_refunded')
    .eq('id', bookingId)
    .single();
  if (bookingError || !booking) {
    return new Response(JSON.stringify({ error: 'Booking not found' }), { status: 404, headers: corsHeaders });
  }

  const { data: downpaymentPayment, error: downpaymentError } = await supabase
    .from('payments')
    .select('paymongo_reference, amount')
    .eq('booking_id', bookingId)
    .eq('payment_type', 'downpayment')
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (downpaymentError || !downpaymentPayment?.paymongo_reference) {
    return new Response(
      JSON.stringify({ error: 'Could not find the original PayMongo payment for this booking' }),
      { status: 500, headers: corsHeaders }
    );
  }

  let refundAmount: number;
  let notes: string;
  let rpcName: 'mark_deposit_refund_processing' | 'mark_cancellation_refund_processing';

  if (booking.status === 'completed') {
    if (!booking.deposit_paid || booking.deposit_refunded) {
      return new Response(JSON.stringify({ error: 'No deposit refund pending for this booking' }), { status: 409, headers: corsHeaders });
    }
    refundAmount = booking.deposit_amount;
    notes = `SafeDrive security deposit refund for booking ${bookingId}`;
    rpcName = 'mark_deposit_refund_processing';
  } else if (booking.status === 'cancelled_by_renter' || booking.status === 'cancelled_by_owner') {
    const { data: pendingRefund, error: pendingRefundError } = await supabase
      .from('payments')
      .select('amount')
      .eq('booking_id', bookingId)
      .eq('payment_type', 'refund')
      .eq('status', 'pending')
      .is('paymongo_reference', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pendingRefundError || !pendingRefund) {
      return new Response(JSON.stringify({ error: 'No cancellation refund pending for this booking' }), { status: 409, headers: corsHeaders });
    }
    if (pendingRefund.amount > downpaymentPayment.amount) {
      return new Response(
        JSON.stringify({
          error:
            'This refund exceeds what can be refunded automatically from the original downpayment charge ' +
            '(the booking was fully paid before it was cancelled). Send the money manually, then use "Mark Sent Manually".',
        }),
        { status: 409, headers: corsHeaders }
      );
    }
    refundAmount = pendingRefund.amount;
    notes = `SafeDrive cancellation refund for booking ${bookingId}`;
    rpcName = 'mark_cancellation_refund_processing';
  } else {
    return new Response(JSON.stringify({ error: 'No refund pending for this booking' }), { status: 409, headers: corsHeaders });
  }

  const refundRes = await fetch('https://api.paymongo.com/v1/refunds', {
    method: 'POST',
    headers: { Authorization: paymongoAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        attributes: {
          amount: toCentavos(refundAmount),
          payment_id: downpaymentPayment.paymongo_reference,
          reason: 'others',
          notes,
        },
      },
    }),
  });

  if (!refundRes.ok) {
    const errBody = await refundRes.text();
    return new Response(JSON.stringify({ error: 'PayMongo refund request failed', details: errBody }), {
      status: 502,
      headers: corsHeaders,
    });
  }

  const refund = await refundRes.json();
  const refundId = refund.data.id;

  const { error: recordError } = await supabase.rpc(rpcName, { p_booking_id: bookingId, p_refund_reference: refundId });
  if (recordError) {
    return new Response(JSON.stringify({ error: recordError.message }), { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ refund_id: refundId, status: refund.data.attributes.status }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
