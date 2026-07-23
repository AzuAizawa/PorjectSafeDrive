-- SafeDrive 2.0 -- Full booking-flow refinement session (2026-07-23):
-- (1) pickup TIME (not just date) captured at request time,
-- (2) a real 3-color availability calendar (available/booked/owner-blocked
--     -- the "owner-blocked" color is entirely new, no such concept existed),
-- (3) the free-cancellation window now also respects proximity to pickup
--     (mirrors Airbnb's "48h grace period, but not if check-in is <14 days
--     away" rule -- previously cancel_booking() only checked time-since-
--     payment, never how close pickup was),
-- (4) the pickup-day meetup flow, modeled on how e-commerce delivery
--     confirmation actually works (Lazada/TikTok): the party physically
--     present and accountable (the owner, both at handover AND at return --
--     they're the one inspecting the car either way) is the sole confirmer.
--     The other party has no mandatory check-in, only a reactive
--     report/dispute action if something's wrong. This replaces the
--     two-sided renter_completed/owner_completed gate on mark_complete()
--     (real friction: both had to tap for a booking to ever close out) and
--     repurposes cancel_no_show() from "unpaid cash at meetup" (no longer
--     applicable now that the balance is always paid online) to "renter
--     never physically showed up by pickup time + grace period."
--
-- Deliberate simplification vs. the earlier brainstormed design: no separate
-- "balance due N hours before pickup" deadline/cron was built. The pickup
-- no-show mechanism already naturally subsumes it -- if the renter hasn't
-- paid the balance and isn't there by pickup + grace, the owner marks a
-- no-show exactly as if they were unpaid *and* absent, same fee/strike
-- either way. One mechanism instead of two, same outcome.

-- ============================================================
-- 1. pickup_time + new status value + new dynamic settings
-- ============================================================
alter table bookings add column pickup_time time not null default '10:00:00';

alter table bookings drop constraint bookings_status_check;
alter table bookings add constraint bookings_status_check check (status in (
  'pending_owner','owner_rejected','expired',
  'pending_payment','downpayment_paid','fully_paid',
  'active','completed',
  'cancelled_by_renter','cancelled_by_owner','cancelled_no_show','owner_no_show'
));

insert into platform_settings (key, value, description) values
  ('no_show_grace_minutes', '30', 'Minutes after scheduled pickup time before a no-show can be reported by either side'),
  ('no_free_cancel_hours_before_pickup', '24', 'Free cancellation is withdrawn once pickup is this close, even if still inside free_cancel_hours')
on conflict (key) do nothing;

-- ============================================================
-- 2. Owner-blocked dates -- the third calendar color. Nothing like this
--    existed before; availability was purely derived from bookings.
-- ============================================================
create table vehicle_blocked_dates (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  reason      text,
  created_at  timestamptz not null default now(),
  constraint chk_blocked_dates check (end_date >= start_date)
);
create index idx_vehicle_blocked_dates_vehicle on vehicle_blocked_dates(vehicle_id, start_date, end_date);

alter table vehicle_blocked_dates enable row level security;

create policy "anyone can view blocked dates" on vehicle_blocked_dates
  for select using (true);

create policy "owner manages own blocked dates" on vehicle_blocked_dates
  for all
  using (exists (select 1 from vehicles v where v.id = vehicle_id and v.owner_id = auth.uid()))
  with check (exists (select 1 from vehicles v where v.id = vehicle_id and v.owner_id = auth.uid()));

-- An owner can't retroactively block dates a renter has already locked in.
create or replace function trg_check_blocked_dates_no_overlap()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from bookings
    where vehicle_id = new.vehicle_id
      and status in ('pending_payment','downpayment_paid','fully_paid','active')
      and daterange(start_date, end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'cannot block dates that overlap an active booking';
  end if;
  return new;
end;
$$;

create trigger trg_blocked_dates_check before insert or update on vehicle_blocked_dates
  for each row execute function trg_check_blocked_dates_no_overlap();

-- Per-day status for the Car Detail calendar: booked (from a locking
-- booking) takes precedence over owner-blocked, everything else is available.
create or replace function get_vehicle_calendar(p_vehicle_id uuid, p_from date, p_to date)
returns table(day date, status text)
language sql stable security definer set search_path = public as $$
  select d::date as day,
    case
      when exists (
        select 1 from bookings b
        where b.vehicle_id = p_vehicle_id
          and b.status in ('pending_payment','downpayment_paid','fully_paid','active')
          and daterange(b.start_date, b.end_date, '[]') @> d::date
      ) then 'booked'
      when exists (
        select 1 from vehicle_blocked_dates vb
        where vb.vehicle_id = p_vehicle_id
          and daterange(vb.start_date, vb.end_date, '[]') @> d::date
      ) then 'blocked'
      else 'available'
    end as status
  from generate_series(p_from, p_to, interval '1 day') as d;
$$;

grant execute on function get_vehicle_calendar(uuid, date, date) to authenticated, anon;

-- ============================================================
-- 3. request_booking -- add pickup_time param + blocked-dates check.
--    New signature, so the old 3-arg overload is dropped explicitly
--    (Postgres would otherwise happily keep both around).
-- ============================================================
drop function if exists request_booking(uuid, date, date);

create or replace function request_booking(p_vehicle_id uuid, p_start_date date, p_end_date date, p_pickup_time time)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_vehicle vehicles%rowtype;
  v_renter_verified text;
  v_renter_birthday date;
  v_total_days int;
  v_base numeric; v_commission numeric; v_total numeric; v_downpayment numeric; v_balance numeric;
  v_booking_id uuid;
begin
  perform enforce_cooldown(auth.uid(), 'request_booking', 10);

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

  if exists (
    select 1 from vehicle_blocked_dates
    where vehicle_id = p_vehicle_id
      and daterange(start_date, end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
  ) then
    raise exception 'these dates are blocked by the owner';
  end if;

  v_total_days := p_end_date - p_start_date;
  v_base       := v_vehicle.daily_price * v_total_days;
  v_commission := v_vehicle.daily_price * (get_setting_numeric('commission_percent') / 100) * v_total_days;
  v_total      := v_base + v_commission;
  v_downpayment:= v_total * (get_setting_numeric('downpayment_percent') / 100);
  v_balance    := v_total - v_downpayment;

  insert into bookings (
    vehicle_id, renter_id, owner_id, start_date, end_date, total_days, pickup_time,
    base_price, commission, total_price, downpayment_amount, balance_amount, deposit_amount,
    status, owner_response_deadline
  ) values (
    p_vehicle_id, auth.uid(), v_vehicle.owner_id, p_start_date, p_end_date, v_total_days, p_pickup_time,
    v_base, v_commission, v_total, v_downpayment, v_balance,
    case when v_vehicle.requires_deposit then v_vehicle.deposit_amount else 0 end,
    'pending_owner', now() + (get_setting_int('owner_response_hours') || ' hours')::interval
  ) returning id into v_booking_id;

  perform log_audit(auth.uid(), 'booking_created', 'booking', v_booking_id, '{}'::jsonb);
  perform notify_user(v_vehicle.owner_id, 'booking_request', 'You have a new booking request.', '/bookings-received', true);

  return v_booking_id;
end;
$$;

grant execute on function request_booking(uuid, date, date, time) to authenticated;

-- ============================================================
-- 4. cancel_booking -- free-cancellation now also requires enough lead
--    time before pickup, not just time-since-payment.
-- ============================================================
create or replace function cancel_booking(p_booking_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
  v_is_renter boolean;
  v_fee numeric := 0;
  v_paid numeric := 0;
  v_refund numeric := 0;
  v_pickup_ts timestamptz;
begin
  select * into v_booking from bookings where id = p_booking_id;

  if auth.uid() = v_booking.renter_id then v_is_renter := true;
  elsif auth.uid() = v_booking.owner_id then v_is_renter := false;
  else raise exception 'not authorized'; end if;

  if v_booking.status not in ('pending_owner','pending_payment','downpayment_paid','fully_paid') then
    raise exception 'booking can no longer be self-cancelled at this stage';
  end if;

  v_pickup_ts := (v_booking.start_date + v_booking.pickup_time) at time zone 'Asia/Manila';
  v_paid := case when v_booking.balance_paid then v_booking.total_price
                 when v_booking.downpayment_paid then v_booking.downpayment_amount
                 else 0 end;

  if v_is_renter then
    if v_booking.downpayment_paid_at is null then
      v_fee := 0;
    elsif now() <= v_booking.downpayment_paid_at + (get_setting_int('free_cancel_hours') || ' hours')::interval
      and now() <= v_pickup_ts - (get_setting_int('no_free_cancel_hours_before_pickup') || ' hours')::interval
    then
      v_fee := 0;
    else
      v_fee := v_booking.total_price * (get_setting_numeric('cancellation_fee_percent') / 100);
    end if;
    v_refund := greatest(v_paid - v_fee, 0);

    update bookings set status = 'cancelled_by_renter', cancellation_reason = p_reason where id = p_booking_id;
    perform log_audit(auth.uid(), 'booking_cancelled_by_renter', 'booking', p_booking_id,
                       jsonb_build_object('fee', v_fee, 'refund', v_refund));
    perform notify_user(v_booking.owner_id, 'booking_cancelled', 'A renter cancelled their booking.', '/bookings-received', true);
  else
    v_refund := v_paid;
    update bookings set status = 'cancelled_by_owner', cancellation_reason = p_reason where id = p_booking_id;
    perform add_strike(v_booking.owner_id, 'Cancelled an accepted booking');
    perform log_audit(auth.uid(), 'booking_cancelled_by_owner', 'booking', p_booking_id,
                       jsonb_build_object('refund', v_refund));
    perform notify_user(v_booking.renter_id, 'booking_cancelled', 'The owner cancelled your booking. You will be fully refunded.', '/bookings', true);
  end if;

  if v_refund > 0 then
    insert into payments(booking_id, payer_id, payment_type, amount, status)
    values (p_booking_id, v_booking.renter_id, 'refund', v_refund + case when v_booking.deposit_paid then v_booking.deposit_amount else 0 end, 'pending');
  end if;
end;
$$;

-- ============================================================
-- 5. cancel_no_show -- repurposed from "unpaid cash at meetup" (the whole
--    premise no longer applies, since the balance is always paid online)
--    to "renter never physically showed up by pickup time + grace period."
--    Now gated on the clock, not just on payment status.
-- ============================================================
create or replace function cancel_no_show(p_booking_id uuid, p_reason text default 'renter did not show up for pickup')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
  v_pickup_ts timestamptz;
  v_fee numeric;
  v_paid numeric;
  v_refund numeric;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.owner_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_booking.status not in ('downpayment_paid','fully_paid') then
    raise exception 'only applicable while a booking is awaiting pickup';
  end if;

  v_pickup_ts := (v_booking.start_date + v_booking.pickup_time) at time zone 'Asia/Manila';
  if now() < v_pickup_ts + (get_setting_int('no_show_grace_minutes') || ' minutes')::interval then
    raise exception 'the grace period after the scheduled pickup time has not elapsed yet';
  end if;

  v_paid := case when v_booking.balance_paid then v_booking.total_price else v_booking.downpayment_amount end;
  v_fee := v_booking.total_price * (get_setting_numeric('cancellation_fee_percent') / 100);
  v_refund := greatest(v_paid - v_fee, 0);

  update bookings set status = 'cancelled_no_show', cancellation_reason = p_reason where id = p_booking_id;
  perform add_strike(v_booking.renter_id, 'Did not show up for pickup');

  if v_refund > 0 then
    insert into payments(booking_id, payer_id, payment_type, amount, status)
    values (p_booking_id, v_booking.renter_id, 'refund', v_refund + case when v_booking.deposit_paid then v_booking.deposit_amount else 0 end, 'pending');
  end if;

  perform log_audit(auth.uid(), 'booking_cancelled_no_show', 'booking', p_booking_id, jsonb_build_object('reason', p_reason));
  perform notify_user(v_booking.renter_id, 'booking_cancelled', 'Your booking was cancelled: ' || p_reason, '/bookings', true);
end;
$$;

-- ============================================================
-- 6. report_owner_no_show -- the mirror image of #5: the renter is the one
--    left waiting. Unlike a renter no-show, this doesn't strike the owner
--    immediately -- it refunds in full right away (we're already holding
--    the money, no reason to make the renter wait) and opens a dispute so
--    an admin verifies fault before a strike lands, protecting owners from
--    a false claim.
-- ============================================================
create or replace function report_owner_no_show(p_booking_id uuid, p_description text default 'Owner did not show up for the scheduled pickup.')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
  v_pickup_ts timestamptz;
  v_refund numeric;
  v_dispute_id uuid;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.renter_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_booking.status not in ('downpayment_paid','fully_paid') then
    raise exception 'only applicable while a booking is awaiting pickup';
  end if;

  v_pickup_ts := (v_booking.start_date + v_booking.pickup_time) at time zone 'Asia/Manila';
  if now() < v_pickup_ts + (get_setting_int('no_show_grace_minutes') || ' minutes')::interval then
    raise exception 'the grace period after the scheduled pickup time has not elapsed yet';
  end if;

  v_refund := (case when v_booking.balance_paid then v_booking.total_price else v_booking.downpayment_amount end)
              + (case when v_booking.deposit_paid then v_booking.deposit_amount else 0 end);

  update bookings set status = 'owner_no_show', cancellation_reason = p_description where id = p_booking_id;

  insert into payments(booking_id, payer_id, payment_type, amount, status)
  values (p_booking_id, v_booking.renter_id, 'refund', v_refund, 'pending');

  insert into disputes(booking_id, reporter_id, description, status)
  values (p_booking_id, auth.uid(), p_description, 'open')
  returning id into v_dispute_id;

  perform log_audit(auth.uid(), 'owner_no_show_reported', 'booking', p_booking_id, jsonb_build_object('dispute_id', v_dispute_id));
  perform notify_user(v_booking.owner_id, 'owner_no_show_reported',
    'A renter reported that you did not show up for a scheduled pickup. This is under review and the renter has been refunded.',
    '/bookings-received', true);

  return v_dispute_id;
end;
$$;

grant execute on function report_owner_no_show(uuid, text) to authenticated;

-- ============================================================
-- 7. mark_complete -- owner-only single confirmation (the return-side
--    equivalent of confirm_handover), replacing the both-sides gate that
--    was the actual "hassle" being solved for. The renter no longer has
--    any completion action; their recourse if the owner won't confirm or
--    falsely claims damage is the existing Report an Issue -> dispute flow,
--    same as a delivery dispute overriding a rider's scan.
-- ============================================================
create or replace function mark_complete(p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.owner_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_booking.status <> 'active' then raise exception 'booking is not active'; end if;

  update bookings set status = 'completed', completed_at = now(), renter_completed = true, owner_completed = true
  where id = p_booking_id;

  perform log_audit(auth.uid(), 'booking_marked_complete', 'booking', p_booking_id, '{}'::jsonb);
  perform notify_user(v_booking.renter_id, 'booking_completed', 'Your rental is complete. Please leave a review.', '/bookings', true);
  perform notify_user(v_booking.owner_id, 'booking_completed', 'Rental complete — payout will be processed by admin.', '/bookings-received', true);
end;
$$;

-- ============================================================
-- 8. resolve_dispute -- admin can now optionally strike whichever party
--    was at fault as part of resolving (e.g. a confirmed owner no-show),
--    rather than striking automatically at report time. New signature,
--    so the old 3-arg overload is dropped explicitly.
-- ============================================================
drop function if exists resolve_dispute(uuid, text, numeric);

create or replace function resolve_dispute(
  p_dispute_id uuid, p_resolution_notes text, p_refund_amount numeric default 0, p_strike_profile_id uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_dispute disputes%rowtype;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  select * into v_dispute from disputes where id = p_dispute_id;
  update disputes set status = 'resolved', resolution_notes = p_resolution_notes,
                       resolved_by = auth.uid(), resolved_at = now()
  where id = p_dispute_id;

  if p_refund_amount > 0 then
    insert into payments(booking_id, payer_id, payment_type, amount, status)
    select id, renter_id, 'refund', p_refund_amount, 'pending' from bookings where id = v_dispute.booking_id;
  end if;

  if p_strike_profile_id is not null then
    perform add_strike(p_strike_profile_id, 'Dispute resolved against this account: ' || p_resolution_notes);
  end if;

  perform log_audit(auth.uid(), 'dispute_resolved', 'dispute', p_dispute_id,
                     jsonb_build_object('notes', p_resolution_notes, 'refund_amount', p_refund_amount, 'strike_profile_id', p_strike_profile_id));
end;
$$;

grant execute on function resolve_dispute(uuid, text, numeric, uuid) to authenticated;
