-- SafeDrive 2.0 — Business Logic (SECURITY DEFINER RPC functions + cron jobs)
--
-- Every booking state transition lives here, not in application code, so it
-- can't be bypassed by a direct table PATCH (see 002_rls_policies.sql notes).
-- The frontend calls these via supabase.rpc('function_name', {...}).

-- ============================================================
-- SMALL HELPERS
-- ============================================================
create or replace function get_setting_numeric(p_key text)
returns numeric language sql stable as $$
  select (value #>> '{}')::numeric from platform_settings where key = p_key;
$$;

create or replace function get_setting_int(p_key text)
returns integer language sql stable as $$
  select (value #>> '{}')::integer from platform_settings where key = p_key;
$$;

create or replace function log_audit(
  p_actor uuid, p_action text, p_entity_type text, p_entity_id uuid, p_details jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into audit_trail(actor_id, action, entity_type, entity_id, details)
  values (p_actor, p_action, p_entity_type, p_entity_id, p_details);
end;
$$;

-- notify_user: always creates an in-app notification; optionally dispatches
-- email for time-sensitive events via an Edge Function (through pg_net),
-- per decisions doc §14. The edge function URL + service key are read from
-- Vault/config — placeholders below, wire up once the project is provisioned.
create or replace function notify_user(
  p_user_id uuid, p_type text, p_message text, p_link text default null, p_send_email boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into notifications(user_id, type, message, link)
  values (p_user_id, p_type, p_message, p_link)
  returning id into v_id;

  if p_send_email then
    perform net.http_post(
      url := current_setting('app.settings.send_email_function_url', true),
      headers := jsonb_build_object('Content-Type', 'application/json',
                                     'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)),
      body := jsonb_build_object('user_id', p_user_id, 'type', p_type, 'message', p_message)
    );
  end if;
end;
$$;

-- ============================================================
-- NEW USER -> PROFILE (trigger on auth.users)
-- ============================================================
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, role, verified_status, is_lister)
  values (new.id, new.email, 'user', 'unverified', false);
  return new;
end;
$$;

create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- VERIFICATION REVIEW (admin actions)
-- ============================================================
create or replace function approve_verification(p_submission_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_profile_id uuid;
  v_sub record;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

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
  if not is_admin() then raise exception 'not authorized'; end if;

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

-- ============================================================
-- VEHICLE APPROVAL (admin actions)
-- ============================================================
create or replace function approve_vehicle(p_vehicle_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

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
  if not is_admin() then raise exception 'not authorized'; end if;

  update vehicles set approval_status = 'rejected', rejection_reason = p_reason
    where id = p_vehicle_id
    returning owner_id into v_owner;

  perform log_audit(auth.uid(), 'vehicle_rejected', 'vehicle', p_vehicle_id, jsonb_build_object('reason', p_reason));
  perform notify_user(v_owner, 'vehicle_rejected', 'Your vehicle listing was rejected: ' || p_reason, '/my-vehicles', true);
end;
$$;

-- ============================================================
-- BOOKING: REQUEST
-- ============================================================
create or replace function request_booking(p_vehicle_id uuid, p_start_date date, p_end_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_vehicle vehicles%rowtype;
  v_renter_verified text;
  v_total_days int;
  v_base numeric; v_commission numeric; v_total numeric; v_downpayment numeric; v_balance numeric;
  v_booking_id uuid;
begin
  select verified_status into v_renter_verified from profiles where id = auth.uid();
  if v_renter_verified <> 'verified' then
    raise exception 'must be verified to book a vehicle';
  end if;

  select * into v_vehicle from vehicles where id = p_vehicle_id;
  if v_vehicle.approval_status <> 'approved' or v_vehicle.listing_status <> 'active' then
    raise exception 'vehicle is not available for booking';
  end if;

  if p_end_date <= p_start_date then
    raise exception 'end_date must be after start_date';
  end if;

  -- block requesting dates already locked in by an accepted/paid booking
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
-- BOOKING: OWNER ACCEPT / REJECT
-- ============================================================
create or replace function accept_booking(p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.owner_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_booking.status <> 'pending_owner' then raise exception 'booking is not awaiting owner response'; end if;

  update bookings set
    status = 'pending_payment',
    payment_deadline = now() + (get_setting_int('payment_deadline_hours') || ' hours')::interval
  where id = p_booking_id;

  -- auto-reject any other pending request on this vehicle with overlapping dates
  update bookings set
    status = 'owner_rejected',
    cancellation_reason = 'dates no longer available'
  where vehicle_id = v_booking.vehicle_id
    and id <> p_booking_id
    and status = 'pending_owner'
    and daterange(start_date, end_date, '[]') && daterange(v_booking.start_date, v_booking.end_date, '[]');

  perform log_audit(auth.uid(), 'booking_accepted', 'booking', p_booking_id, '{}'::jsonb);
  perform notify_user(v_booking.renter_id, 'booking_accepted', 'Your booking request was accepted. Please pay the downpayment.', '/my-bookings', true);
end;
$$;

create or replace function reject_booking(p_booking_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.owner_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_booking.status <> 'pending_owner' then raise exception 'booking is not awaiting owner response'; end if;

  update bookings set status = 'owner_rejected', cancellation_reason = p_reason where id = p_booking_id;

  perform log_audit(auth.uid(), 'booking_rejected', 'booking', p_booking_id, jsonb_build_object('reason', p_reason));
  perform notify_user(v_booking.renter_id, 'booking_rejected', 'Your booking request was declined.', '/my-bookings', true);
end;
$$;

-- ============================================================
-- BOOKING: CANCELLATION (renter or owner, before 'active')
-- ============================================================
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
    -- free if nothing paid yet, or still within the free-cancel window
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
    -- owner cancelling an accepted booking: full refund, owner takes a strike
    v_refund := v_paid;
    update bookings set status = 'cancelled_by_owner', cancellation_reason = p_reason where id = p_booking_id;
    update profiles set strike_count = strike_count + 1 where id = v_booking.owner_id;
    perform flag_account_if_over_threshold(v_booking.owner_id);
    perform log_audit(auth.uid(), 'booking_cancelled_by_owner', 'booking', p_booking_id,
                       jsonb_build_object('refund', v_refund));
    perform notify_user(v_booking.renter_id, 'booking_cancelled', 'The owner cancelled your booking. You will be fully refunded.', '/my-bookings', true);
  end if;

  -- refund (and deposit return, if any) recorded for admin to action manually via PayMongo
  if v_refund > 0 then
    insert into payments(booking_id, payer_id, payment_type, amount, status)
    values (p_booking_id, v_booking.renter_id, 'refund', v_refund + case when v_booking.deposit_paid then v_booking.deposit_amount else 0 end, 'pending');
  end if;
end;
$$;

-- ============================================================
-- BOOKING: NO-SHOW / UNPAID AT MEETUP (owner action)
-- ============================================================
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
  update profiles set strike_count = strike_count + 1 where id = v_booking.renter_id;
  perform flag_account_if_over_threshold(v_booking.renter_id);

  if v_refund > 0 then
    insert into payments(booking_id, payer_id, payment_type, amount, status)
    values (p_booking_id, v_booking.renter_id, 'refund', v_refund, 'pending');
  end if;

  perform log_audit(auth.uid(), 'booking_cancelled_no_show', 'booking', p_booking_id, jsonb_build_object('reason', p_reason));
  perform notify_user(v_booking.renter_id, 'booking_cancelled', 'Your booking was cancelled: ' || p_reason, '/my-bookings', true);
end;
$$;

create or replace function flag_account_if_over_threshold(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles set account_flagged = true
  where id = p_profile_id and strike_count >= get_setting_int('demerit_strike_threshold');
end;
$$;

-- ============================================================
-- BOOKING: HANDOVER (owner confirms at pickup, requires balance paid)
-- ============================================================
create or replace function confirm_handover(p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.owner_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_booking.status <> 'fully_paid' then
    raise exception 'balance must be fully paid before handover can be confirmed';
  end if;

  update bookings set status = 'active' where id = p_booking_id;
  perform log_audit(auth.uid(), 'booking_handover_confirmed', 'booking', p_booking_id, '{}'::jsonb);
  perform notify_user(v_booking.renter_id, 'rental_started', 'Your rental is now active. Drive safe!', '/my-bookings', false);
end;
$$;

-- ============================================================
-- BOOKING: MARK COMPLETE (either party; both required)
-- ============================================================
create or replace function mark_complete(p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if auth.uid() not in (v_booking.renter_id, v_booking.owner_id) then raise exception 'not authorized'; end if;
  if v_booking.status <> 'active' then raise exception 'booking is not active'; end if;

  if auth.uid() = v_booking.renter_id then
    update bookings set renter_completed = true where id = p_booking_id;
  else
    update bookings set owner_completed = true where id = p_booking_id;
  end if;

  update bookings set status = 'completed'
  where id = p_booking_id and renter_completed and owner_completed;

  perform log_audit(auth.uid(), 'booking_marked_complete', 'booking', p_booking_id, '{}'::jsonb);

  if (select status from bookings where id = p_booking_id) = 'completed' then
    perform notify_user(v_booking.renter_id, 'booking_completed', 'Your rental is complete. Please leave a review.', '/my-bookings', true);
    perform notify_user(v_booking.owner_id, 'booking_completed', 'Rental complete — payout will be processed by admin.', '/bookings-received', true);
  end if;
end;
$$;

-- ============================================================
-- DISPUTES: ADMIN RESOLUTION
-- ============================================================
create or replace function resolve_dispute(p_dispute_id uuid, p_resolution_notes text, p_refund_amount numeric default 0)
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

  perform log_audit(auth.uid(), 'dispute_resolved', 'dispute', p_dispute_id,
                     jsonb_build_object('notes', p_resolution_notes, 'refund_amount', p_refund_amount));
end;
$$;

-- ============================================================
-- ADMIN: SUSPEND / BAN / CLEAR STRIKES
-- ============================================================
create or replace function set_account_status(p_profile_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('active','suspended','banned') then raise exception 'invalid status'; end if;

  update profiles set account_status = p_status where id = p_profile_id;
  perform log_audit(auth.uid(), 'account_status_changed', 'user', p_profile_id, jsonb_build_object('status', p_status));
end;
$$;

create or replace function clear_strikes(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  update profiles set strike_count = 0, account_flagged = false where id = p_profile_id;
  perform log_audit(auth.uid(), 'strikes_cleared', 'user', p_profile_id, '{}'::jsonb);
end;
$$;

-- ============================================================
-- ADMIN: MARK PAYOUT / DEPOSIT REFUND SENT
-- ============================================================
create or replace function mark_payout_sent(p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.status <> 'completed' then raise exception 'booking is not completed'; end if;

  insert into payments(booking_id, payer_id, payment_type, amount, status)
  values (p_booking_id, v_booking.owner_id, 'payout', v_booking.base_price, 'succeeded');

  perform log_audit(auth.uid(), 'payout_sent', 'booking', p_booking_id, jsonb_build_object('amount', v_booking.base_price));
end;
$$;

-- ============================================================
-- SCHEDULED JOBS (called directly by pg_cron — pure SQL, no HTTP needed)
-- ============================================================
create or replace function expire_stale_bookings()
returns void language plpgsql security definer set search_path = public as $$
begin
  update bookings set status = 'expired'
  where status = 'pending_owner' and owner_response_deadline < now();

  update bookings set status = 'expired'
  where status = 'pending_payment' and payment_deadline < now();

  perform log_audit(null, 'bookings_auto_expired', 'booking', null,
                     jsonb_build_object('run_at', now()));
end;
$$;

create or replace function auto_complete_bookings()
returns void language plpgsql security definer set search_path = public as $$
begin
  update bookings b set
    renter_completed = true, owner_completed = true, status = 'completed'
  where b.status = 'active'
    and (b.end_date + (get_setting_int('auto_complete_grace_days') || ' days')::interval) <= now()
    and not exists (select 1 from disputes d where d.booking_id = b.id and d.status = 'open');

  perform log_audit(null, 'bookings_auto_completed', 'booking', null,
                     jsonb_build_object('run_at', now()));
end;
$$;

select cron.schedule('expire-stale-bookings', '0 * * * *', $$select expire_stale_bookings();$$);
select cron.schedule('auto-complete-bookings', '0 3 * * *', $$select auto_complete_bookings();$$);

-- ============================================================
-- PAYMENT WEBHOOK ENTRY POINTS
-- Called by the PayMongo webhook Edge Function AFTER verifying the
-- webhook signature (see decisions doc §17 — this is a hard requirement,
-- not optional). The Edge Function uses the service_role key, which
-- bypasses RLS entirely, so these do not need to be SECURITY DEFINER,
-- but are marked so anyway for defense in depth and consistent auth checks.
-- ============================================================
create or replace function confirm_downpayment_paid(p_booking_id uuid, p_paymongo_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.status <> 'pending_payment' then raise exception 'booking not awaiting downpayment'; end if;

  update bookings set
    downpayment_paid = true, downpayment_paid_at = now(),
    deposit_paid = (deposit_amount > 0), deposit_paid_at = case when deposit_amount > 0 then now() else null end,
    status = 'downpayment_paid'
  where id = p_booking_id;

  insert into payments(booking_id, payer_id, payment_type, amount, paymongo_reference, status)
  values (p_booking_id, v_booking.renter_id, 'downpayment', v_booking.downpayment_amount, p_paymongo_ref, 'succeeded');

  if v_booking.deposit_amount > 0 then
    insert into payments(booking_id, payer_id, payment_type, amount, paymongo_reference, status)
    values (p_booking_id, v_booking.renter_id, 'deposit', v_booking.deposit_amount, p_paymongo_ref, 'succeeded');
  end if;

  perform log_audit(v_booking.renter_id, 'downpayment_paid', 'booking', p_booking_id, jsonb_build_object('paymongo_ref', p_paymongo_ref));
  perform notify_user(v_booking.owner_id, 'downpayment_received', 'Downpayment received for a booking.', '/bookings-received', false);
end;
$$;

create or replace function confirm_balance_paid(p_booking_id uuid, p_paymongo_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.status <> 'downpayment_paid' then raise exception 'downpayment must be paid first'; end if;

  update bookings set balance_paid = true, balance_paid_at = now(), status = 'fully_paid'
  where id = p_booking_id;

  insert into payments(booking_id, payer_id, payment_type, amount, paymongo_reference, status)
  values (p_booking_id, v_booking.renter_id, 'balance', v_booking.balance_amount, p_paymongo_ref, 'succeeded');

  perform log_audit(v_booking.renter_id, 'balance_paid', 'booking', p_booking_id, jsonb_build_object('paymongo_ref', p_paymongo_ref));
  perform notify_user(v_booking.owner_id, 'balance_received', 'Balance payment received — ready for handover.', '/bookings-received', true);
end;
$$;
