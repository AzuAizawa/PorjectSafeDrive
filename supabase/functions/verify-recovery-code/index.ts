// "My authenticator is down" recovery path. A recovery code can't complete
// Supabase's own aal2 challenge (only GoTrue itself can mint that JWT
// claim), so instead: verify the code against this user's own hashes, and
// if valid, use the Admin API (service_role) to delete their lost TOTP
// factor entirely. They land back on the same enrollment screen a brand
// new staff account sees and set up a fresh authenticator from there — see
// 058_mfa_recovery_codes.sql for the full reasoning.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: corsHeaders });
  }

  // Identifies the caller from their OWN aal1 JWT (password already
  // verified, stuck at the MFA challenge) — never take a profile id from
  // the request body, or an aal1 user could grind codes against anyone.
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: corsHeaders });
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return new Response(JSON.stringify({ error: 'A recovery code is required' }), { status: 400, headers: corsHeaders });
  }

  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: valid, error: verifyError } = await adminClient.rpc('verify_and_consume_recovery_code', {
    p_profile_id: userData.user.id,
    p_code: code,
  });
  if (verifyError) {
    return new Response(JSON.stringify({ error: verifyError.message }), { status: 500, headers: corsHeaders });
  }
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Invalid or already-used recovery code' }), { status: 400, headers: corsHeaders });
  }

  const { data: factorsData, error: listError } = await adminClient.auth.admin.mfa.listFactors({ userId: userData.user.id });
  if (listError) {
    return new Response(JSON.stringify({ error: listError.message }), { status: 500, headers: corsHeaders });
  }

  for (const factor of factorsData.factors) {
    await adminClient.auth.admin.mfa.deleteFactor({ id: factor.id, userId: userData.user.id });
  }

  return new Response(JSON.stringify({ reset: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
