-- SafeDrive 2.0 -- fix a real bug: super_admin couldn't see any other user.
--
-- profiles_select_admin (015_ban_evasion_age_limits_support_role.sql) grants
-- read access via is_support_or_admin(), which only checks role in
-- ('support', 'admin') -- super_admin was never included. 044 built the
-- entire Role Management page around "select * from profiles", but with no
-- matching RLS grant, a super_admin's query is silently filtered by RLS down
-- to just their own row (profiles_select_own). Confirmed live: querying as
-- enzomc360@gmail.com (super_admin) returned only their own profile.
--
-- Same shape as audit_select_super_admin (044) -- additive policy, doesn't
-- touch the existing admin/support policy.

create policy profiles_select_super_admin on profiles
  for select using (is_super_admin());
