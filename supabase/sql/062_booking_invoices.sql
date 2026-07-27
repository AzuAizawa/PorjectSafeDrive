-- SafeDrive 2.0 -- printable booking invoices with a real sequential
-- invoice number.
--
-- All the underlying pricing/payment data already existed (request_booking's
-- base_price/commission/total_price math, confirm_downpayment_paid /
-- confirm_balance_paid's payments rows, cancel_booking's persisted refund
-- row) -- this just adds the one missing piece: a stable invoice number
-- assigned the moment a booking becomes a real paid transaction (first
-- downpayment), not at booking-request time (a rejected/expired request
-- was never a transaction and shouldn't consume an invoice number).

create sequence invoice_number_seq;
alter table bookings add column invoice_number text;

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
    status = 'downpayment_paid',
    invoice_number = 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 6, '0')
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

-- Backfill: bookings that already reached downpayment_paid before this
-- migration get a number too, so "View Invoice" isn't only available for
-- bookings paid from today onward. Numbered in chronological order using
-- each booking's real downpayment_paid_at for the year portion, so a
-- backfilled invoice looks historically accurate rather than all dated "now".
update bookings set invoice_number = sub.num from (
  select id, 'INV-' || to_char(downpayment_paid_at, 'YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 6, '0') as num
  from bookings where downpayment_paid = true and invoice_number is null
  order by downpayment_paid_at
) sub where bookings.id = sub.id;
