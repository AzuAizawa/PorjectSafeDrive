-- SafeDrive 2.0 -- closing dead-end gaps found while cross-checking every
-- notify_user() link against the page it lands on:
--
-- 1. resolve_dispute() never notified anyone. A renter/owner who files a
--    report via Report an Issue had no way to ever learn it was resolved --
--    no notification, and no renter/owner-facing page shows dispute status
--    at all (disputes.tsx is admin-only). Fixed by notifying both the
--    reporter and the other booking party, and by having the frontend read
--    disputes directly (disputes_select_participant, 002_rls_policies.sql,
--    already permits this -- no RLS change needed).
--
-- 2. The same function inserted a dispute-driven refund as payment_type
--    'refund', status 'pending' -- but nothing in this codebase ever
--    transitions that row forward. The PayMongo refund automation (033) is
--    specifically for the security deposit (it reverses the exact original
--    downpayment charge); a dispute refund is an arbitrary admin-decided
--    amount for an arbitrary reason, not something that pipeline applies to.
--    Recorded as 'succeeded' immediately instead -- the same admin-attested
--    trust model this codebase already uses for mark_deposit_refunded()'s
--    manual/out-of-band fallback -- so it isn't a permanently stuck ledger
--    entry with no execution path.
--
-- 3. reject_booking()'s notification never included the reason, even though
--    the owner is already required (frontend ConfirmDialog + requireReason)
--    to give one and it's already stored in cancellation_reason. Brought in
--    line with reject_vehicle()/reject_verification(), which both already
--    include the reason inline in the notification text.

create or replace function resolve_dispute(p_dispute_id uuid, p_resolution_notes text, p_refund_amount numeric default 0)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_dispute disputes%rowtype;
  v_booking bookings%rowtype;
  v_other_party uuid;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  select * into v_dispute from disputes where id = p_dispute_id;
  if v_dispute.id is null then raise exception 'dispute not found'; end if;
  if v_dispute.status <> 'open' then raise exception 'dispute is already resolved'; end if;

  select * into v_booking from bookings where id = v_dispute.booking_id;

  update disputes set status = 'resolved', resolution_notes = p_resolution_notes,
                       resolved_by = auth.uid(), resolved_at = now()
  where id = p_dispute_id;

  if p_refund_amount > 0 then
    insert into payments(booking_id, payer_id, payment_type, amount, status)
    values (v_dispute.booking_id, v_booking.renter_id, 'refund', p_refund_amount, 'succeeded');
  end if;

  perform log_audit(auth.uid(), 'dispute_resolved', 'dispute', p_dispute_id,
                     jsonb_build_object('notes', p_resolution_notes, 'refund_amount', p_refund_amount));

  v_other_party := case when v_dispute.reporter_id = v_booking.renter_id then v_booking.owner_id else v_booking.renter_id end;

  perform notify_user(v_dispute.reporter_id, 'dispute_resolved',
    'Your reported issue was resolved: ' || p_resolution_notes,
    case when v_dispute.reporter_id = v_booking.renter_id then '/bookings' else '/bookings-received' end, true);
  perform notify_user(v_other_party, 'dispute_resolved',
    'A reported issue on one of your bookings was resolved: ' || p_resolution_notes,
    case when v_other_party = v_booking.renter_id then '/bookings' else '/bookings-received' end, true);
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
  perform notify_user(v_booking.renter_id, 'booking_rejected',
    'Your booking request was declined: ' || coalesce(p_reason, 'no reason given'), '/bookings', true);
end;
$$;
