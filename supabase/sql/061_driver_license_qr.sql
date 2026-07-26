-- SafeDrive 2.0 -- driver's license QR code field + decode.
--
-- PH digital driver's licenses (LTMS Portal / eGovPH) carry a QR code that
-- encodes a portal.lto.gov.ph verification URL. Scoped deliberately narrow
-- after review: the server decodes the QR image (a plain, safe, local
-- operation -- no external calls) and shows the raw decoded URL to admin,
-- who can click through themselves if they want. It does NOT auto-fetch
-- that URL server-side -- that would mean programmatically scraping a live
-- government site with unknown terms of service, which is a real legal
-- question this project isn't treating as pre-cleared.
--
-- driver_license_qr_path is nullable at the DB level (existing submissions
-- predate this field and can't be honestly backfilled) even though the
-- frontend now requires it for new submissions, same reasoning as
-- orcr_path/orcr_expiry_date's nullability elsewhere in this schema.

alter table verification_submissions add column driver_license_qr_path text;
alter table verification_submissions add column qr_decoded_content text;

-- trigger_ocr_check gains one more optional trailing param. Same
-- drop-then-recreate requirement as any Postgres function signature change
-- (adding a parameter is a different signature, not an in-place edit).
drop function if exists trigger_ocr_check(text, uuid, text, text, text, text, date);

create or replace function trigger_ocr_check(
  p_entity_type text, p_entity_id uuid, p_bucket text, p_path text,
  p_expected_name text, p_plate_number text default null, p_orcr_expiry_date date default null,
  p_qr_path text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_service_role_key text;
begin
  select decrypted_secret into v_service_role_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_service_role_key is null then return; end if;

  begin
    perform net.http_post(
      url := 'https://ytnsrikbsvmswhtfkdci.supabase.co/functions/v1/ocr-name-check',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role_key),
      body := jsonb_build_object(
        'entity_type', p_entity_type, 'entity_id', p_entity_id, 'bucket', p_bucket, 'path', p_path,
        'expected_name', p_expected_name, 'plate_number', p_plate_number, 'orcr_expiry_date', p_orcr_expiry_date,
        'qr_path', p_qr_path
      )
    );
  exception when others then
    null;
  end;
end;
$$;

-- submit_verification gains the new required (app-layer-enforced) QR path
-- param. Must be dropped first, same as 060's change.
drop function if exists submit_verification(
  text, text, text, text, text, date, text, text, text, text, text, text, text, text, boolean
);

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
  p_selfie_face_path text,
  p_driver_license_qr_path text,
  p_liveness_flag boolean default false
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
    selfie_with_id_path, selfie_face_path, driver_license_qr_path, liveness_flag
  ) values (
    auth.uid(), p_first_name, p_middle_name, p_last_name, p_phone, p_address, p_birthday,
    p_driver_license_number, p_secondary_id_type,
    p_license_front_path, p_license_back_path, p_secondary_id_front_path, p_secondary_id_back_path,
    p_selfie_with_id_path, p_selfie_face_path, p_driver_license_qr_path, p_liveness_flag
  ) returning id into v_submission_id;

  perform set_config('app.bypass_profile_protection', 'true', true);
  update profiles set verified_status = 'pending' where id = auth.uid();

  perform trigger_ocr_check(
    p_entity_type => 'verification',
    p_entity_id => v_submission_id,
    p_bucket => 'user-verification',
    p_path => p_license_front_path,
    p_expected_name => p_first_name || ' ' || p_last_name,
    p_qr_path => p_driver_license_qr_path
  );

  return v_submission_id;
end;
$$;

revoke execute on function submit_verification(
  text, text, text, text, text, date, text, text, text, text, text, text, text, text, text, boolean
) from public, anon;
grant execute on function submit_verification(
  text, text, text, text, text, date, text, text, text, text, text, text, text, text, text, boolean
) to authenticated;
