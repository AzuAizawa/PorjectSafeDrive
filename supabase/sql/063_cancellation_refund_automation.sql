-- SafeDrive 2.0 -- close a real gap found while building booking invoices:
-- cancel_booking() (037_pickup_time_meetup_and_calendar.sql) correctly
-- computes and inserts a 'refund' payments row for a cancelled booking, but
-- nothing in the system ever processed it -- no automated PayMongo call
-- (process-refund was hard-scoped to completed/deposit refunds only) and no
-- admin UI surfaced it at all (Send Payments only ever queried
-- deposit-specific refund rows). A cancelled renter/owner had no path to
-- actually get their money back.
--
-- Mirrors the existing deposit-refund automation (033) exactly: an
-- Edge Function calls PayMongo's real Refunds API and records 'processing',
-- a webhook confirms the terminal result, and a manual "mark sent" fallback
-- stays available for cases handled outside PayMongo -- same pattern this
-- codebase already uses, not a new one.

-- Marks the *already-existing* pending refund row (inserted by cancel_booking
-- at cancellation time) as now in-flight via a real PayMongo refund, rather
-- than inserting a new row -- unlike the deposit flow, cancel_booking()
-- already recorded the amount owed synchronously at cancellation time.
create or replace function mark_cancellation_refund_processing(p_booking_id uuid, p_refund_reference text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
  v_payment payments%rowtype;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.status not in ('cancelled_by_renter', 'cancelled_by_owner') then
    raise exception 'booking is not in a cancelled state';
  end if;

  select * into v_payment from payments
    where booking_id = p_booking_id and payment_type = 'refund' and status = 'pending' and paymongo_reference is null
    order by created_at desc limit 1;
  if v_payment.id is null then
    raise exception 'no cancellation refund pending for this booking';
  end if;

  update payments set paymongo_reference = p_refund_reference where id = v_payment.id;

  perform log_audit(auth.uid(), 'cancellation_refund_initiated', 'booking', p_booking_id,
                     jsonb_build_object('amount', v_payment.amount, 'paymongo_refund_id', p_refund_reference));
end;
$$;

grant execute on function mark_cancellation_refund_processing(uuid, text) to authenticated;

-- Manual fallback (parallel to mark_deposit_refunded / mark_payout_sent) --
-- for a cancellation refund sent outside PayMongo, or one whose amount
-- exceeds what the automated path can refund from a single original charge
-- (see process-refund's own guard for that case).
create or replace function mark_cancellation_refund_sent(p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
  v_payment payments%rowtype;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.status not in ('cancelled_by_renter', 'cancelled_by_owner') then
    raise exception 'booking is not in a cancelled state';
  end if;

  select * into v_payment from payments
    where booking_id = p_booking_id and payment_type = 'refund' and status = 'pending'
    order by created_at desc limit 1;
  if v_payment.id is null then raise exception 'no cancellation refund pending for this booking'; end if;

  update payments set status = 'succeeded' where id = v_payment.id;
  update bookings set deposit_refunded = true where id = p_booking_id and deposit_paid = true;

  perform log_audit(auth.uid(), 'cancellation_refund_sent_manually', 'booking', p_booking_id,
                     jsonb_build_object('amount', v_payment.amount));
end;
$$;

grant execute on function mark_cancellation_refund_sent(uuid) to authenticated;

-- confirm_deposit_refund_result generalized: the PayMongo refund.updated
-- webhook fires identically for a deposit refund and a cancellation refund
-- (same event type, same 'refund' payment_type row) -- the handler has no
-- way to know which case it's confirming, so one function must handle both.
-- Renamed (not just edited) since the old name is now misleading; the
-- webhook Edge Function is updated in the same deploy to call the new name.
drop function if exists confirm_deposit_refund_result(text, text);

create or replace function confirm_refund_result(p_paymongo_refund_id text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_payment payments%rowtype;
begin
  select * into v_payment from payments where paymongo_reference = p_paymongo_refund_id and payment_type = 'refund';
  if v_payment.id is null then raise exception 'refund payment record not found for %', p_paymongo_refund_id; end if;
  if v_payment.status <> 'pending' then return; end if;

  update payments set status = p_status where id = v_payment.id;

  if p_status = 'succeeded' then
    -- Safe to always set: a no-op when the booking never had a deposit
    -- (deposit_paid stays false, so this WHERE clause simply matches
    -- nothing extra), correct when it did -- a cancellation refund already
    -- bundles the deposit back in full (see cancel_booking's own insert),
    -- so this stops the deposit separately showing as still-owed afterward.
    update bookings set deposit_refunded = true where id = v_payment.booking_id and deposit_paid = true;
    perform notify_user(v_payment.payer_id, 'refund_processed', 'Your refund has been processed.', '/bookings', true);
  elsif p_status = 'failed' then
    perform notify_user(
      v_payment.payer_id, 'refund_failed',
      'Your refund could not be processed automatically — our team has been notified and will follow up.',
      '/bookings', true
    );
  end if;
end;
$$;
