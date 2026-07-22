-- SafeDrive 2.0 — Company Info module
-- Kept separate from platform_settings deliberately: that table is
-- numeric business rules (percentages, hour windows, thresholds) and the
-- existing Admin Settings page assumes every value there is a number.
-- Contact details are text, shown to every user (the emergency banner),
-- and edited by admin as a distinct concern — a real "module," not a
-- string awkwardly wedged into the numeric settings UI.

create table company_info (
  key         text primary key,
  value       text not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id)
);

alter table company_info enable row level security;

-- Readable by anyone logged in (the emergency banner needs it on any
-- active-booking screen); writes are full-admin-only, same sensitivity
-- tier as platform_settings.
create policy company_info_select_all on company_info
  for select using (true);

create policy company_info_admin_write on company_info
  for all using (is_admin()) with check (is_admin());

-- Left blank deliberately — no placeholder email/phone. The frontend shows
-- "not yet configured" until admin actually fills these in via the module,
-- rather than displaying a fabricated-looking contact that isn't real.
insert into company_info (key, value, description) values
  ('support_email', '', 'Shown on the Help page and in the emergency-contact banner'),
  ('support_phone', '', 'Shown in the emergency-contact banner on active-rental screens'),
  ('emergency_note', 'If this is a real emergency, contact your local emergency services first.', 'Extra line shown under the contact details in the emergency banner')
on conflict (key) do nothing;
