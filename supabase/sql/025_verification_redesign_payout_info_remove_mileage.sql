-- SafeDrive 2.0 — real user-testing feedback, three schema changes:
--
-- 1. Verification redesign: driver's license is the only ID with a typed
--    number; "national ID" becomes a Secondary ID *type* dropdown (no typed
--    number for it) with its own front/back photos.
-- 2. Payout info on profiles, so admin knows where to actually send money.
-- 3. Remove vehicles.mileage entirely (not needed for listing a car).

-- ============================================================
-- 1. Verification submissions
-- ============================================================
alter table verification_submissions rename column national_id_front_path to secondary_id_front_path;
alter table verification_submissions rename column national_id_back_path to secondary_id_back_path;

alter table verification_submissions add column secondary_id_type text;
update verification_submissions set secondary_id_type = 'national_id' where secondary_id_type is null;
alter table verification_submissions alter column secondary_id_type set not null;
alter table verification_submissions add constraint verification_secondary_id_type_check
  check (secondary_id_type in ('national_id', 'passport', 'sss_id', 'philhealth_id', 'postal_id', 'voters_id', 'prc_id', 'other'));

alter table verification_submissions drop column national_id_number;

-- Ban-evasion now matches on driver's license number only, since national ID
-- number no longer exists as a typed field to compare.
create or replace function check_ban_evasion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from verification_submissions vs
    join profiles p on p.id = vs.profile_id
    where p.account_status = 'banned'
      and vs.profile_id <> new.profile_id
      and vs.driver_license_number = new.driver_license_number
  ) then
    new.ban_evasion_flag := true;
  end if;
  return new;
end;
$$;

-- ============================================================
-- 2. Payout info (profiles) — admin needs this to actually send money
-- ============================================================
alter table profiles add column payout_method text check (payout_method in ('bank_transfer', 'gcash'));
alter table profiles add column bank_account_name text;
alter table profiles add column bank_name text;
alter table profiles add column bank_account_number text;
alter table profiles add column gcash_number text;

-- ============================================================
-- 3. Remove vehicles.mileage
-- ============================================================
alter table vehicles drop column mileage;
