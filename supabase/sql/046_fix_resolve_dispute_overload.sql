-- SafeDrive 2.0 -- correcting a mistake in 045.
--
-- 045 redefined resolve_dispute(uuid, text, numeric) to add the missing
-- notifications and fix the stuck-pending refund status. But that 3-arg
-- signature was already dead: 037_pickup_time_meetup_and_calendar.sql had
-- replaced it with a 4-arg overload (adding p_strike_profile_id) and
-- explicitly dropped the 3-arg one in the same migration. admin/disputes.tsx
-- has only ever called the 4-arg version. Postgres treats different
-- argument signatures as different functions, so 045's `create or replace`
-- didn't touch the real one -- it just resurrected a dead duplicate that
-- nothing calls, while the actual production path stayed unfixed.
--
-- Verified live after 045 landed: `select prosrc from pg_proc where proname
-- = 'resolve_dispute'` returned two rows, confirming both overloads existed
-- simultaneously. This drops the accidental duplicate and applies the real
-- fix (reporter/other-party notifications, refund recorded as 'succeeded'
-- instead of a permanently stuck 'pending') to the actual 4-arg function,
-- preserving 037's strike-on-resolution logic exactly as-is.

drop function if exists resolve_dispute(uuid, text, numeric);

create or replace function resolve_dispute(
  p_dispute_id uuid, p_resolution_notes text, p_refund_amount numeric default 0, p_strike_profile_id uuid default null
)
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

  if p_strike_profile_id is not null then
    perform add_strike(p_strike_profile_id, 'Dispute resolved against this account: ' || p_resolution_notes);
  end if;

  perform log_audit(auth.uid(), 'dispute_resolved', 'dispute', p_dispute_id,
                     jsonb_build_object('notes', p_resolution_notes, 'refund_amount', p_refund_amount, 'strike_profile_id', p_strike_profile_id));

  v_other_party := case when v_dispute.reporter_id = v_booking.renter_id then v_booking.owner_id else v_booking.renter_id end;

  perform notify_user(v_dispute.reporter_id, 'dispute_resolved',
    'Your reported issue was resolved: ' || p_resolution_notes,
    case when v_dispute.reporter_id = v_booking.renter_id then '/bookings' else '/bookings-received' end, true);
  perform notify_user(v_other_party, 'dispute_resolved',
    'A reported issue on one of your bookings was resolved: ' || p_resolution_notes,
    case when v_other_party = v_booking.renter_id then '/bookings' else '/bookings-received' end, true);
end;
$$;

revoke execute on function resolve_dispute(uuid, text, numeric, uuid) from public, anon;
grant execute on function resolve_dispute(uuid, text, numeric, uuid) to authenticated;
