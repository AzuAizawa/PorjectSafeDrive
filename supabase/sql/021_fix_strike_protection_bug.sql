-- SafeDrive 2.0 — fix a real, pre-existing bug: strikes were never actually
-- recorded.
--
-- protect_profile_fields() (002_rls_policies.sql) reverts strike_count/
-- account_flagged on any profiles UPDATE where the caller isn't an admin.
-- add_strike() is invoked from cancel_booking()/cancel_no_show(), which are
-- called by the renter or owner themselves — never an admin — so is_admin()
-- was always false in that context, and the trigger silently discarded
-- every strike before it ever reached the table. Verified live: called
-- add_strike() directly, get_active_strike_count() correctly returned the
-- new count, but profiles.strike_count stayed at 0 both before and after.
--
-- Fix: a transaction-local flag that only add_strike()/clear_strikes() can
-- set, which the trigger trusts. Nothing else can set it (it's not exposed
-- to clients), so this doesn't weaken the protection against a user
-- directly PATCHing their own row — it only lets these two already-
-- authorization-checked, trusted internal functions through.

create or replace function protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() and coalesce(current_setting('app.bypass_profile_protection', true), 'false') <> 'true' then
    new.role            := old.role;
    new.verified_status := old.verified_status;
    new.account_status  := old.account_status;
    new.strike_count    := old.strike_count;
    new.account_flagged := old.account_flagged;
    -- is_lister IS allowed to change (renter <-> lister mode switch is a user action)
  end if;
  return new;
end;
$$;

create or replace function add_strike(p_profile_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_active_count int;
begin
  insert into strikes(profile_id, reason) values (p_profile_id, p_reason);
  v_active_count := get_active_strike_count(p_profile_id);

  perform set_config('app.bypass_profile_protection', 'true', true);
  update profiles set
    strike_count = v_active_count,
    account_flagged = account_flagged or (v_active_count >= get_setting_int('demerit_strike_threshold'))
  where id = p_profile_id;
end;
$$;

create or replace function clear_strikes(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  delete from strikes where profile_id = p_profile_id;

  perform set_config('app.bypass_profile_protection', 'true', true);
  update profiles set strike_count = 0, account_flagged = false where id = p_profile_id;

  perform log_audit(auth.uid(), 'strikes_cleared', 'user', p_profile_id, '{}'::jsonb);
end;
$$;
