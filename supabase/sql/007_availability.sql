-- SafeDrive 2.0 — Browse Cars date-availability filter (decisions doc §12)
-- Returns vehicle ids that are publicly listed AND have no booking overlapping
-- the given date range in a status that locks the dates.

create or replace function available_vehicle_ids(p_start date, p_end date)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select v.id
  from vehicles v
  where v.approval_status = 'approved'
    and v.listing_status = 'active'
    and not exists (
      select 1 from bookings b
      where b.vehicle_id = v.id
        and b.status in ('pending_payment', 'downpayment_paid', 'fully_paid', 'active')
        and daterange(b.start_date, b.end_date, '[]') && daterange(p_start, p_end, '[]')
    );
$$;

grant execute on function available_vehicle_ids(date, date) to authenticated, anon;
