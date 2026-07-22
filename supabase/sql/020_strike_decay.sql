-- SafeDrive 2.0 — strike decay
--
-- profiles.strike_count was a single integer with no notion of "when" a
-- strike happened, so it couldn't decay by time. Replaced with a proper
-- strikes table (one row per event); decay is evaluated by only counting
-- rows within the decay window, not by a background job that would need
-- to run just because time passed. profiles.strike_count / account_flagged
-- stay as a fast-read cache, refreshed at the moment a strike is added or
-- cleared — the only two events that can change them anyway.

create table strikes (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  reason      text not null,
  created_at  timestamptz not null default now()
);

create index idx_strikes_profile on strikes(profile_id, created_at);

alter table strikes enable row level security;

create policy strikes_select on strikes
  for select using (profile_id = auth.uid() or is_support_or_admin());

insert into platform_settings (key, value, description) values
  ('strike_decay_months', '6', 'Strikes older than this stop counting toward the auto-flag threshold')
on conflict (key) do nothing;

create or replace function get_active_strike_count(p_profile_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from strikes
  where profile_id = p_profile_id
    and created_at > now() - (get_setting_int('strike_decay_months') || ' months')::interval;
$$;

create or replace function add_strike(p_profile_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_active_count int;
begin
  insert into strikes(profile_id, reason) values (p_profile_id, p_reason);

  v_active_count := get_active_strike_count(p_profile_id);
  update profiles set
    strike_count = v_active_count,
    account_flagged = account_flagged or (v_active_count >= get_setting_int('demerit_strike_threshold'))
  where id = p_profile_id;
end;
$$;

-- clear_strikes now actually clears the history, not just the cached
-- counter, so decay has nothing stale left to recompute from later.
create or replace function clear_strikes(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  delete from strikes where profile_id = p_profile_id;
  update profiles set strike_count = 0, account_flagged = false where id = p_profile_id;
  perform log_audit(auth.uid(), 'strikes_cleared', 'user', p_profile_id, '{}'::jsonb);
end;
$$;

-- flag_account_if_over_threshold is superseded by add_strike's own check,
-- but kept for anything still calling it (a no-op if strikes was already
-- inserted via add_strike).
create or replace function flag_account_if_over_threshold(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles set account_flagged = true
  where id = p_profile_id and get_active_strike_count(p_profile_id) >= get_setting_int('demerit_strike_threshold');
end;
$$;

-- Swap the two direct increments over to add_strike().
create or replace function cancel_booking(p_booking_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
  v_is_renter boolean;
  v_fee numeric := 0;
  v_paid numeric := 0;
  v_refund numeric := 0;
begin
  select * into v_booking from bookings where id = p_booking_id;

  if auth.uid() = v_booking.renter_id then v_is_renter := true;
  elsif auth.uid() = v_booking.owner_id then v_is_renter := false;
  else raise exception 'not authorized'; end if;

  if v_booking.status not in ('pending_owner','pending_payment','downpayment_paid','fully_paid') then
    raise exception 'booking can no longer be self-cancelled at this stage';
  end if;

  v_paid := case when v_booking.balance_paid then v_booking.total_price
                 when v_booking.downpayment_paid then v_booking.downpayment_amount
                 else 0 end;

  if v_is_renter then
    if v_booking.downpayment_paid_at is null
       or now() <= v_booking.downpayment_paid_at + (get_setting_int('free_cancel_hours') || ' hours')::interval
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
    perform notify_user(v_booking.renter_id, 'booking_cancelled', 'The owner cancelled your booking. You will be fully refunded.', '/my-bookings', true);
  end if;

  if v_refund > 0 then
    insert into payments(booking_id, payer_id, payment_type, amount, status)
    values (p_booking_id, v_booking.renter_id, 'refund', v_refund + case when v_booking.deposit_paid then v_booking.deposit_amount else 0 end, 'pending');
  end if;
end;
$$;

create or replace function cancel_no_show(p_booking_id uuid, p_reason text default 'renter did not pay balance at meetup')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
  v_fee numeric;
  v_refund numeric;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.owner_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_booking.status <> 'downpayment_paid' then
    raise exception 'only applicable when balance was never paid before meetup';
  end if;

  v_fee := v_booking.total_price * (get_setting_numeric('cancellation_fee_percent') / 100);
  v_refund := greatest(v_booking.downpayment_amount - v_fee, 0);

  update bookings set status = 'cancelled_no_show', cancellation_reason = p_reason where id = p_booking_id;
  perform add_strike(v_booking.renter_id, 'Did not pay balance at meetup');

  if v_refund > 0 then
    insert into payments(booking_id, payer_id, payment_type, amount, status)
    values (p_booking_id, v_booking.renter_id, 'refund', v_refund, 'pending');
  end if;

  perform log_audit(auth.uid(), 'booking_cancelled_no_show', 'booking', p_booking_id, jsonb_build_object('reason', p_reason));
  perform notify_user(v_booking.renter_id, 'booking_cancelled', 'Your booking was cancelled: ' || p_reason, '/my-bookings', true);
end;
$$;

grant execute on function get_active_strike_count(uuid) to authenticated;
