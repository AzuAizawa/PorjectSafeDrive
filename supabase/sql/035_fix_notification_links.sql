-- SafeDrive 2.0 -- fix a systemic bug: every renter-facing notification
-- (accept_booking, reject_booking, cancel_booking, cancel_no_show,
-- confirm_handover, mark_complete) linked to '/my-bookings', which has
-- never been a real route -- the actual route is '/bookings'
-- (see App.tsx: <Route path="bookings" element={<MyBookingsPage />} />).
-- Clicking almost any renter notification silently bounced them to
-- Browse via the catch-all route instead of showing their booking.
-- Found by cross-checking every notify_user() link literal against the
-- real route table. Each function body below is the exact live
-- definition pulled via pg_get_functiondef with only the link string
-- corrected -- no other logic touched.

CREATE OR REPLACE FUNCTION public.accept_booking(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  perform notify_user(v_booking.renter_id, 'booking_accepted', 'Your booking request was accepted. Please pay the downpayment.', '/bookings', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    perform notify_user(v_booking.renter_id, 'booking_cancelled', 'The owner cancelled your booking. You will be fully refunded.', '/bookings', true);
  end if;

  if v_refund > 0 then
    insert into payments(booking_id, payer_id, payment_type, amount, status)
    values (p_booking_id, v_booking.renter_id, 'refund', v_refund + case when v_booking.deposit_paid then v_booking.deposit_amount else 0 end, 'pending');
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_no_show(p_booking_id uuid, p_reason text DEFAULT 'renter did not pay balance at meetup'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  perform notify_user(v_booking.renter_id, 'booking_cancelled', 'Your booking was cancelled: ' || p_reason, '/bookings', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_handover(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  perform notify_user(v_booking.renter_id, 'rental_started', 'Your rental is now active. Drive safe!', '/bookings', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_complete(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  update bookings set status = 'completed', completed_at = now()
  where id = p_booking_id and renter_completed and owner_completed;

  perform log_audit(auth.uid(), 'booking_marked_complete', 'booking', p_booking_id, '{}'::jsonb);

  if (select status from bookings where id = p_booking_id) = 'completed' then
    perform notify_user(v_booking.renter_id, 'booking_completed', 'Your rental is complete. Please leave a review.', '/bookings', true);
    perform notify_user(v_booking.owner_id, 'booking_completed', 'Rental complete — payout will be processed by admin.', '/bookings-received', true);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reject_booking(p_booking_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.owner_id <> auth.uid() then raise exception 'not authorized'; end if;
  if v_booking.status <> 'pending_owner' then raise exception 'booking is not awaiting owner response'; end if;

  update bookings set status = 'owner_rejected', cancellation_reason = p_reason where id = p_booking_id;

  perform log_audit(auth.uid(), 'booking_rejected', 'booking', p_booking_id, jsonb_build_object('reason', p_reason));
  perform notify_user(v_booking.renter_id, 'booking_rejected', 'Your booking request was declined.', '/bookings', true);
end;
$function$;

