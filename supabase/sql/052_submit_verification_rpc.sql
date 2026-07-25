-- SafeDrive 2.0 -- fix a real, currently-live bug: verification submissions
-- never actually surfaced for admin review.
--
-- verify.tsx did two separate client-side calls: insert into
-- verification_submissions (succeeds), then a plain
-- `.from('profiles').update({ verified_status: 'pending' })`. But
-- protect_profile_fields() (021/026/047) silently reverts verified_status
-- back to its old value on any non-admin UPDATE unless
-- app.bypass_profile_protection is set -- exactly the same bug class
-- already found and fixed once before for strike_count (021). The insert
-- succeeded, so the submission genuinely exists, but the profile's status
-- flag never flipped, so Admin Users (gated on verified_status === 'pending'
-- to even fetch the submission) and the Dashboard's "Pending Verifications"
-- count both showed nothing. Confirmed live: kelchua360@gmail.com has a
-- real submission row (submitted 2026-07-22) sitting unreviewed, with
-- verified_status stuck at 'unverified' this whole time.
--
-- Fix: a single SECURITY DEFINER RPC does the insert + status flip
-- atomically (also closing a smaller race: previously a dropped connection
-- between the two client calls could leave the same inconsistent state).
-- Matches the same set_config('app.bypass_profile_protection', ...)
-- mechanism add_strike()/clear_strikes()/approve_verification() already use.

create or replace function submit_verification(
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_phone text,
  p_address text,
  p_birthday date,
  p_driver_license_number text,
  p_secondary_id_type text,
  p_license_front_path text,
  p_license_back_path text,
  p_secondary_id_front_path text,
  p_secondary_id_back_path text,
  p_selfie_with_id_path text,
  p_selfie_face_path text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_submission_id uuid;
begin
  if exists (select 1 from verification_submissions where profile_id = auth.uid() and status = 'pending') then
    raise exception 'a verification submission is already pending review';
  end if;

  insert into verification_submissions (
    profile_id, first_name, middle_name, last_name, phone, address, birthday,
    driver_license_number, secondary_id_type,
    license_front_path, license_back_path, secondary_id_front_path, secondary_id_back_path,
    selfie_with_id_path, selfie_face_path
  ) values (
    auth.uid(), p_first_name, p_middle_name, p_last_name, p_phone, p_address, p_birthday,
    p_driver_license_number, p_secondary_id_type,
    p_license_front_path, p_license_back_path, p_secondary_id_front_path, p_secondary_id_back_path,
    p_selfie_with_id_path, p_selfie_face_path
  ) returning id into v_submission_id;

  perform set_config('app.bypass_profile_protection', 'true', true);
  update profiles set verified_status = 'pending' where id = auth.uid();

  return v_submission_id;
end;
$$;

revoke execute on function submit_verification(
  text, text, text, text, text, date, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function submit_verification(
  text, text, text, text, text, date, text, text, text, text, text, text, text, text
) to authenticated;

-- One-time data repair: kelchua360@gmail.com's real, already-inserted
-- submission never surfaced. Bring the profile's status in line with the
-- submission that has genuinely existed since 2026-07-22 so it appears in
-- Admin Users / the Dashboard's pending count for real review, rather than
-- silently vanishing.
select set_config('app.bypass_profile_protection', 'true', true);
update profiles set verified_status = 'pending'
where id in (select profile_id from verification_submissions where status = 'pending')
  and verified_status = 'unverified';
