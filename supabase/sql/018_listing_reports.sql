-- SafeDrive 2.0 — "Report this listing" (distinct from booking disputes):
-- any logged-in user browsing can flag a listing (fake photos, misleading
-- info) even without having booked it. Doesn't auto-hide the listing —
-- just queues it for admin/support re-review.

create table listing_reports (
  id            uuid primary key default gen_random_uuid(),
  vehicle_id    uuid not null references vehicles(id) on delete cascade,
  reporter_id   uuid not null references profiles(id),
  reason        text not null,
  status        text not null default 'open' check (status in ('open', 'resolved')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references profiles(id)
);

create index idx_listing_reports_status on listing_reports(status);
create index idx_listing_reports_vehicle on listing_reports(vehicle_id);

alter table listing_reports enable row level security;

create policy listing_reports_select on listing_reports
  for select using (reporter_id = auth.uid() or is_support_or_admin());

create policy listing_reports_insert on listing_reports
  for insert with check (reporter_id = auth.uid());

create policy listing_reports_resolve on listing_reports
  for update using (is_support_or_admin());

create or replace function resolve_listing_report(p_report_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_support_or_admin() then raise exception 'not authorized'; end if;
  update listing_reports set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
  where id = p_report_id;
  perform log_audit(auth.uid(), 'listing_report_resolved', 'listing_report', p_report_id, '{}'::jsonb);
end;
$$;

grant execute on function resolve_listing_report(uuid) to authenticated;
