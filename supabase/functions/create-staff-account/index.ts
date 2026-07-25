// Correct staff account provisioning: a super_admin provides an email, this
// function creates a BRAND NEW dedicated account (never repurposes an
// existing renter/customer account — see 054_staff_account_provisioning.sql
// for why that separation matters) via Supabase's invite-by-email flow, so
// the new hire sets their own password rather than one existing anywhere in
// transit. Starts at 'support', the lowest-privilege tier.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

const SITE_URL = Deno.env.get('SITE_URL') ?? 'http://localhost:5173';

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

  // is_super_admin() already requires both role = 'super_admin' AND aal2 —
  // the exact same server-side check every other super-admin-only RPC uses,
  // so this can't be bypassed by calling the function directly.
  const { data: isSuperAdmin, error: checkError } = await userClient.rpc('is_super_admin');
  if (checkError || !isSuperAdmin) {
    return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403, headers: corsHeaders });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'A valid email is required' }), { status: 400, headers: corsHeaders });
  }

  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${SITE_URL}/reset-password`,
  });
  if (inviteError) {
    return new Response(JSON.stringify({ error: inviteError.message }), { status: 400, headers: corsHeaders });
  }

  // handle_new_user() (003_functions.sql) already created the profiles row
  // with role='user' as a side effect of the auth.users insert above.
  const { error: roleError } = await adminClient.rpc('set_new_staff_role', {
    p_profile_id: invited.user.id,
    p_created_by: userData.user.id,
  });
  if (roleError) {
    return new Response(JSON.stringify({ error: roleError.message }), { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ id: invited.user.id, email }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
