-- SafeDrive 2.0 -- automated GCash owner payouts via PayMongo's Disbursements
-- API (v2/batch_transfers), confirmed available on this account with no
-- special approval needed (per PayMongo support).
--
-- Scope deliberately narrow: owner payout details are free-text today
-- (bank_name is a typed field, never validated against PayMongo's actual
-- institution list) -- auto-matching that against PayMongo's real bank list
-- is fragile and risks a misdirected transfer. GCash is a single fixed
-- institution, so only GCash payouts get automated here; bank-transfer
-- payouts keep the existing fully-manual mark_payout_sent() flow untouched.
-- Same automate-the-safe-case-keep-a-manual-fallback pattern already used
-- for deposit refunds (033) and cancellation refunds (063).

-- PayMongo's own go-live checklist for this API calls for tracking three
-- separate identifiers for reconciliation: their transfer id (reuses the
-- existing paymongo_reference column), our own idempotency reference_number
-- (generated before the request, so a retried call can't double-send), and
-- the bank rail's own provider_reference_number (only arrives later, via
-- the payout.paid webhook).
alter table payments add column reference_number text;
alter table payments add column provider_reference_number text;

-- Records a payout as now in-flight via a real PayMongo transfer. Unlike
-- mark_payout_sent() (which inserts directly as 'succeeded' for the manual
-- path), this inserts 'pending' -- the webhook confirms the real outcome.
create or replace function mark_payout_processing(p_booking_id uuid, p_transfer_id text, p_reference_number text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.status <> 'completed' then raise exception 'booking is not completed'; end if;
  if exists (select 1 from payments where booking_id = p_booking_id and payment_type = 'payout') then
    raise exception 'a payout already exists for this booking';
  end if;

  insert into payments(booking_id, payer_id, payment_type, amount, paymongo_reference, reference_number, status)
  values (p_booking_id, v_booking.owner_id, 'payout', v_booking.base_price, p_transfer_id, p_reference_number, 'pending');

  perform log_audit(auth.uid(), 'payout_initiated', 'booking', p_booking_id,
                     jsonb_build_object('amount', v_booking.base_price, 'transfer_id', p_transfer_id));
end;
$$;

grant execute on function mark_payout_processing(uuid, text, text) to authenticated;

-- Called by the webhook handler when PayMongo reports a payout's terminal
-- status (payout.paid / payout.failed). Idempotent, same pattern as
-- confirm_refund_result -- a replayed webhook event is a no-op.
create or replace function confirm_payout_result(p_transfer_id text, p_status text, p_provider_reference_number text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_payment payments%rowtype;
begin
  select * into v_payment from payments where paymongo_reference = p_transfer_id and payment_type = 'payout';
  if v_payment.id is null then raise exception 'payout payment record not found for %', p_transfer_id; end if;
  if v_payment.status <> 'pending' then return; end if;

  update payments set status = p_status, provider_reference_number = coalesce(p_provider_reference_number, provider_reference_number)
  where id = v_payment.id;

  if p_status = 'succeeded' then
    perform notify_user(v_payment.payer_id, 'payout_processed', 'Your payout has been sent to your GCash account.', '/my-vehicles', true);
  elsif p_status = 'failed' then
    perform notify_user(
      v_payment.payer_id, 'payout_failed',
      'Your payout could not be sent automatically — our team has been notified and will follow up.',
      '/my-vehicles', true
    );
  end if;
end;
$$;
