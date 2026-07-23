-- SafeDrive 2.0 -- audited role promotion, prompted by an OWASP/RBAC review
-- session (2026-07-23). Two real gaps found while tracing how someone
-- actually becomes an admin/support account:
--
-- 1. Every role change happened via raw SQL/Table Editor, completely
--    invisible to audit_trail -- "who made someone an admin and when" was
--    the one significant action in this system with zero logging, out of
--    step with how carefully everything else here is audited.
--
-- 2. protect_profile_fields() (026) only skips reverting `role` when
--    is_admin() is already true for the calling session. Before any admin
--    exists, auth.uid() has nothing to match against, is_admin() is false,
--    and the trigger would silently revert a bootstrap self-promotion
--    attempt back to 'user' -- including one attempted via the Supabase
--    dashboard's SQL editor, since triggers fire regardless of which role
--    is executing the statement. The README's documented bootstrap
--    procedure ("promote via Table Editor") was never re-verified against
--    this trigger once it shipped.
--
-- promote_user_role() fixes both: real audit_trail entry + notification,
-- and a self-closing bootstrap exception (only allowed while zero admins
-- exist, and only as self-promotion to admin -- not usable to hand admin to
-- a different account before the system has its first one). The moment one
-- admin exists, that exception permanently closes and normal is_admin()-only
-- rules apply, same as every other admin-only RPC in this codebase.

create or replace function promote_user_role(p_profile_id uuid, p_new_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_admin_exists boolean;
  v_old_role text;
begin
  if p_new_role not in ('user', 'support', 'admin') then
    raise exception 'invalid role';
  end if;

  select exists(select 1 from profiles where role = 'admin') into v_admin_exists;

  if v_admin_exists then
    if not is_admin() then raise exception 'not authorized'; end if;
  elsif auth.uid() <> p_profile_id or p_new_role <> 'admin' then
    -- Bootstrap window: no admin exists yet. Only self-promotion to admin
    -- is allowed here -- can't be used to hand admin to someone else, and
    -- can't be used to grant 'support' before an admin exists to have
    -- assigned it.
    raise exception 'not authorized';
  end if;

  select role into v_old_role from profiles where id = p_profile_id;
  if v_old_role = p_new_role then return; end if;

  perform set_config('app.bypass_profile_protection', 'true', true);
  update profiles set role = p_new_role where id = p_profile_id;

  perform log_audit(auth.uid(), 'role_changed', 'user', p_profile_id,
                     jsonb_build_object('old_role', v_old_role, 'new_role', p_new_role));
  perform notify_user(p_profile_id, 'role_changed', 'Your account role was changed to ' || p_new_role || '.', '/profile', true);
end;
$$;

revoke execute on function promote_user_role(uuid, text) from public, anon;
grant execute on function promote_user_role(uuid, text) to authenticated;
