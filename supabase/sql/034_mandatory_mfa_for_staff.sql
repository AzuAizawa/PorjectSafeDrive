-- SafeDrive 2.0 — make 2FA mandatory for admin/support accounts.
--
-- 2FA already existed (Supabase Auth native TOTP) but was opt-in for
-- everyone, including staff — the actual real-world justification
-- discussed with the user (separate admin portals exist mainly to reduce
-- attack surface and allow a stricter security posture for privileged
-- accounts) doesn't require a separate portal to achieve, just a stricter
-- requirement on the *existing* one. This is the cheap middle ground:
-- is_admin()/is_support_or_admin() now also require the CURRENT session to
-- have completed an MFA challenge (aal2), not just checking role. A staff
-- account with no verified TOTP factor can never reach aal2, so this
-- forces enrollment as a side effect of the same check — no separate
-- "has factors" gate needed on the DB side.

create or replace function is_aal2()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  ) and is_aal2();
$$;

create or replace function is_support_or_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('support', 'admin')) and is_aal2();
$$;
