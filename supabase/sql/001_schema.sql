-- SafeDrive 2.0 — Core Schema
-- Run in order: 001_schema.sql -> 002_rls_policies.sql -> 003_functions.sql -> 004_seed.sql

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_cron;    -- scheduled jobs (see 003_functions.sql)
create extension if not exists pg_net;     -- pg_cron -> edge function http calls

-- ============================================================
-- PROFILES
-- ============================================================
-- Deliberately holds only "shareable in context of a booking" identity fields
-- (name, phone, address, birthday). Government ID numbers and document images
-- live in verification_submissions instead, so a booking counterpart (renter
-- <-> owner) can be granted visibility into `profiles` without ever exposing
-- driver's license / national ID numbers. See 002_rls_policies.sql.
create table profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text not null,
  first_name        text,
  middle_name       text,
  last_name         text,
  phone             text,
  address           text,
  birthday          date,
  role              text not null default 'user' check (role in ('user','admin')),
  is_lister         boolean not null default false,
  verified_status   text not null default 'unverified'
                      check (verified_status in ('unverified','pending','verified','rejected')),
  account_status    text not null default 'active'
                      check (account_status in ('active','suspended','banned')),
  strike_count      integer not null default 0,
  account_flagged   boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_profiles_role on profiles(role);
create index idx_profiles_verified_status on profiles(verified_status);

-- ============================================================
-- VERIFICATION SUBMISSIONS  (one row per attempt -> preserves resubmission history)
-- ============================================================
create table verification_submissions (
  id                        uuid primary key default gen_random_uuid(),
  profile_id                uuid not null references profiles(id) on delete cascade,
  first_name                text not null,
  middle_name               text,
  last_name                 text not null,
  phone                     text not null,
  address                   text not null,
  birthday                  date not null,
  driver_license_number     text not null,
  national_id_number        text not null,
  license_front_path        text not null,
  license_back_path         text not null,
  national_id_front_path    text not null,
  national_id_back_path     text not null,
  selfie_with_id_path       text not null,
  selfie_face_path          text not null,
  status                    text not null default 'pending'
                              check (status in ('pending','verified','rejected')),
  rejection_reason          text,
  submitted_at              timestamptz not null default now(),
  reviewed_at               timestamptz,
  reviewed_by               uuid references profiles(id)
);

create index idx_verification_profile on verification_submissions(profile_id, submitted_at desc);
create index idx_verification_status on verification_submissions(status);

-- ============================================================
-- CAR CATALOG (admin-managed)
-- ============================================================
create table car_brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table car_models (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references car_brands(id) on delete cascade,
  name        text not null,
  body_type   text not null check (body_type in
                ('sedan','suv','hatchback','van','pickup','coupe','convertible','wagon','mpv')),
  seats       integer not null,
  fuel_type   text not null check (fuel_type in ('gasoline','diesel','electric','hybrid')),
  created_at  timestamptz not null default now(),
  unique (brand_id, name)
);

-- ============================================================
-- VEHICLES
-- ============================================================
-- approval_status: admin's legal/identity check gate (public visibility gate)
-- listing_status:  owner's own visibility toggle + system-driven subscription enforcement
-- Both must be 'approved' + 'active' for a car to appear on public Browse.
create table vehicles (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references profiles(id) on delete cascade,
  model_id              uuid not null references car_models(id),
  plate_number          text not null,
  mileage               integer not null,
  daily_price           numeric(10,2) not null check (daily_price > 0),
  pickup_location       text not null,
  additional_info       text,
  owner_contact_number  text not null,
  orcr_path             text not null,              -- private bucket, admin-only
  rental_agreement_path text,                        -- public-readable sub-path
  requires_deposit      boolean not null default false,
  deposit_amount        numeric(10,2),
  approval_status       text not null default 'pending'
                          check (approval_status in ('pending','approved','rejected')),
  rejection_reason      text,
  listing_status        text not null default 'active'
                          check (listing_status in ('active','paused_by_owner','paused_over_quota')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint chk_deposit_requires_amount
    check (not requires_deposit or deposit_amount is not null)
);

create index idx_vehicles_owner on vehicles(owner_id);
create index idx_vehicles_public on vehicles(approval_status, listing_status);

create table vehicle_images (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  storage_path text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index idx_vehicle_images_vehicle on vehicle_images(vehicle_id, sort_order);

-- ============================================================
-- BOOKINGS
-- ============================================================
create table bookings (
  id                      uuid primary key default gen_random_uuid(),
  vehicle_id              uuid not null references vehicles(id),
  renter_id               uuid not null references profiles(id),
  owner_id                uuid not null references profiles(id),   -- denormalized for RLS/query simplicity
  start_date              date not null,
  end_date                date not null,
  total_days              integer not null check (total_days > 0),

  base_price              numeric(10,2) not null,
  commission              numeric(10,2) not null,
  total_price             numeric(10,2) not null,
  downpayment_amount      numeric(10,2) not null,
  balance_amount          numeric(10,2) not null,
  deposit_amount          numeric(10,2) not null default 0,

  downpayment_paid        boolean not null default false,
  downpayment_paid_at     timestamptz,
  balance_paid            boolean not null default false,
  balance_paid_at         timestamptz,
  deposit_paid            boolean not null default false,
  deposit_paid_at         timestamptz,
  deposit_refunded        boolean not null default false,

  status                  text not null default 'pending_owner' check (status in (
                             'pending_owner','owner_rejected','expired',
                             'pending_payment','downpayment_paid','fully_paid',
                             'active','completed',
                             'cancelled_by_renter','cancelled_by_owner','cancelled_no_show'
                           )),
  cancellation_reason     text,

  owner_response_deadline timestamptz,
  payment_deadline        timestamptz,

  renter_completed        boolean not null default false,
  owner_completed         boolean not null default false,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint chk_dates check (end_date >= start_date)
);

create index idx_bookings_renter on bookings(renter_id);
create index idx_bookings_owner on bookings(owner_id);
create index idx_bookings_vehicle_dates on bookings(vehicle_id, start_date, end_date);
create index idx_bookings_status on bookings(status);

-- ============================================================
-- PAYMENTS
-- ============================================================
create table payments (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid references bookings(id),
  subscription_id     uuid,   -- FK added after subscriptions table below
  payer_id            uuid not null references profiles(id),
  payment_type        text not null check (payment_type in
                        ('downpayment','balance','deposit','payout','refund','subscription')),
  amount              numeric(10,2) not null,
  paymongo_reference  text,
  status              text not null default 'pending' check (status in ('pending','succeeded','failed')),
  created_at          timestamptz not null default now()
);

-- ============================================================
-- SUBSCRIPTIONS (extra vehicle slots)
-- ============================================================
create table subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references profiles(id),
  slots_granted       integer not null,
  status              text not null default 'active' check (status in ('active','expired','cancelled')),
  started_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  paymongo_reference  text,
  created_at          timestamptz not null default now()
);

alter table payments add constraint fk_payments_subscription
  foreign key (subscription_id) references subscriptions(id);

create index idx_subscriptions_profile on subscriptions(profile_id, status);

-- ============================================================
-- PLATFORM SETTINGS (dynamic config — see decisions doc §1)
-- ============================================================
create table platform_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id)
);

-- ============================================================
-- AUDIT TRAIL
-- ============================================================
create table audit_trail (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references profiles(id),   -- null = system/cron action
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  details      jsonb,
  created_at   timestamptz not null default now()
);

create index idx_audit_entity on audit_trail(entity_type, entity_id);
create index idx_audit_created on audit_trail(created_at desc);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  type        text not null,
  message     text not null,
  link        text,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index idx_notifications_user on notifications(user_id, read, created_at desc);

-- ============================================================
-- MESSAGES (in-booking chat)
-- ============================================================
create table messages (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings(id) on delete cascade,
  sender_id   uuid not null references profiles(id),
  message     text not null,
  created_at  timestamptz not null default now()
);

create index idx_messages_booking on messages(booking_id, created_at);

-- ============================================================
-- REVIEWS
-- ============================================================
create table reviews (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings(id),
  reviewer_id   uuid not null references profiles(id),
  reviewee_id   uuid not null references profiles(id),
  rating        integer not null check (rating between 1 and 5),
  comment       text,
  is_hidden     boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (booking_id, reviewer_id)
);

create index idx_reviews_reviewee on reviews(reviewee_id, is_hidden);

-- ============================================================
-- DISPUTES
-- ============================================================
create table disputes (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references bookings(id),
  reporter_id       uuid not null references profiles(id),
  description       text not null,
  photo_paths       text[] not null default '{}',
  status            text not null default 'open' check (status in ('open','resolved')),
  resolution_notes  text,
  resolved_by       uuid references profiles(id),
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz
);

create index idx_disputes_status on disputes(status);
create index idx_disputes_booking on disputes(booking_id);

-- ============================================================
-- updated_at trigger (generic)
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger trg_vehicles_updated_at before update on vehicles
  for each row execute function set_updated_at();
create trigger trg_bookings_updated_at before update on bookings
  for each row execute function set_updated_at();
