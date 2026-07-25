-- SafeDrive 2.0 -- reconsidered scope: make Super Admin a strict superset of
-- Admin's operational access, rather than a disjoint identity-only role.
--
-- 044 modeled Super Admin narrowly on Azure AD's "Privileged Role
-- Administrator" pattern (identity/access only, zero operational power).
-- That's a real enterprise pattern, but it's not how "Super Admin" reads in
-- the products most people actually reference (Okta, Google Workspace,
-- GitHub Owner, Stripe Account Owner all give their top role EVERYTHING a
-- regular admin has, plus more) -- a narrower-than-Admin "Super Admin" is
-- backwards from that expectation and hard to defend without a lot of
-- caveats. Reconsidered per user request.
--
-- Fix: is_admin() and is_support_or_admin() now both also accept
-- 'super_admin'. Because virtually every admin/support-gated RLS policy and
-- RPC in this codebase already calls one of these two functions (never a
-- raw `role = 'admin'` check), broadening just these two functions extends
-- super_admin's access everywhere automatically -- Dashboard, Analytics,
-- Users, Vehicle Approval (including verification/vehicle approve+reject),
-- Disputes, Inquiries, Catalog, Payments, Settings, Company Info -- with no
-- other SQL changes required.
--
-- What this deliberately does NOT touch: the dual-approval requirement for
-- *granting* admin/super_admin (promote_user_role() / request_role_change()
-- / approve_role_change_request(), 044) is enforced via explicit role
-- checks on p_new_role, not via is_admin()/is_support_or_admin() -- so the
-- "four eyes" control on privilege escalation stays exactly as strict as
-- before. Only the question of "what can Super Admin see/do day to day"
-- changes here, not "who can create a new Super Admin."

create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'super_admin')
  ) and is_aal2();
$$;

create or replace function is_support_or_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('support', 'admin', 'super_admin')) and is_aal2();
$$;
