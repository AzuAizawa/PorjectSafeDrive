-- SafeDrive 2.0 — lightweight rate limiting on abuse-prone actions.
--
-- No rate limiting existed anywhere in the app layer (Supabase Auth's own
-- endpoints — signup/login/password-reset — already rate-limit themselves
-- server-side; this covers our own RPCs/tables, which had nothing). A
-- simple per-user-per-action cooldown table + helper, enforced via a guard
-- inside request_booking() and BEFORE INSERT triggers on the direct-insert
-- chat/report tables (RLS with-check clauses should stay side-effect-free,
-- so a trigger is the right place for something that also writes a row).

create table action_cooldowns (
  user_id     uuid not null references profiles(id) on delete cascade,
  action      text not null,
  last_at     timestamptz not null default now(),
  primary key (user_id, action)
);
-- No client-facing RLS policies at all — only SECURITY DEFINER functions
-- touch this table, same pattern as booking/payment state.
alter table action_cooldowns enable row level security;

create or replace function enforce_cooldown(p_user_id uuid, p_action text, p_seconds int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_last timestamptz;
begin
  select last_at into v_last from action_cooldowns where user_id = p_user_id and action = p_action for update;
  if v_last is not null and now() < v_last + (p_seconds || ' seconds')::interval then
    raise exception 'Please wait a moment before trying again.';
  end if;
  insert into action_cooldowns (user_id, action, last_at) values (p_user_id, p_action, now())
    on conflict (user_id, action) do update set last_at = now();
end;
$$;

-- request_booking: 10s between booking requests (accidental double-submit
-- + scripted-spam guard; a genuine renter never needs to fire two requests
-- within 10 seconds of each other). Identical to the current definition in
-- 015_ban_evasion_age_limits_support_role.sql, with only the cooldown line
-- added — every other line is unchanged to avoid regressing that logic.
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

-- Chat/report cooldown trigger — 2s between chat messages (throttles
-- scripted flooding without getting in the way of normal typing speed),
-- 60s between listing reports (there's never a legitimate reason to
-- re-report the same or another listing within a minute). Staff replying
-- in support chat are exempt so admin work never gets throttled.
create or replace function trg_enforce_action_cooldown()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_TABLE_NAME = 'messages' then
    perform enforce_cooldown(new.sender_id, 'chat_message', 2);
  elsif TG_TABLE_NAME = 'support_messages' then
    if not is_support_or_admin() then
      perform enforce_cooldown(new.sender_id, 'support_message', 2);
    end if;
  elsif TG_TABLE_NAME = 'listing_reports' then
    perform enforce_cooldown(new.reporter_id, 'listing_report', 60);
  end if;
  return new;
end;
$$;

create trigger trg_messages_cooldown before insert on messages
  for each row execute function trg_enforce_action_cooldown();
create trigger trg_support_messages_cooldown before insert on support_messages
  for each row execute function trg_enforce_action_cooldown();
create trigger trg_listing_reports_cooldown before insert on listing_reports
  for each row execute function trg_enforce_action_cooldown();
