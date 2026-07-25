-- SafeDrive 2.0 -- 3-tier RBAC: Super Admin / Admin / Support, built from the
-- RBAC brainstorm session (2026-07-23). Agreed design:
--
-- 1. Super Admin is a NEW, narrower role than Admin -- it can only manage
--    accounts/roles (this migration's Role Management page). It gets none of
--    Admin's operational power (Settings, Payments, Catalog stay Admin-only).
--    Modeled on the GitHub Owner / AWS root-vs-IAM / Stripe Account Owner
--    pattern: the identity-and-access role is kept separate from the
--    day-to-day operational role, so a compromised operational account can't
--    also mint new privileged accounts.
--
-- 2. Granting 'admin' or 'super_admin' now requires dual approval -- one
--    super admin requests it, a DIFFERENT super admin must approve it. This
--    is the standard "four eyes" control on privilege escalation (matches
--    why production deploys / prod DB access grants typically need a second
--    approver in real orgs). Demotions (support/user) stay single-actor,
--    since removing privilege is the safe direction and gating it would just
--    slow down incident response (e.g. immediately demoting a compromised
--    admin account).
--
-- 3. Every other super admin is notified on both the request AND the
--    resolution -- passive audit-log entries are not enough for something as
--    sensitive as privilege escalation; the other approvers need an active
--    signal, not something they'd only see if they happened to check.
--
-- 4. Mandatory MFA (is_aal2()) applies to super_admin exactly like it already
--    does for admin/support (034) -- the highest-privilege role gets the
--    same non-negotiable protection as the others, no exception.
--
-- Zero admin accounts exist in production as of this migration (confirmed
-- with the user), so there is no existing admin to migrate -- the bootstrap
-- exception in promote_user_role() below is being retargeted from 'admin' to
-- 'super_admin' cleanly, with nobody currently relying on the old behavior.

-- ============================================================
-- 1. Widen the role check constraint to allow 'super_admin'.
-- ============================================================
alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('user', 'support', 'admin', 'super_admin'));

-- ============================================================
-- 2. is_super_admin() -- same shape as is_admin()/is_support_or_admin()
--    (034): role check AND mandatory aal2. Not granted to anon -- nothing
--    anon-facing depends on it (only the super-admin-only table below does).
-- ============================================================
create or replace function is_super_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'super_admin') and is_aal2();
$$;

revoke execute on function is_super_admin() from public, anon;
grant execute on function is_super_admin() to authenticated;

-- ============================================================
-- 3. role_change_requests -- the dual-approval queue for granting
--    admin/super_admin. No insert/update policies: every write goes through
--    the SECURITY DEFINER RPCs below, never a direct client write.
-- ============================================================
create table role_change_requests (
  id uuid primary key default gen_random_uuid(),
  target_profile_id uuid not null references profiles(id),
  requested_role text not null check (requested_role in ('admin', 'super_admin')),
  requested_by uuid not null references profiles(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  resolution_notes text,
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table role_change_requests enable row level security;

create policy role_change_requests_select_super_admin on role_change_requests
  for select using (is_super_admin());

-- ============================================================
-- 4. audit_trail read access -- super admins need to see role-change history
--    (and everything else) just like admin already does. Additive policy,
--    existing admin-read policy from 001/002 is untouched.
-- ============================================================
create policy audit_select_super_admin on audit_trail
  for select using (is_super_admin());

-- ============================================================
-- 5. Security Log (042) -- super admin gets read access alongside admin,
--    per the design decision that Security Log is a role/access-oversight
--    tool, squarely in Super Admin's remit.
-- ============================================================
create or replace function get_auth_activity_log(p_limit int default 200)
returns table(
  occurred_at timestamptz,
  ip_address text,
  action text,
  actor_email text,
  actor_name text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_super_admin()) then raise exception 'not authorized'; end if;

  return query
    select
      a.created_at,
      nullif(a.ip_address, '') as ip_address,
      a.payload ->> 'action' as action,
      a.payload ->> 'actor_username' as actor_email,
      nullif(trim(concat(p.first_name, ' ', p.last_name)), '') as actor_name
    from auth.audit_log_entries a
    left join profiles p on p.id = nullif(a.payload ->> 'actor_id', '')::uuid
    order by a.created_at desc
    limit p_limit;
end;
$$;

revoke execute on function get_auth_activity_log(int) from public, anon;
grant execute on function get_auth_activity_log(int) to authenticated;

-- ============================================================
-- 6. promote_user_role() -- rewritten. Bootstrap branch now targets
--    'super_admin' (self-promotion only, only while zero super admins
--    exist). Post-bootstrap, this function ONLY performs demotions
--    (support/user) and requires the caller to already be a super admin --
--    granting admin/super_admin must go through request_role_change() +
--    approve_role_change_request() below.
-- ============================================================
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

-- Signature unchanged from 040, so its existing authenticated-only grant is
-- preserved automatically -- no revoke/grant needed here.

-- ============================================================
-- 7. request_role_change() -- a super admin requests granting admin or
--    super_admin to a target account. Notifies every OTHER super admin so
--    the pending request gets an active signal, not just a passive log row.
-- ============================================================
create or replace function request_role_change(p_profile_id uuid, p_new_role text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_request_id uuid;
  v_current_role text;
  v_sa record;
begin
  if not is_super_admin() then raise exception 'not authorized'; end if;

  if p_new_role not in ('admin', 'super_admin') then
    raise exception 'role change requests are only for granting admin or super_admin -- use promote_user_role() for demotions';
  end if;

  select role into v_current_role from profiles where id = p_profile_id;
  if v_current_role is null then raise exception 'profile not found'; end if;
  if v_current_role = p_new_role then raise exception 'this account already has that role'; end if;

  if exists (select 1 from role_change_requests where target_profile_id = p_profile_id and status = 'pending') then
    raise exception 'a pending role change request already exists for this account';
  end if;

  insert into role_change_requests (target_profile_id, requested_role, requested_by)
  values (p_profile_id, p_new_role, auth.uid())
  returning id into v_request_id;

  perform log_audit(auth.uid(), 'role_change_requested', 'role_change_request', v_request_id,
                     jsonb_build_object('target_profile_id', p_profile_id, 'requested_role', p_new_role));

  for v_sa in select id from profiles where role = 'super_admin' and id <> auth.uid() loop
    perform notify_user(v_sa.id, 'role_change_requested',
      'A role change request needs a second super admin''s approval.', '/admin/role-management', true);
  end loop;

  return v_request_id;
end;
$$;

revoke execute on function request_role_change(uuid, text) from public, anon;
grant execute on function request_role_change(uuid, text) to authenticated;

-- ============================================================
-- 8. approve_role_change_request() -- must be a DIFFERENT super admin than
--    the requester (the actual "four eyes" enforcement point).
-- ============================================================
create or replace function approve_role_change_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req role_change_requests%rowtype;
  v_sa record;
begin
  if not is_super_admin() then raise exception 'not authorized'; end if;

  select * into v_req from role_change_requests where id = p_request_id;
  if v_req.id is null then raise exception 'request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'request is no longer pending'; end if;
  if v_req.requested_by = auth.uid() then
    raise exception 'a different super admin must approve this request';
  end if;

  perform set_config('app.bypass_profile_protection', 'true', true);
  update profiles set role = v_req.requested_role where id = v_req.target_profile_id;

  update role_change_requests
    set status = 'approved', resolved_by = auth.uid(), resolved_at = now()
    where id = p_request_id;

  perform log_audit(auth.uid(), 'role_change_approved', 'role_change_request', p_request_id,
                     jsonb_build_object('target_profile_id', v_req.target_profile_id, 'new_role', v_req.requested_role));
  perform notify_user(v_req.target_profile_id, 'role_changed',
    'Your account role was changed to ' || v_req.requested_role || '.', '/profile', true);

  for v_sa in select id from profiles where role = 'super_admin' and id <> auth.uid() loop
    perform notify_user(v_sa.id, 'role_change_approved',
      'A pending role change request was approved.', '/admin/role-management', false);
  end loop;
end;
$$;

revoke execute on function approve_role_change_request(uuid) from public, anon;
grant execute on function approve_role_change_request(uuid) to authenticated;

-- ============================================================
-- 9. reject_role_change_request() -- any super admin, including the
--    original requester, can withdraw/reject a pending request.
-- ============================================================
create or replace function reject_role_change_request(p_request_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req role_change_requests%rowtype;
  v_sa record;
begin
  if not is_super_admin() then raise exception 'not authorized'; end if;

  select * into v_req from role_change_requests where id = p_request_id;
  if v_req.id is null then raise exception 'request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'request is no longer pending'; end if;

  update role_change_requests
    set status = 'rejected', resolution_notes = p_reason, resolved_by = auth.uid(), resolved_at = now()
    where id = p_request_id;

  perform log_audit(auth.uid(), 'role_change_rejected', 'role_change_request', p_request_id,
                     jsonb_build_object('target_profile_id', v_req.target_profile_id, 'requested_role', v_req.requested_role, 'reason', p_reason));

  for v_sa in select id from profiles where role = 'super_admin' and id <> auth.uid() loop
    perform notify_user(v_sa.id, 'role_change_rejected',
      'A pending role change request was rejected.', '/admin/role-management', false);
  end loop;
end;
$$;

revoke execute on function reject_role_change_request(uuid, text) from public, anon;
grant execute on function reject_role_change_request(uuid, text) to authenticated;
