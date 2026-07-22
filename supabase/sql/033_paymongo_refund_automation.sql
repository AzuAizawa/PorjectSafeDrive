-- SafeDrive 2.0 — real PayMongo Refunds API automation for security deposit
-- refunds, replacing the fully-manual "click a button, admin actually wires
-- the money outside the app" flow (mark_deposit_refunded, 011).
--
-- The deposit is never its own separate PayMongo payment — create-checkout
-- bundles it into the downpayment charge (amount = downpayment + deposit).
-- So "refunding the deposit" means a PARTIAL refund of that original
-- downpayment payment via PayMongo's Refunds API, which supports refunding
-- less than the full amount. Refunds are asynchronous on PayMongo's side
-- (pending -> processing -> succeeded/failed), so this is a two-step flow
-- just like checkout: an Edge Function (process-refund) calls PayMongo and
-- records a 'pending' payments row, then the webhook handler confirms the
-- terminal status when PayMongo calls back.
--
-- mark_deposit_refunded() (011) is kept as-is for a manual fallback (e.g.
-- if a deposit was ever collected/returned outside PayMongo) — this adds
-- the automated path alongside it, it doesn't replace it.

create or replace function mark_deposit_refund_processing(p_booking_id uuid, p_refund_reference text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.status <> 'completed' then raise exception 'booking is not completed'; end if;
  if not v_booking.deposit_paid or v_booking.deposit_refunded then
    raise exception 'no deposit refund pending for this booking';
  end if;
  if exists (select 1 from payments where booking_id = p_booking_id and payment_type = 'refund' and status = 'pending') then
    raise exception 'a refund is already in progress for this booking';
  end if;

  insert into payments(booking_id, payer_id, payment_type, amount, paymongo_reference, status)
  values (p_booking_id, v_booking.renter_id, 'refund', v_booking.deposit_amount, p_refund_reference, 'pending');

  perform log_audit(auth.uid(), 'deposit_refund_initiated', 'booking', p_booking_id,
                     jsonb_build_object('amount', v_booking.deposit_amount, 'paymongo_refund_id', p_refund_reference));
end;
$$;

grant execute on function mark_deposit_refund_processing(uuid, text) to authenticated;

-- Finds the original downpayment payment's PayMongo payment id, so the
-- Edge Function knows what to pass as `payment_id` on the Refunds API call.
create or replace function get_downpayment_paymongo_reference(p_booking_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select paymongo_reference from payments
  where booking_id = p_booking_id and payment_type = 'downpayment' and status = 'succeeded'
  order by created_at desc limit 1;
$$;

grant execute on function get_downpayment_paymongo_reference(uuid) to authenticated;

-- Called by the webhook handler (service role) when PayMongo reports the
-- refund's terminal status. Idempotent — a replayed webhook event for an
-- already-resolved refund is a no-op rather than a double-apply.
create or replace function confirm_deposit_refund_result(p_paymongo_refund_id text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_payment payments%rowtype;
begin
  select * into v_payment from payments where paymongo_reference = p_paymongo_refund_id and payment_type = 'refund';
  if v_payment.id is null then raise exception 'refund payment record not found for %', p_paymongo_refund_id; end if;
  if v_payment.status <> 'pending' then return; end if;

  update payments set status = p_status where id = v_payment.id;

  if p_status = 'succeeded' then
    update bookings set deposit_refunded = true where id = v_payment.booking_id;
    perform notify_user(v_payment.payer_id, 'deposit_refunded', 'Your security deposit refund has been processed.', '/bookings', true);
  elsif p_status = 'failed' then
    perform notify_user(
      v_payment.payer_id, 'deposit_refund_failed',
      'Your deposit refund could not be processed automatically — our team has been notified and will follow up.',
      '/bookings', true
    );
  end if;
end;
$$;
