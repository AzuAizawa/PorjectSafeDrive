// Called internally by request_email_otp() via pg_net (065_email_otp.sql),
// exactly the same way notify_user() calls send-email — server-to-server
// with the service_role JWT the Supabase gateway itself verifies, so no CORS
// handling or extra secret check is needed here, same as send-email/index.ts.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { renderEmailHtml } from '../_shared/email-template.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.json().catch(() => null);
  const { profile_id, code } = body ?? {};
  if (!profile_id || !code) {
    return new Response(JSON.stringify({ error: 'profile_id and code required' }), { status: 400 });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', profile_id)
    .single();

  if (profileError || !profile?.email) {
    return new Response(JSON.stringify({ error: 'Could not find an email address for this user' }), { status: 404 });
  }

  const message = `Your SafeDrive login code is <strong style="font-size: 20px; letter-spacing: 2px;">${code}</strong>. It expires shortly — if you didn't request this, you can ignore this email.`;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'SafeDrive <onboarding@resend.dev>',
      to: [profile.email],
      subject: 'Your SafeDrive login code',
      html: renderEmailHtml(message),
    }),
  });

  if (!resendRes.ok) {
    const errBody = await resendRes.text();
    return new Response(JSON.stringify({ error: 'Resend send failed', details: errBody }), { status: 502 });
  }

  return new Response(JSON.stringify({ sent: true }), { headers: { 'Content-Type': 'application/json' } });
});
