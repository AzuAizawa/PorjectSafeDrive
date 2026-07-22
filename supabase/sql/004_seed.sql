-- SafeDrive 2.0 — Seed data: default platform_settings + starter car catalog

insert into platform_settings (key, value, description) values
  ('commission_percent',        '10',  'Platform commission % of base_price, added on top for the renter'),
  ('downpayment_percent',       '50',  '% of total_price due upfront to lock in a booking'),
  ('owner_response_hours',      '24',  'Hours an owner has to accept/reject a booking request'),
  ('payment_deadline_hours',    '24',  'Hours a renter has to pay the downpayment after acceptance'),
  ('free_cancel_hours',         '24',  'Free-cancellation window after downpayment is paid'),
  ('cancellation_fee_percent',  '20',  'Fee % of total_price charged on late cancellation'),
  ('auto_complete_grace_days',  '2',   'Days after end_date before an undisputed active booking auto-completes'),
  ('free_vehicle_slots',        '5',   'Free listing slots per lister'),
  ('subscription_price',        '399', 'PHP price per subscription period for extra slots'),
  ('subscription_slots',        '15',  'Extra slots granted per active subscription'),
  ('max_deposit_percent',       '30',  'Cap on owner-set security deposit as % of total_price'),
  ('demerit_strike_threshold',  '3',   'Strikes before an account is auto-flagged for admin review')
on conflict (key) do nothing;

-- Starter catalog — matches the seats-by-body-type table in the original spec.
-- Admin can add more brands/models from the Car Catalog tab.
insert into car_brands (name) values ('Toyota'), ('Honda'), ('Ford')
on conflict (name) do nothing;

insert into car_models (brand_id, name, body_type, seats, fuel_type)
select b.id, m.name, m.body_type, m.seats, m.fuel_type
from car_brands b
join (values
  ('Toyota', 'Vios',   'sedan', 5, 'gasoline'),
  ('Toyota', 'Fortuner','suv',  7, 'diesel'),
  ('Toyota', 'Innova', 'mpv',   7, 'diesel'),
  ('Honda',  'Civic',  'sedan', 5, 'gasoline'),
  ('Honda',  'CR-V',   'suv',   7, 'gasoline'),
  ('Ford',   'Ranger', 'pickup',5, 'diesel')
) as m(brand_name, name, body_type, seats, fuel_type)
  on b.name = m.brand_name
on conflict (brand_id, name) do nothing;
