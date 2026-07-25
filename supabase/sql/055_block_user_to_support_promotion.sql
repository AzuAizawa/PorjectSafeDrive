-- SafeDrive 2.0 -- close the server-side half of the staff-provisioning
-- gap (054 only fixed the frontend/UI half).
--
-- promote_user_role()'s "Demote (immediate, no approval needed)" path was
-- never actually restricted to demotions -- a super_admin could call
-- promote_user_role(any_user_id, 'support') directly, single-handedly, no
-- approval, on any existing renter/customer account. Hiding the button in
-- Role Management (054) only stops the UI from offering it; the RPC itself
-- needed the same guard, or a direct API/RPC call bypasses the fix
-- entirely. Pulled the exact live function body via pg_get_functiondef
-- before touching it, per this project's own established lesson about
-- reconstructing RPCs from memory.
--
-- 'support' may now only be reached by demoting an existing admin/
-- super_admin down, or granted fresh via set_new_staff_role() (054) during
-- account creation -- never by promoting an existing 'user' role account.

create or replace function promote_user_role(p_profile_id uuid, p_new_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_super_admin_exists boolean;
  v_old_role text;
begin
  if p_new_role not in ('user', 'support', 'admin', 'super_admin') then
    raise exception 'invalid role';
  end if;

  select exists(select 1 from profiles where role = 'super_admin') into v_super_admin_exists;
  select role into v_old_role from profiles where id = p_profile_id;

  if not v_super_admin_exists then
    -- Bootstrap window: no super admin exists yet. Only self-promotion to
    -- super_admin is allowed -- can't be used to hand the role to someone
    -- else, and can't grant any other role before a super admin exists to
    -- have assigned it.
    if auth.uid() <> p_profile_id or p_new_role <> 'super_admin' then
      raise exception 'not authorized';
    end if;
  else
    if p_new_role in ('admin', 'super_admin') then
      raise exception 'granting admin or super_admin requires dual approval -- use request_role_change()';
    end if;
    if not is_super_admin() then raise exception 'not authorized'; end if;

    if p_new_role = 'support' and v_old_role = 'user' then
      raise exception 'renter/customer accounts cannot be promoted to staff directly -- use Create Staff Account to provision a dedicated account instead';
    end if;
  end if;

  if v_old_role = p_new_role then return; end if;

  perform set_config('app.bypass_profile_protection', 'true', true);
  update profiles set role = p_new_role where id = p_profile_id;

  perform log_audit(auth.uid(), 'role_changed', 'user', p_profile_id,
                     jsonb_build_object('old_role', v_old_role, 'new_role', p_new_role));
  perform notify_user(p_profile_id, 'role_changed', 'Your account role was changed to ' || p_new_role || '.', '/profile', true);
end;
$$;
