-- SafeDrive 2.0 — server-side file type/size enforcement
-- The original spec's "JPG/PNG only, max 5MB" was only a client-side <input
-- accept=> hint, trivially bypassed. Supabase Storage supports enforcing
-- this at the bucket level, so a direct API upload is rejected too.

update storage.buckets set
  file_size_limit = 5 * 1024 * 1024,
  allowed_mime_types = array['image/jpeg', 'image/png']
where id in ('car-images', 'user-verification');

-- vehicle-documents holds ORCR (image or scanned PDF) and rental agreements
-- (PDF), and can reasonably run a bit larger than a single photo.
update storage.buckets set
  file_size_limit = 10 * 1024 * 1024,
  allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
where id = 'vehicle-documents';
