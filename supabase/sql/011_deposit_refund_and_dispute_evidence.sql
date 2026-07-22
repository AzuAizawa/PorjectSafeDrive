-- SafeDrive 2.0 — two gaps found while building the admin Payments/Disputes pages

-- ============================================================
-- Deposit refund (decisions doc §7: admin manually refunds deposit
-- on completion with no open dispute). No RPC existed for this yet.
-- ============================================================
create or replace function mark_deposit_refunded(p_booking_id uuid)
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

  update bookings set deposit_refunded = true where id = p_booking_id;

  insert into payments(booking_id, payer_id, payment_type, amount, status)
  values (p_booking_id, v_booking.renter_id, 'refund', v_booking.deposit_amount, 'succeeded');

  perform log_audit(auth.uid(), 'deposit_refunded', 'booking', p_booking_id,
                     jsonb_build_object('amount', v_booking.deposit_amount));
end;
$$;

grant execute on function mark_deposit_refunded(uuid) to authenticated;

-- ============================================================
-- Dispute evidence bucket — disputes.photo_paths existed with nowhere to
-- actually store the files. Private: only the booking's participants + admin.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('dispute-evidence', 'dispute-evidence', false, 5 * 1024 * 1024, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Path convention: dispute-evidence/{booking_id}/{filename}
create policy dispute_evidence_participant on storage.objects
  for all using (
    bucket_id = 'dispute-evidence'
    and (is_booking_participant((storage.foldername(name))[1]::uuid) or is_admin())
  ) with check (
    bucket_id = 'dispute-evidence'
    and is_booking_participant((storage.foldername(name))[1]::uuid)
  );
