-- SafeDrive 2.0 — ban-evasion check, minimum renter age, max vehicle age,
-- and a support-tier admin role (all locked in during the trust & safety /
-- operational-scale brainstorm round).

-- ============================================================
-- 1. BAN-EVASION CHECK
-- A banned user could otherwise just sign up again with a new email. Flag
-- (don't silently block — admin makes the final call) any new submission
-- whose license/national ID number was ever tied to a banned account.
-- ============================================================
alter table verification_submissions add column ban_evasion_flag boolean not null default false;

create or replace function check_ban_evasion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from verification_submissions vs
    join profiles p on p.id = vs.profile_id
    where p.account_status = 'banned'
      and vs.profile_id <> new.profile_id
      and (vs.driver_license_number = new.driver_license_number or vs.national_id_number = new.national_id_number)
  ) then
    new.ban_evasion_flag := true;
  end if;
  return new;
end;
$$;

create trigger trg_check_ban_evasion
  before insert on verification_submissions
  for each row execute function check_ban_evasion();

-- ============================================================
-- 2. MINIMUM RENTER AGE
-- Enforced at booking time (the actual risky action), not verification
-- time, consistent with how verified_status is already gated there.
-- ============================================================
insert into platform_settings (key, value, description) values
  ('minimum_renter_age', '21', 'Minimum age (years) required to book a vehicle')
on conflict (key) do nothing;

create or replace function get_profile_age(p_profile_id uuid)
returns integer language sql stable as $$
  select extract(year from age(current_date, birthday))::integer from profiles where id = p_profile_id;
$$;

-- request_booking() gets the age check spliced in via a full replace,
-- since the function's authorization checks live at its top.
create or replace function request_booking(p_vehicle_id uuid, p_start_date date, p_end_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_vehicle vehicles%rowtype;
  v_renter_verified text;
  v_renter_birthday date;
  v_total_days int;
  v_base numeric; v_commission numeric; v_total numeric; v_downpayment numeric; v_balance numeric;
  v_booking_id uuid;
begin
  select verified_status, birthday into v_renter_verified, v_renter_birthday from profiles where id = auth.uid();
  if v_renter_verified <> 'verified' then
    raise exception 'must be verified to book a vehicle';
  end if;
  if v_renter_birthday is null or extract(year from age(current_date, v_renter_birthday)) < get_setting_int('minimum_renter_age') then
    raise exception 'must be at least % years old to book a vehicle', get_setting_int('minimum_renter_age');
  end if;

  select * into v_vehicle from vehicles where id = p_vehicle_id;
  if v_vehicle.approval_status <> 'approved' or v_vehicle.listing_status <> 'active' then
    raise exception 'vehicle is not available for booking';
  end if;

  if p_end_date <= p_start_date then
    raise exception 'end_date must be after start_date';
  end if;

  if exists (
    select 1 from bookings
    where vehicle_id = p_vehicle_id
      and status in ('pending_payment','downpayment_paid','fully_paid','active')
      and daterange(start_date, end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
  ) then
    raise exception 'these dates are no longer available for this vehicle';
  end if;

  v_total_days := p_end_date - p_start_date;
  v_base       := v_vehicle.daily_price * v_total_days;
  v_commission := v_vehicle.daily_price * (get_setting_numeric('commission_percent') / 100) * v_total_days;
  v_total      := v_base + v_commission;
  v_downpayment:= v_total * (get_setting_numeric('downpayment_percent') / 100);
  v_balance    := v_total - v_downpayment;

  insert into bookings (
    vehicle_id, renter_id, owner_id, start_date, end_date, total_days,
    base_price, commission, total_price, downpayment_amount, balance_amount, deposit_amount,
    status, owner_response_deadline
  ) values (
    p_vehicle_id, auth.uid(), v_vehicle.owner_id, p_start_date, p_end_date, v_total_days,
    v_base, v_commission, v_total, v_downpayment, v_balance,
    case when v_vehicle.requires_deposit then v_vehicle.deposit_amount else 0 end,
    'pending_owner', now() + (get_setting_int('owner_response_hours') || ' hours')::interval
  ) returning id into v_booking_id;

  perform log_audit(auth.uid(), 'booking_created', 'booking', v_booking_id, '{}'::jsonb);
  perform notify_user(v_vehicle.owner_id, 'booking_request', 'You have a new booking request.', '/bookings-received', true);

  return v_booking_id;
end;
$$;

-- ============================================================
-- 3. MAX VEHICLE AGE
-- ============================================================
alter table vehicles add column model_year integer;

insert into platform_settings (key, value, description) values
  ('max_vehicle_age_years', '15', 'Vehicles older than this (current year - model_year) cannot be listed')
on conflict (key) do nothing;

create or replace function check_vehicle_age()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.model_year is not null
     and (extract(year from current_date) - new.model_year) > get_setting_int('max_vehicle_age_years') then
    raise exception 'vehicle model year exceeds the maximum allowed age of % years', get_setting_int('max_vehicle_age_years');
  end if;
  return new;
end;
$$;

create trigger trg_check_vehicle_age
  before insert or update of model_year on vehicles
  for each row execute function check_vehicle_age();

-- ============================================================
-- 4. SUPPORT-TIER ADMIN ROLE
-- Can review/resolve verifications, vehicles, disputes. Cannot touch
-- platform_settings, payouts/refunds, or suspend/ban/clear-strikes —
-- those stay is_admin()-only, both in RLS and inside the RPCs themselves.
-- ============================================================
alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('user', 'support', 'admin'));

create or replace function is_support_or_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('support', 'admin'));
$$;

grant execute on function is_support_or_admin() to authenticated;
grant execute on function get_profile_age(uuid) to authenticated;

-- Broaden read access for the pages support should see:
drop policy profiles_select_admin on profiles;
create policy profiles_select_admin on profiles for select using (is_support_or_admin());

drop policy verification_select_admin on verification_submissions;
create policy verification_select_admin on verification_submissions for select using (is_support_or_admin());
drop policy verification_update_admin on verification_submissions;
create policy verification_update_admin on verification_submissions for update using (is_support_or_admin());

drop policy vehicles_select_admin on vehicles;
create policy vehicles_select_admin on vehicles for select using (is_support_or_admin());

drop policy vehicle_images_admin on vehicle_images;
create policy vehicle_images_admin on vehicle_images for all using (is_support_or_admin());

drop policy disputes_select_admin on disputes;
create policy disputes_select_admin on disputes for select using (is_support_or_admin());
drop policy disputes_resolve_admin on disputes;
create policy disputes_resolve_admin on disputes for update using (is_support_or_admin());

drop policy bookings_select_admin on bookings;
create policy bookings_select_admin on bookings for select using (is_support_or_admin());

-- Broaden authorization inside the RPCs support should be able to call:
create or replace function approve_verification(p_submission_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_sub record;
begin
  if not is_support_or_admin() then raise exception 'not authorized'; end if;
  select * into v_sub from verification_submissions where id = p_submission_id;
  if v_sub.status <> 'pending' then raise exception 'submission already reviewed'; end if;

  update verification_submissions
    set status = 'verified', reviewed_at = now(), reviewed_by = auth.uid()
    where id = p_submission_id;

  update profiles set
    first_name = v_sub.first_name, middle_name = v_sub.middle_name, last_name = v_sub.last_name,
    phone = v_sub.phone, address = v_sub.address, birthday = v_sub.birthday,
    verified_status = 'verified'
  where id = v_sub.profile_id;

  perform log_audit(auth.uid(), 'user_verified', 'user', v_sub.profile_id, '{}'::jsonb);
  perform notify_user(v_sub.profile_id, 'verification_approved', 'Your identity verification was approved.', '/verify', true);
end;
$$;

create or replace function reject_verification(p_submission_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_sub record;
begin
  if not is_support_or_admin() then raise exception 'not authorized'; end if;
  select * into v_sub from verification_submissions where id = p_submission_id;
  if v_sub.status <> 'pending' then raise exception 'submission already reviewed'; end if;

  update verification_submissions
    set status = 'rejected', rejection_reason = p_reason, reviewed_at = now(), reviewed_by = auth.uid()
    where id = p_submission_id;

  update profiles set verified_status = 'rejected' where id = v_sub.profile_id;

  perform log_audit(auth.uid(), 'user_rejected', 'user', v_sub.profile_id, jsonb_build_object('reason', p_reason));
  perform notify_user(v_sub.profile_id, 'verification_rejected', 'Your verification was rejected: ' || p_reason, '/verify', true);
end;
$$;

create or replace function approve_vehicle(p_vehicle_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not is_support_or_admin() then raise exception 'not authorized'; end if;
  update vehicles set approval_status = 'approved', rejection_reason = null
    where id = p_vehicle_id
    returning owner_id into v_owner;

  perform log_audit(auth.uid(), 'vehicle_approved', 'vehicle', p_vehicle_id, '{}'::jsonb);
  perform notify_user(v_owner, 'vehicle_approved', 'Your vehicle listing was approved and is now live.', '/my-vehicles', true);
end;
$$;

create or replace function reject_vehicle(p_vehicle_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not is_support_or_admin() then raise exception 'not authorized'; end if;
  update vehicles set approval_status = 'rejected', rejection_reason = p_reason
    where id = p_vehicle_id
    returning owner_id into v_owner;

  perform log_audit(auth.uid(), 'vehicle_rejected', 'vehicle', p_vehicle_id, jsonb_build_object('reason', p_reason));
  perform notify_user(v_owner, 'vehicle_rejected', 'Your vehicle listing was rejected: ' || p_reason, '/my-vehicles', true);
end;
$$;

create or replace function resolve_dispute(p_dispute_id uuid, p_resolution_notes text, p_refund_amount numeric default 0)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_dispute disputes%rowtype;
begin
  if not is_support_or_admin() then raise exception 'not authorized'; end if;
  select * into v_dispute from disputes where id = p_dispute_id;
  update disputes set status = 'resolved', resolution_notes = p_resolution_notes,
                       resolved_by = auth.uid(), resolved_at = now()
  where id = p_dispute_id;

  if p_refund_amount > 0 then
    insert into payments(booking_id, payer_id, payment_type, amount, status)
    select id, renter_id, 'refund', p_refund_amount, 'pending' from bookings where id = v_dispute.booking_id;
  end if;

  perform log_audit(auth.uid(), 'dispute_resolved', 'dispute', p_dispute_id,
                     jsonb_build_object('notes', p_resolution_notes, 'refund_amount', p_refund_amount));
end;
$$;
