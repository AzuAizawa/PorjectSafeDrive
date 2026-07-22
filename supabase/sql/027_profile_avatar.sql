-- SafeDrive 2.0 — profile picture sourced from the verified "selfie, face
-- only" photo.
--
-- Per user feedback: the face-only selfie captured during Get Verified
-- should double as the user's visible profile picture once verification is
-- approved, so the other party in a booking (renter <-> owner) can actually
-- see who they're dealing with. The raw selfie lives in the private
-- `user-verification` bucket (ID-document-adjacent, admin/owner only) — it
-- can't be shown broadly. A Postgres function can't copy storage objects
-- across buckets, so the copy happens client-side (admin's browser, at the
-- moment of approval, since that's the one place in the app that already
-- reads user-verification files) into a new public `avatars` bucket, and
-- this migration just adds the column + bucket + the RPC param to store it.

alter table profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 5 * 1024 * 1024, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Public read (bucket is public, no SELECT policy needed). Writes are
-- admin-only since the only path that populates this bucket is the
-- verification-approval flow, not a user-facing "change my photo" feature.
create policy avatars_write_admin on storage.objects
  for all using (bucket_id = 'avatars' and is_admin())
  with check (bucket_id = 'avatars' and is_admin());

drop function if exists approve_verification(uuid);

create or replace function approve_verification(p_submission_id uuid, p_avatar_path text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_profile_id uuid;
  v_sub record;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  select * into v_sub from verification_submissions where id = p_submission_id;
  if v_sub.status <> 'pending' then raise exception 'submission already reviewed'; end if;

  update verification_submissions
    set status = 'verified', reviewed_at = now(), reviewed_by = auth.uid()
    where id = p_submission_id;

  update profiles set
    first_name = v_sub.first_name, middle_name = v_sub.middle_name, last_name = v_sub.last_name,
    phone = v_sub.phone, address = v_sub.address, birthday = v_sub.birthday,
    verified_status = 'verified',
    avatar_url = coalesce(p_avatar_path, avatar_url)
  where id = v_sub.profile_id;

  perform log_audit(auth.uid(), 'user_verified', 'user', v_sub.profile_id, '{}'::jsonb);
  perform notify_user(v_sub.profile_id, 'verification_approved', 'Your identity verification was approved.', '/verify', true);
end;
$$;

grant execute on function approve_verification(uuid, text) to authenticated;
