-- SafeDrive 2.0 -- add transmission, a genuinely missing vehicle attribute.
-- Confirmed by reading the schema: body_type/seats/fuel_type live on
-- car_models (fixed per model name), but transmission isn't determined by
-- model name alone -- the same "Toyota Vios" listing exists in both manual
-- and automatic trims in the real PH market, so this belongs on vehicles
-- (per-listing), not car_models (shared across every listing of that model).
--
-- Not added to protect_vehicle_fields()'s sensitive-field list: unlike
-- plate_number/model_id/model_year, transmission isn't read by any
-- eligibility/legal check (max vehicle age, LTO plate format) -- it's purely
-- informational, so an owner fixing a data-entry mistake shouldn't have to
-- go through re-approval for it.

alter table vehicles add column transmission text not null default 'automatic'
  check (transmission in ('manual', 'automatic'));
