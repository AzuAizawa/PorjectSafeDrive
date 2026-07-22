-- SafeDrive 2.0 — Row Level Security
--
-- Design principle: RLS is row-level, not column-level. Sensitive fields
-- (driver_license_number, national_id_number, ID/selfie images) are kept in
-- verification_submissions — a table the booking counterpart never queries —
-- rather than relying on column-level tricks inside `profiles`.
--
-- Design principle #2: any write that has business logic attached to it
-- (booking state transitions, payments, payouts, audit entries) is NOT
-- exposed via a direct table policy for regular users. Those go through
-- SECURITY DEFINER functions in 003_functions.sql, which are the only
-- code path allowed to perform them. Direct table RLS for those tables
-- only grants SELECT to participants/admin. This prevents a renter from,
-- say, PATCHing their own booking's `status` straight to 'completed'.

-- ============================================================
-- HELPER: is_admin()
-- SECURITY DEFINER + STABLE so it can be used inside other tables' RLS
-- policies without recursively re-triggering RLS on `profiles`.
-- ============================================================
create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function is_booking_participant(p_booking_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from bookings
    where id = p_booking_id
      and (renter_id = auth.uid() or owner_id = auth.uid())
  );
$$;

-- ============================================================
-- PROFILES
-- ============================================================
alter table profiles enable row level security;

create policy profiles_select_own on profiles
  for select using (id = auth.uid());

create policy profiles_select_admin on profiles
  for select using (is_admin());

-- Renter <-> owner can see each other's shareable identity fields
-- (name/phone/address/birthday) once a booking relationship exists between
-- them. Sensitive numbers/images are not on this table, so this is safe.
create policy profiles_select_booking_counterpart on profiles
  for select using (
    exists (
      select 1 from bookings b
      where (b.renter_id = auth.uid() and b.owner_id = profiles.id)
         or (b.owner_id = auth.uid() and b.renter_id = profiles.id)
    )
  );

-- Anyone booking-eligible needs to see a lister's name on a car detail page
create policy profiles_select_vehicle_owner on profiles
  for select using (
    exists (
      select 1 from vehicles v
      where v.owner_id = profiles.id
        and v.approval_status = 'approved'
        and v.listing_status = 'active'
    )
  );

create policy profiles_update_own on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_update_admin on profiles
  for update using (is_admin());

-- Lock down fields a user must never self-grant, even though they own the row.
create or replace function protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    new.role            := old.role;
    new.verified_status := old.verified_status;
    new.account_status  := old.account_status;
    new.strike_count    := old.strike_count;
    new.account_flagged := old.account_flagged;
    -- is_lister IS allowed to change (renter <-> lister mode switch is a user action)
  end if;
  return new;
end;
$$;

create trigger trg_protect_profile_fields
  before update on profiles
  for each row execute function protect_profile_fields();

-- ============================================================
-- VERIFICATION SUBMISSIONS
-- ============================================================
alter table verification_submissions enable row level security;

create policy verification_select_own on verification_submissions
  for select using (profile_id = auth.uid());

create policy verification_select_admin on verification_submissions
  for select using (is_admin());

create policy verification_insert_own on verification_submissions
  for insert with check (profile_id = auth.uid());

-- Users can never update a submission once made (resubmission = new row);
-- only admin can update (to record review outcome).
create policy verification_update_admin on verification_submissions
  for update using (is_admin());

-- ============================================================
-- CAR CATALOG
-- ============================================================
alter table car_brands enable row level security;
alter table car_models enable row level security;

create policy car_brands_select_all on car_brands for select using (true);
create policy car_brands_admin_write on car_brands for all using (is_admin()) with check (is_admin());

create policy car_models_select_all on car_models for select using (true);
create policy car_models_admin_write on car_models for all using (is_admin()) with check (is_admin());

-- ============================================================
-- VEHICLES
-- ============================================================
alter table vehicles enable row level security;

create policy vehicles_select_public on vehicles
  for select using (approval_status = 'approved' and listing_status = 'active');

create policy vehicles_select_owner on vehicles
  for select using (owner_id = auth.uid());

create policy vehicles_select_admin on vehicles
  for select using (is_admin());

create policy vehicles_insert_owner on vehicles
  for insert with check (
    owner_id = auth.uid()
    and exists (select 1 from profiles where id = auth.uid() and verified_status = 'verified')
  );

create policy vehicles_update_owner on vehicles
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy vehicles_update_admin on vehicles
  for update using (is_admin());

-- Instant-editable fields (price, location, etc.) apply immediately.
-- Sensitive fields (plate_number, orcr_path, model_id) force re-review.
-- Non-admins cannot self-grant approval_status/rejection_reason otherwise.
create or replace function protect_vehicle_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    if new.plate_number is distinct from old.plate_number
       or new.orcr_path is distinct from old.orcr_path
       or new.model_id is distinct from old.model_id then
      new.approval_status  := 'pending';
      new.rejection_reason := null;
    else
      new.approval_status  := old.approval_status;
      new.rejection_reason := old.rejection_reason;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_protect_vehicle_fields
  before update on vehicles
  for each row execute function protect_vehicle_fields();

-- ============================================================
-- VEHICLE IMAGES
-- ============================================================
alter table vehicle_images enable row level security;

create policy vehicle_images_select on vehicle_images
  for select using (
    exists (
      select 1 from vehicles v
      where v.id = vehicle_images.vehicle_id
        and (
          (v.approval_status = 'approved' and v.listing_status = 'active')
          or v.owner_id = auth.uid()
          or is_admin()
        )
    )
  );

create policy vehicle_images_manage_owner on vehicle_images
  for all using (
    exists (select 1 from vehicles v where v.id = vehicle_images.vehicle_id and v.owner_id = auth.uid())
  ) with check (
    exists (select 1 from vehicles v where v.id = vehicle_images.vehicle_id and v.owner_id = auth.uid())
  );

create policy vehicle_images_admin on vehicle_images
  for all using (is_admin());

-- ============================================================
-- BOOKINGS
-- Writes only via SECURITY DEFINER RPC functions (003_functions.sql).
-- Regular users get SELECT only.
-- ============================================================
alter table bookings enable row level security;

create policy bookings_select_participant on bookings
  for select using (renter_id = auth.uid() or owner_id = auth.uid());

create policy bookings_select_admin on bookings
  for select using (is_admin());

create policy bookings_admin_write on bookings
  for update using (is_admin());
-- Intentionally no insert/update policy for regular authenticated users —
-- all state transitions go through request_booking()/accept_booking()/etc.

-- ============================================================
-- PAYMENTS
-- Writes only via webhook handler (service role) and RPC functions.
-- ============================================================
alter table payments enable row level security;

create policy payments_select_own on payments
  for select using (payer_id = auth.uid());

create policy payments_select_admin on payments
  for select using (is_admin());

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================
alter table subscriptions enable row level security;

create policy subscriptions_select_own on subscriptions
  for select using (profile_id = auth.uid());

create policy subscriptions_select_admin on subscriptions
  for select using (is_admin());

-- ============================================================
-- PLATFORM SETTINGS
-- Business-rule numbers are not secret; readable by anyone so the frontend
-- can display accurate pricing before login. Writes are admin-only.
-- ============================================================
alter table platform_settings enable row level security;

create policy platform_settings_select_all on platform_settings
  for select using (true);

create policy platform_settings_admin_write on platform_settings
  for all using (is_admin()) with check (is_admin());

-- ============================================================
-- AUDIT TRAIL
-- Written exclusively by SECURITY DEFINER functions; admin-read only.
-- ============================================================
alter table audit_trail enable row level security;

create policy audit_select_admin on audit_trail
  for select using (is_admin());

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
alter table notifications enable row level security;

create policy notifications_select_own on notifications
  for select using (user_id = auth.uid());

create policy notifications_update_own on notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Insert happens via SECURITY DEFINER functions/triggers only.

-- ============================================================
-- MESSAGES (booking chat)
-- Simple enough to allow direct client read/insert, gated by participation
-- and by the booking having progressed past acceptance.
-- ============================================================
alter table messages enable row level security;

create policy messages_select_participant on messages
  for select using (is_booking_participant(booking_id) or is_admin());

create policy messages_insert_participant on messages
  for insert with check (
    sender_id = auth.uid()
    and is_booking_participant(booking_id)
    and exists (
      select 1 from bookings b
      where b.id = booking_id
        and b.status not in ('pending_owner','owner_rejected','expired')
    )
  );

-- ============================================================
-- REVIEWS
-- ============================================================
alter table reviews enable row level security;

create policy reviews_select_public on reviews
  for select using (is_hidden = false);

create policy reviews_select_own on reviews
  for select using (reviewer_id = auth.uid() or reviewee_id = auth.uid());

create policy reviews_select_admin on reviews
  for select using (is_admin());

create policy reviews_insert_participant on reviews
  for insert with check (
    reviewer_id = auth.uid()
    and is_booking_participant(booking_id)
    and exists (select 1 from bookings b where b.id = booking_id and b.status = 'completed')
    and reviewee_id in (select renter_id from bookings where id = booking_id
                        union select owner_id from bookings where id = booking_id)
    and reviewee_id <> auth.uid()
  );

create policy reviews_moderate_admin on reviews
  for update using (is_admin());

-- ============================================================
-- DISPUTES
-- ============================================================
alter table disputes enable row level security;

create policy disputes_select_participant on disputes
  for select using (is_booking_participant(booking_id));

create policy disputes_select_admin on disputes
  for select using (is_admin());

create policy disputes_insert_participant on disputes
  for insert with check (reporter_id = auth.uid() and is_booking_participant(booking_id));

create policy disputes_resolve_admin on disputes
  for update using (is_admin());
