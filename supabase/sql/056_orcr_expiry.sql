-- SafeDrive 2.0 -- ORCR/registration renewal tracking.
--
-- Real gap: orcr_path stored the document itself but nothing tracked when
-- the underlying LTO registration actually expires. In the Philippines,
-- private-vehicle registration (the OR/CR) renews annually, and that's
-- exactly what should drive a renewal reminder -- not an arbitrary
-- platform-set interval. Captured at listing time alongside the ORCR
-- upload itself, editable later like the document, and -- like
-- plate_number/orcr_path/model_id -- changing it post-approval forces
-- re-review, since an owner could otherwise quietly extend the date to
-- dodge a renewal requirement without admin ever re-checking the actual
-- document.
--
-- Existing vehicles have no data for this (nullable) -- there was never a
-- prompt to collect it before now, so it can't be backfilled honestly.

alter table vehicles add column orcr_expiry_date date;

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
       or new.orcr_expiry_date is distinct from old.orcr_expiry_date
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
