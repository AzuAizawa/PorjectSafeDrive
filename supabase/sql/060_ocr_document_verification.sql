-- SafeDrive 2.0 -- OCR-assisted document review + anti-forgery signals.
--
-- Admin review of identity documents (license/secondary ID) and vehicle
-- ownership (ORCR) has been 100% manual: an admin eyeballs a name on a
-- document against a name on file, with no automated assist and zero
-- defense against a forged/edited/reused document image. This wires up a
-- new Edge Function (ocr-name-check, calls Google Cloud Vision) triggered
-- asynchronously the same way notify_user() already calls send-email via
-- pg_net + Supabase Vault -- not a client-orchestrated call.
--
-- Important scope note, carried from the brainstorm this was designed in:
-- every signal here is an admin-facing flag, never an auto-approve/reject.
-- It raises the cost of casual/lazy fraud and cuts admin triage time -- it
-- does not catch a competent, internally-consistent forgery, and isn't
-- meant to.

create table document_hashes (
  id uuid primary key default gen_random_uuid(),
  hash text not null,
  entity_type text not null,
  entity_id uuid not null,
  bucket text not null,
  path text not null,
  created_at timestamptz not null default now()
);
create index idx_document_hashes_hash on document_hashes(hash);
alter table document_hashes enable row level security;
-- No policies -- this is an internal implementation table for the
-- ocr-name-check Edge Function (service role bypasses RLS entirely); no
-- client should ever read or write it directly.

alter table verification_submissions add column license_ocr_findings jsonb;
alter table verification_submissions add column liveness_flag boolean not null default false;
alter table vehicles add column orcr_ocr_findings jsonb;

-- Shared helper so submit_verification / protect_vehicle_fields don't each
-- duplicate the Vault-lookup + net.http_post boilerplate notify_user()
-- already established.
create or replace function trigger_ocr_check(
  p_entity_type text, p_entity_id uuid, p_bucket text, p_path text,
  p_expected_name text, p_plate_number text default null, p_orcr_expiry_date date default null
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
        'expected_name', p_expected_name, 'plate_number', p_plate_number, 'orcr_expiry_date', p_orcr_expiry_date
      )
    );
  exception when others then
    -- An OCR-check dispatch failure must never break the real
    -- verification/vehicle submission that triggered it.
    null;
  end;
end;
$$;

-- submit_verification gains one new optional param (the client-side
-- frame-motion liveness signal from camera-capture.tsx) and now also
-- dispatches an OCR check on the license photo. Adding a parameter changes
-- the function's signature, so the old 14-arg version must be dropped
-- first (same approach as 027_profile_avatar.sql's approve_verification
-- change) or it would just become a second overload instead of replacing it.
drop function if exists submit_verification(
  text, text, text, text, text, date, text, text, text, text, text, text, text, text
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
    selfie_with_id_path, selfie_face_path, liveness_flag
  ) values (
    auth.uid(), p_first_name, p_middle_name, p_last_name, p_phone, p_address, p_birthday,
    p_driver_license_number, p_secondary_id_type,
    p_license_front_path, p_license_back_path, p_secondary_id_front_path, p_secondary_id_back_path,
    p_selfie_with_id_path, p_selfie_face_path, p_liveness_flag
  ) returning id into v_submission_id;

  perform set_config('app.bypass_profile_protection', 'true', true);
  update profiles set verified_status = 'pending' where id = auth.uid();

  -- License only (not secondary ID too) -- it's the one standardized,
  -- most reliably-OCR'd PH ID layout, and already has driver_license_number
  -- as its own separate cross-reference.
  perform trigger_ocr_check(
    'verification', v_submission_id, 'user-verification', p_license_front_path,
    p_first_name || ' ' || p_last_name
  );

  return v_submission_id;
end;
$$;

revoke execute on function submit_verification(
  text, text, text, text, text, date, text, text, text, text, text, text, text, text, boolean
) from public, anon;
grant execute on function submit_verification(
  text, text, text, text, text, date, text, text, text, text, text, text, text, text, boolean
) to authenticated;

-- protect_vehicle_fields (full redefinition, extending 059's version):
-- resets orcr_ocr_findings whenever the document changes (a stale finding
-- must not survive a new upload) and dispatches a fresh OCR check.
create or replace function protect_vehicle_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_name text;
begin
  if new.orcr_expiry_date is distinct from old.orcr_expiry_date then
    new.orcr_expiry_reminder_sent := false;
  end if;

  if new.orcr_path is distinct from old.orcr_path then
    new.orcr_ocr_findings := null;
  end if;

  if not is_admin() then
    if new.plate_number is distinct from old.plate_number
       or new.orcr_path is distinct from old.orcr_path
       or new.orcr_expiry_date is distinct from old.orcr_expiry_date
       or new.model_id is distinct from old.model_id then
      new.approval_status  := 'pending';
      new.rejection_reason := null;
    else
      new.approval_status  := old.approval_status;
      new.rejection_reason := old.rejection_reason;
    end if;
    new.admin_notes := old.admin_notes;
  end if;

  if new.orcr_path is distinct from old.orcr_path and new.orcr_path is not null then
    select first_name || ' ' || last_name into v_owner_name from profiles where id = new.owner_id;
    perform trigger_ocr_check(
      'vehicle', new.id, 'vehicle-documents', new.orcr_path,
      v_owner_name, new.plate_number, new.orcr_expiry_date
    );
  end if;

  return new;
end;
$$;
