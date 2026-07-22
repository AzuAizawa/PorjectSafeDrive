// Called internally by notify_user() via pg_net whenever p_send_email is
// true (003_functions.sql / 030_fix_notify_user_hard_failure.sql) — never
// invoked from a browser, so no CORS handling needed, same as
// paymongo-webhook. Authenticated by the service_role JWT notify_user()
// already passes as the Authorization header (Supabase's own gateway
// verifies it before this code even runs), not a separate secret.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

// Friendlier subject lines for the notification types that actually get
// emailed (see the p_send_email=true call sites) — falls back to a plain
// generic subject for anything not listed here rather than failing.
const SUBJECTS: Record<string, string> = {
  booking_request: 'New booking request',
  booking_accepted: 'Your booking was accepted',
  booking_rejected: 'Your booking was declined',
  booking_cancelled: 'Booking cancelled',
  booking_completed: 'Your rental is complete',
  downpayment_received: 'Downpayment received',
  balance_received: 'Balance payment received',
  subscription_active: 'Subscription active',
  subscription_expired: 'Subscription expired',
  verification_approved: 'You’re verified!',
  verification_rejected: 'Verification needs another look',
  vehicle_approved: 'Your vehicle listing is live',
  vehicle_rejected: 'Your vehicle listing needs changes',
  deposit_refunded: 'Deposit refund processed',
  deposit_refund_failed: 'Deposit refund issue',
};

function renderHtml(message: string) {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 16px; margin-bottom: 20px;">
        <span style="display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 6px; background: #0e7c6b; color: white; font-size: 11px;">SD</span>
        SafeDrive
      </div>
      <p style="font-size: 14px; line-height: 1.6; color: #14191a;">${message}</p>
      <p style="font-size: 12px; color: #82938f; margin-top: 24px;">
        This is an automated notification from SafeDrive, a school capstone project.
      </p>
    </div>
  `;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.json().catch(() => null);
  const { user_id, type, message } = body ?? {};
  if (!user_id || !message) {
    return new Response(JSON.stringify({ error: 'user_id and message required' }), { status: 400 });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', user_id)
    .single();

  if (profileError || !profile?.email) {
    return new Response(JSON.stringify({ error: 'Could not find an email address for this user' }), { status: 404 });
  }

  const subject = SUBJECTS[type] ?? 'SafeDrive notification';

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'SafeDrive <onboarding@resend.dev>',
      to: [profile.email],
      subject,
      html: renderHtml(message),
    }),
  });

  if (!resendRes.ok) {
    const errBody = await resendRes.text();
    return new Response(JSON.stringify({ error: 'Resend send failed', details: errBody }), { status: 502 });
  }

  return new Response(JSON.stringify({ sent: true }), { headers: { 'Content-Type': 'application/json' } });
});
