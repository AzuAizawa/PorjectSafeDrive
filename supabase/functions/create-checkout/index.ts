// Creates a PayMongo Checkout Session for a booking's downpayment/balance,
// or for a lister's extra-slots subscription, and returns the hosted
// checkout_url for the browser to redirect to.
//
// Deliberately uses PayMongo's Checkout Sessions API (a fully hosted page)
// rather than client-side Elements — the frontend never touches card data
// or even the PayMongo public key, which keeps PCI scope minimal.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const PAYMONGO_SECRET_KEY = Deno.env.get('PAYMONGO_SECRET_KEY')!;
const SITE_URL = Deno.env.get('SITE_URL') ?? 'http://localhost:5173';

function paymongoAuthHeader() {
  return 'Basic ' + btoa(`${PAYMONGO_SECRET_KEY}:`);
}

// PayMongo amounts are integer centavos.
function toCentavos(pesos: number) {
  return Math.round(pesos * 100);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }
  const userId = userData.user.id;

  const body = await req.json().catch(() => null);
  const { booking_id, payment_type } = body ?? {};

  if (!['downpayment', 'balance', 'subscription'].includes(payment_type)) {
    return new Response(JSON.stringify({ error: 'Invalid payment_type' }), { status: 400 });
  }

  let amountPesos: number;
  let description: string;
  const metadata: Record<string, string> = { payment_type, user_id: userId };

  if (payment_type === 'subscription') {
    const { data: setting } = await supabase.from('platform_settings').select('value').eq('key', 'subscription_price').single();
    amountPesos = Number(setting?.value ?? 0);
    description = 'SafeDrive extra vehicle slots subscription';
  } else {
    if (!booking_id) return new Response(JSON.stringify({ error: 'booking_id required' }), { status: 400 });

    // RLS on `bookings` only allows the renter/owner to read their own rows,
    // so this also doubles as the authorization check — a stranger's booking_id
    // simply won't return a row for this user's session.
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, renter_id, status, downpayment_amount, balance_amount, deposit_amount')
      .eq('id', booking_id)
      .single();

    if (bookingError || !booking) return new Response(JSON.stringify({ error: 'Booking not found' }), { status: 404 });
    if (booking.renter_id !== userId) return new Response(JSON.stringify({ error: 'Not your booking' }), { status: 403 });

    if (payment_type === 'downpayment') {
      if (booking.status !== 'pending_payment') {
        return new Response(JSON.stringify({ error: 'Booking is not awaiting downpayment' }), { status: 409 });
      }
      amountPesos = booking.downpayment_amount + (booking.deposit_amount ?? 0);
      description = `Downpayment for booking ${booking.id}`;
    } else {
      if (booking.status !== 'downpayment_paid') {
        return new Response(JSON.stringify({ error: 'Booking is not awaiting balance' }), { status: 409 });
      }
      amountPesos = booking.balance_amount;
      description = `Balance payment for booking ${booking.id}`;
    }
    metadata.booking_id = booking.id;
  }

  const checkoutRes = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
    method: 'POST',
    headers: { Authorization: paymongoAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        attributes: {
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          description,
          line_items: [{ amount: toCentavos(amountPesos), currency: 'PHP', name: description, quantity: 1 }],
          payment_method_types: ['gcash', 'card', 'paymaya'],
          success_url: `${SITE_URL}/bookings?payment=success`,
          cancel_url: `${SITE_URL}/bookings?payment=cancelled`,
          metadata,
        },
      },
    }),
  });

  if (!checkoutRes.ok) {
    const errBody = await checkoutRes.text();
    return new Response(JSON.stringify({ error: 'PayMongo checkout creation failed', details: errBody }), { status: 502 });
  }

  const checkout = await checkoutRes.json();
  const checkoutUrl = checkout.data.attributes.checkout_url;

  return new Response(JSON.stringify({ checkout_url: checkoutUrl }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
