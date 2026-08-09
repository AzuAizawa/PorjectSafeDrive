// Rescues a user who is locked out because they lost their TOTP authenticator
// and never generated backup codes (generate_mfa_recovery_codes() requires
// already being at aal2 -- "prepare before you lose access, not after", so a
// user who never did that has zero self-service path back in, and until this
// function existed neither did any admin -- confirmed by grepping the whole
// admin/** and functions/** trees for any mfa/factor management, real gap).
//
// Deletes the TARGET user's TOTP factor(s) via the Admin API -- same calls
// verify-recovery-code/index.ts already makes for the CALLER's own account,
// just parameterized on an admin-supplied target instead. Because email OTP
// (065_email_otp.sql) is now the always-available baseline for every
// account, this doesn't strand the user -- they simply fall back to
// email-code login immediately, same as anyone who never upgraded to TOTP.
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

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: corsHeaders });
  }

  // Same "authorize on the caller's own aal1/aal2 JWT via an RPC, then
  // switch to service_role for the privileged call" pattern create-staff-
  // account/index.ts already uses. Restricted to full admin/super_admin
  // (not support), matching the rest of Account Standing (suspend/ban/clear
  // strikes are all isFullAdmin-gated in admin/users.tsx) since resetting
  // someone's 2FA is at least as sensitive.
  const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
    userClient.rpc('is_admin'),
    userClient.rpc('is_super_admin'),
  ]);
  if (!isAdmin && !isSuperAdmin) {
    return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403, headers: corsHeaders });
  }

  const body = await req.json().catch(() => null);
  const targetUserId = typeof body?.target_user_id === 'string' ? body.target_user_id : '';
  if (!targetUserId) {
    return new Response(JSON.stringify({ error: 'target_user_id is required' }), { status: 400, headers: corsHeaders });
  }

  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: factorsData, error: listError } = await adminClient.auth.admin.mfa.listFactors({ userId: targetUserId });
  if (listError) {
    return new Response(JSON.stringify({ error: listError.message }), { status: 500, headers: corsHeaders });
  }

  for (const factor of factorsData.factors) {
    await adminClient.auth.admin.mfa.deleteFactor({ id: factor.id, userId: targetUserId });
  }

  const { error: auditError } = await adminClient.rpc('log_audit', {
    p_actor: userData.user.id,
    p_action: 'admin_mfa_reset',
    p_entity_type: 'user',
    p_entity_id: targetUserId,
    p_details: {},
  });
  if (auditError) console.warn('log_audit failed:', auditError.message);

  return new Response(JSON.stringify({ reset: true, factors_removed: factorsData.factors.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
