-- SafeDrive 2.0 -- correct staff account provisioning.
--
-- Real gap found: nothing stopped a super_admin from picking an arbitrary
-- EXISTING renter/customer account out of Role Management and escalating it
-- directly to admin/staff. In real enterprise systems, staff identities are
-- never derived from a customer-facing account -- a new hire gets a
-- dedicated account from day one, so a compromised customer identity (weak
-- reused password, phishing, etc.) can never become a path into internal
-- tools. The frontend now only offers escalation for accounts already at
-- 'support' (an existing staff member moving up is normal internal
-- progression, still dual-approval-gated exactly as before) -- never for
-- role = 'user'.
--
-- set_new_staff_role() is the other half: real provisioning of a BRAND NEW
-- account, called only by the create-staff-account Edge Function (service
-- role, after it verifies the caller is a live super_admin) once it has
-- invited a fresh auth user by email. Starts every new staff account at
-- 'support' -- the lowest-privilege tier -- exactly matching the
-- least-privilege default this app already uses everywhere else; escalating
-- from there still goes through the existing dual-approval flow.

create or replace function set_new_staff_role(p_profile_id uuid, p_created_by uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from profiles where id = p_profile_id and role <> 'user') then
    raise exception 'target is not a freshly created account';
  end if;

  perform set_config('app.bypass_profile_protection', 'true', true);
  update profiles set role = 'support' where id = p_profile_id;

  perform log_audit(p_created_by, 'staff_account_created', 'user', p_profile_id, jsonb_build_object('initial_role', 'support'));
end;
$$;

-- Not granted to authenticated/anon at all -- only callable via the
-- service_role key (the create-staff-account Edge Function), same posture
-- as the PayMongo webhook confirmation functions (005_grants.sql).
revoke execute on function set_new_staff_role(uuid, uuid) from public, anon, authenticated;
