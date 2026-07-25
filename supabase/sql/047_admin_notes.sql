-- SafeDrive 2.0 -- internal admin-only notes on profiles and vehicles.
--
-- Admin-ops quality-of-life gap identified while reviewing the verification
-- workflow: reviewers had no way to leave a note for the next admin (e.g.
-- "borderline selfie match, watch this account" or "owner disputes ORCR
-- delay, called them 7/25") -- only the user-facing rejection_reason exists.
--
-- Both profiles and vehicles already allow the row owner to UPDATE their own
-- row directly (profiles_update_own / vehicles_update_owner, 002), so a new
-- plain column would be self-writable by the user via a direct PATCH unless
-- explicitly guarded -- added to both protect_*_fields() triggers' revert
-- list, the same mechanism already locking down role/verified_status/etc.

alter table profiles add column admin_notes text;
alter table vehicles add column admin_notes text;

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
    new.admin_notes     := old.admin_notes;
    -- is_lister IS allowed to change (renter <-> lister mode switch is a user action)
  end if;
  return new;
end;
$$;

create or replace function protect_vehicle_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    if new.plate_number is distinct from old.plate_number
       or new.orcr_path is distinct from old.orcr_path
       or new.model_id is distinct from old.model_id then
      new.approval_status  := 'pending';
      new.rejection_reason := null;
    else
      new.approval_status  := old.approval_status;
      new.rejection_reason := old.rejection_reason;
    end if;
    new.admin_notes := old.admin_notes;
  end if;
  return new;
end;
$$;
