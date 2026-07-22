-- SafeDrive 2.0 — model_year should re-trigger admin approval like plate_number/
-- model_id/orcr_path, since it's vehicle-eligibility data (the max-age check
-- reads it) and the Edit Vehicle UI already tells the owner it will.

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
       or new.model_id is distinct from old.model_id
       or new.model_year is distinct from old.model_year then
      new.approval_status  := 'pending';
      new.rejection_reason := null;
    else
      new.approval_status  := old.approval_status;
      new.rejection_reason := old.rejection_reason;
    end if;
  end if;
  return new;
end;
$$;
