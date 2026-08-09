-- SafeDrive 2.0 -- make vehicle body types admin-editable, matching how
-- car_brands/car_models already work (panel feedback: body_type was one of
-- the few remaining hardcoded lists -- a fixed CHECK constraint of 9 values
-- with no way to add a 10th without a migration, unlike brands/models which
-- admins can already extend from Admin > Car Catalog).

create table car_body_types (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  default_seats integer not null,
  created_at    timestamptz not null default now()
);

alter table car_body_types enable row level security;
-- Same shape as car_brands (002_rls_policies.sql): anyone can read (needed
-- for the public Browse filter and Add Vehicle's body-type dropdown), only
-- admin can write.
create policy car_body_types_select_all on car_body_types for select using (true);
create policy car_body_types_admin_write on car_body_types for all using (is_admin()) with check (is_admin());

-- Seed with the exact 9 values/defaults that were previously hardcoded
-- (car_models_body_type_check, BODY_SEAT_DEFAULTS in catalog.tsx) so no
-- existing car_models row or frontend behavior changes.
insert into car_body_types (name, default_seats) values
  ('sedan', 5), ('coupe', 4), ('hatchback', 5), ('suv', 7),
  ('van', 12), ('pickup', 5), ('convertible', 4), ('wagon', 5), ('mpv', 7);

-- Swap the fixed CHECK constraint for an FK -- on update cascade so renaming
-- a type in the catalog updates every car_models row using it; no ON DELETE
-- clause means the default RESTRICT, so a type still used by a model can't
-- be deleted out from under it (same protection the CHECK gave implicitly).
alter table car_models drop constraint car_models_body_type_check;
alter table car_models add constraint car_models_body_type_fkey
  foreign key (body_type) references car_body_types(name) on update cascade;
