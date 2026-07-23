-- SafeDrive 2.0 -- add a structured city field, replacing free-text
-- pickup_location as the thing renters actually filter by. Deliberately a
-- plain CHECK constraint enum (same pattern as body_type/fuel_type on
-- car_models), not a separate admin-managed catalog table like
-- car_brands/car_models -- unlike car models, PH cities/municipalities are
-- an essentially fixed set that doesn't need routine admin curation, and
-- carry no per-row derived metadata the way a car model does (seats, body
-- type, fuel type). If a genuinely new city is ever needed, that's a rare,
-- legislative-level event handled by a code change, not a data-entry task.
--
-- Scoped to Metro Manila's 17 cities/municipality plus a handful of
-- immediately adjacent cities, with an 'other' catch-all for anything
-- outside that list -- honest about not enumerating the whole country
-- rather than silently miscategorizing a listing. Existing vehicles default
-- to 'other' since we have no reliable way to infer their actual city from
-- the free-text pickup_location already on file; owners can correct it via
-- Edit Vehicle.

alter table vehicles add column city text not null default 'other' check (city in (
  'manila', 'quezon_city', 'caloocan', 'las_pinas', 'makati', 'malabon', 'mandaluyong',
  'marikina', 'muntinlupa', 'navotas', 'paranaque', 'pasay', 'pasig', 'san_juan',
  'taguig', 'valenzuela', 'pateros',
  'antipolo', 'bacoor', 'imus', 'dasmarinas', 'san_pedro', 'santa_rosa', 'san_jose_del_monte',
  'other'
));

create index idx_vehicles_city on vehicles(city);
