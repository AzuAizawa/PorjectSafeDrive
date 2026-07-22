-- SafeDrive 2.0 — make the PayMongo webhook handlers idempotent
--
-- Bug: if PayMongo retries a webhook delivery (network hiccup, timeout —
-- this happens in production), these functions found the booking already
-- past the expected status and raised an exception. The Edge Function
-- returned that as a 500, which PayMongo reads as "delivery failed" and
-- keeps retrying — likely indefinitely. No data-corruption risk (the
-- status check correctly prevented double-processing), just needless
-- retry noise from a webhook that looks broken.
--
-- Fix: check whether this *exact* paymongo_reference was already recorded
-- as this payment_type first. If so, it's a duplicate delivery of an
-- already-handled event — return successfully (no-op) instead of raising.
-- A genuinely wrong-state call (different reason, not a retry) still raises.

create or replace function confirm_downpayment_paid(p_booking_id uuid, p_paymongo_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
begin
  if exists (select 1 from payments where paymongo_reference = p_paymongo_ref and payment_type = 'downpayment') then
    return; -- already processed this exact event
  end if;

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
  if exists (select 1 from payments where paymongo_reference = p_paymongo_ref and payment_type = 'balance') then
    return;
  end if;

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

create or replace function confirm_subscription_payment(p_profile_id uuid, p_paymongo_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_slots int := get_setting_int('subscription_slots');
  v_price numeric := get_setting_numeric('subscription_price');
  v_sub_id uuid;
begin
  if exists (select 1 from payments where paymongo_reference = p_paymongo_ref and payment_type = 'subscription') then
    return;
  end if;

  insert into subscriptions (profile_id, slots_granted, status, started_at, expires_at, paymongo_reference)
  values (p_profile_id, v_slots, 'active', now(), now() + interval '1 month', p_paymongo_ref)
  returning id into v_sub_id;

  insert into payments (subscription_id, payer_id, payment_type, amount, paymongo_reference, status)
  values (v_sub_id, p_profile_id, 'subscription', v_price, p_paymongo_ref, 'succeeded');

  update vehicles set listing_status = 'active'
  where id in (
    select id from vehicles
    where owner_id = p_profile_id and listing_status = 'paused_over_quota'
    order by updated_at desc
    limit v_slots
  );

  perform log_audit(p_profile_id, 'subscription_purchased', 'subscription', v_sub_id,
                     jsonb_build_object('slots_granted', v_slots, 'paymongo_ref', p_paymongo_ref));
  perform notify_user(p_profile_id, 'subscription_active', 'Your subscription is active — extra vehicle slots unlocked.', '/my-vehicles', true);
end;
$$;
