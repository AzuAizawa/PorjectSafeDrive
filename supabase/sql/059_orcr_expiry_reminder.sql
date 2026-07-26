-- SafeDrive 2.0 -- proactive ORCR/registration expiry reminder.
--
-- orcr_expiry_date (056_orcr_expiry.sql) only ever drove a badge -- nothing
-- told the owner their registration was about to lapse; they'd only notice
-- by looking at My Vehicles. This adds a daily cron that emails/notifies the
-- owner once, a configurable number of days before expiry, reusing the
-- existing notify_user()/pg_cron/platform_settings infrastructure.

alter table vehicles add column orcr_expiry_reminder_sent boolean not null default false;

-- Full redefinition (same pattern as 056_orcr_expiry.sql). Adds an
-- unconditional reset of the reminder flag whenever orcr_expiry_date
-- changes -- regardless of who changes it -- so a fresh reminder cycle
-- starts for the new date instead of silently staying "already sent".
create or replace function protect_vehicle_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.orcr_expiry_date is distinct from old.orcr_expiry_date then
    new.orcr_expiry_reminder_sent := false;
  end if;

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

insert into platform_settings (key, value, description) values
  ('orcr_expiry_reminder_days', '30', 'Days before OR/CR registration expiry to send the owner a renewal reminder')
on conflict (key) do nothing;

create or replace function notify_orcr_expiring_vehicles()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_days int := get_setting_int('orcr_expiry_reminder_days');
  v record;
begin
  for v in
    select id, owner_id, orcr_expiry_date from vehicles
    where orcr_expiry_date is not null
      and orcr_expiry_reminder_sent = false
      and orcr_expiry_date >= current_date
      and orcr_expiry_date <= current_date + v_days
  loop
    perform notify_user(
      v.owner_id, 'orcr_expiry_reminder',
      'Your OR/CR registration expires on ' || v.orcr_expiry_date || ' — renew it soon to keep your listing in good standing.',
      '/my-vehicles', true
    );
    update vehicles set orcr_expiry_reminder_sent = true where id = v.id;
  end loop;
end;
$$;

select cron.schedule('notify-orcr-expiring-vehicles', '0 5 * * *', $$select notify_orcr_expiring_vehicles();$$);
