-- SafeDrive 2.0 — Storage buckets + object-level policies
--
-- Path conventions (enforced by the upload code, relied on by these policies):
--   car-images/{vehicle_id}/{filename}
--   user-verification/{profile_id}/{filename}
--   vehicle-documents/{vehicle_id}/orcr/{filename}
--   vehicle-documents/{vehicle_id}/rental-agreement/{filename}

insert into storage.buckets (id, name, public) values
  ('car-images', 'car-images', true),
  ('user-verification', 'user-verification', false),
  ('vehicle-documents', 'vehicle-documents', false)
on conflict (id) do nothing;

-- ============================================================
-- car-images — public read (bucket is public, no SELECT policy needed);
-- writes restricted to the vehicle's owner.
-- ============================================================
create policy car_images_write_owner on storage.objects
  for all using (
    bucket_id = 'car-images'
    and exists (
      select 1 from vehicles v
      where v.id::text = (storage.foldername(name))[1]
        and v.owner_id = auth.uid()
    )
  ) with check (
    bucket_id = 'car-images'
    and exists (
      select 1 from vehicles v
      where v.id::text = (storage.foldername(name))[1]
        and v.owner_id = auth.uid()
    )
  );

create policy car_images_admin on storage.objects
  for all using (bucket_id = 'car-images' and is_admin());

-- ============================================================
-- user-verification — fully private: owner + admin only, signed URLs only.
-- ============================================================
create policy verification_images_owner on storage.objects
  for all using (
    bucket_id = 'user-verification'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'user-verification'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy verification_images_admin on storage.objects
  for select using (bucket_id = 'user-verification' and is_admin());

-- ============================================================
-- vehicle-documents — split by sub-path.
-- orcr/*: owner + admin only (never shown to renters).
-- rental-agreement/*: readable by anyone who can see the vehicle at all
-- (matches car-images visibility); writable by owner + admin only.
-- ============================================================
create policy vehicle_docs_orcr on storage.objects
  for all using (
    bucket_id = 'vehicle-documents'
    and (storage.foldername(name))[2] = 'orcr'
    and (
      is_admin()
      or exists (select 1 from vehicles v where v.id::text = (storage.foldername(name))[1] and v.owner_id = auth.uid())
    )
  ) with check (
    bucket_id = 'vehicle-documents'
    and (storage.foldername(name))[2] = 'orcr'
    and exists (select 1 from vehicles v where v.id::text = (storage.foldername(name))[1] and v.owner_id = auth.uid())
  );

create policy vehicle_docs_rental_agreement_read on storage.objects
  for select using (
    bucket_id = 'vehicle-documents'
    and (storage.foldername(name))[2] = 'rental-agreement'
    and exists (
      select 1 from vehicles v
      where v.id::text = (storage.foldername(name))[1]
        and (
          (v.approval_status = 'approved' and v.listing_status = 'active')
          or v.owner_id = auth.uid()
          or is_admin()
        )
    )
  );

create policy vehicle_docs_rental_agreement_write on storage.objects
  for insert with check (
    bucket_id = 'vehicle-documents'
    and (storage.foldername(name))[2] = 'rental-agreement'
    and exists (select 1 from vehicles v where v.id::text = (storage.foldername(name))[1] and v.owner_id = auth.uid())
  );
