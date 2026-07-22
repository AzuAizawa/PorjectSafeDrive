-- SafeDrive 2.0 — lock verified-identity fields on profiles.
--
-- Per user feedback: "the basic info you provided should also be your
-- profile, the only editable is the phone number and address." Previously
-- a user could PATCH their own first_name/middle_name/last_name/birthday
-- directly since protect_profile_fields() only reset role/verified_status/
-- account_status/strike_count/account_flagged. These identity fields should
-- only ever be set by approve_verification() (which runs in an is_admin()
-- context and is therefore unaffected by this change).

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
    new.first_name       := old.first_name;
    new.middle_name       := old.middle_name;
    new.last_name       := old.last_name;
    new.birthday       := old.birthday;
    -- is_lister IS allowed to change (renter <-> lister mode switch is a user action)
  end if;
  return new;
end;
$$;
