-- SafeDrive 2.0 -- let a renter/owner see their booking counterpart's
-- basic contact info (name + phone) by clicking their avatar.
--
-- profiles_select_booking_counterpart (002) already lets either party read
-- the other's full row (name/phone/address/birthday) the moment ANY
-- booking relationship exists, with no status gate. Rather than build the
-- UI straight on top of that broad grant, this RPC is deliberately
-- narrower on both axes the user asked to tighten:
--   1. Fields: only first_name/last_name/phone -- no address (pickup/
--      drop-off location on the vehicle already covers where the handoff
--      happens) and no birthday.
--   2. Timing: only once the owner has actually accepted (status is past
--      'pending_owner'/'owner_rejected'/'expired') -- not on a still-
--      pending request that might get rejected, so contact info isn't
--      handed out on requests that never become a real booking.

create or replace function get_booking_counterpart_contact(p_booking_id uuid)
returns table(first_name text, last_name text, phone text)
language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
  v_counterpart_id uuid;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'booking not found'; end if;

  if auth.uid() = v_booking.renter_id then
    v_counterpart_id := v_booking.owner_id;
  elsif auth.uid() = v_booking.owner_id then
    v_counterpart_id := v_booking.renter_id;
  else
    raise exception 'not authorized';
  end if;

  if v_booking.status in ('pending_owner', 'owner_rejected', 'expired') then
    raise exception 'contact info is available once the owner accepts';
  end if;

  return query select p.first_name, p.last_name, p.phone from profiles p where p.id = v_counterpart_id;
end;
$$;

revoke execute on function get_booking_counterpart_contact(uuid) from public, anon;
grant execute on function get_booking_counterpart_contact(uuid) to authenticated;
