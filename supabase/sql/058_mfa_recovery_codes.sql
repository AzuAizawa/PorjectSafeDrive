-- SafeDrive 2.0 -- MFA backup recovery codes ("what if the authenticator
-- is down").
--
-- Real technical constraint worth recording: a custom recovery-code table
-- CANNOT act as a substitute TOTP challenge. The aal2 claim on a session's
-- JWT is minted only by Supabase's own GoTrue service upon a real MFA
-- factor challenge succeeding -- no Postgres function can mint it, and
-- mfa_allow_low_aal is false on this project (self-unenroll requires
-- already being aal2, so a locked-out user can't remove their own lost
-- factor either -- a real chicken-and-egg problem).
--
-- So a recovery code doesn't complete the aal2 challenge directly. Instead:
-- a valid code lets a TRUSTED SERVER-SIDE process (the verify-recovery-code
-- Edge Function, using service_role/the Admin API, not the user's own
-- under-privileged aal1 session) delete the user's lost TOTP factor
-- entirely. They land back on the same "set up 2FA" enrollment screen a
-- brand-new staff account sees, and enroll a fresh authenticator from
-- there -- achieving real aal2 through Supabase's normal mechanism, not a
-- bypass of it.
--
-- Codes are generated only while already at aal2 (you need working access
-- today to prepare for losing it later — the standard GitHub/Google
-- pattern), hashed with a per-user salt (the profile id) so stored hashes
-- can't be looked up across accounts, and every code is single-use.

create table mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index mfa_recovery_codes_profile_idx on mfa_recovery_codes (profile_id);

alter table mfa_recovery_codes enable row level security;
-- No select/insert policy at all -- codes are only ever written by
-- generate_mfa_recovery_codes() (SECURITY DEFINER) and only ever checked by
-- verify_and_consume_recovery_code() (service_role-only). A user must never
-- be able to read hashes back, even their own.

create or replace function generate_mfa_recovery_codes()
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_codes text[] := '{}';
  v_raw text;
  v_code text;
  i int;
begin
  if not is_aal2() then
    raise exception 'complete a 2FA challenge first -- codes are generated for future use, not as a way around a current one';
  end if;

  -- Regenerating invalidates every previously issued code, same as
  -- GitHub/Google -- there's only ever one valid set at a time.
  delete from mfa_recovery_codes where profile_id = auth.uid();

  -- pgcrypto lives in the `extensions` schema on this project (Supabase's
  -- default), not `public` -- must qualify these or they're invisible to a
  -- function with `set search_path = public`.
  for i in 1..10 loop
    v_raw := upper(encode(extensions.gen_random_bytes(5), 'hex'));
    v_code := substr(v_raw, 1, 5) || '-' || substr(v_raw, 6, 5);
    v_codes := array_append(v_codes, v_code);
    insert into mfa_recovery_codes (profile_id, code_hash)
    values (auth.uid(), encode(extensions.digest(v_raw || auth.uid()::text, 'sha256'), 'hex'));
  end loop;

  perform log_audit(auth.uid(), 'mfa_recovery_codes_generated', 'user', auth.uid(), '{}'::jsonb);
  return v_codes;
end;
$$;

revoke execute on function generate_mfa_recovery_codes() from public, anon;
grant execute on function generate_mfa_recovery_codes() to authenticated;

-- p_profile_id is NOT auth.uid() here on purpose -- this runs from the
-- verify-recovery-code Edge Function on behalf of a user who isn't at aal2
-- yet, so it can't rely on a trusted session claim. The Edge Function
-- independently authenticates who's calling via their own aal1 JWT first,
-- then passes THAT id here -- never a client-supplied one. That's why this
-- is revoked from authenticated entirely: an aal1 user calling it directly
-- with an arbitrary p_profile_id would be able to grind codes against
-- someone else's account.
create or replace function verify_and_consume_recovery_code(p_profile_id uuid, p_code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_hash text;
  v_id uuid;
begin
  v_hash := encode(extensions.digest(upper(replace(p_code, '-', '')) || p_profile_id::text, 'sha256'), 'hex');

  select id into v_id from mfa_recovery_codes
  where profile_id = p_profile_id and code_hash = v_hash and used_at is null
  limit 1;

  if v_id is null then
    return false;
  end if;

  update mfa_recovery_codes set used_at = now() where id = v_id;
  perform log_audit(p_profile_id, 'mfa_recovery_code_used', 'user', p_profile_id, '{}'::jsonb);
  return true;
end;
$$;

revoke execute on function verify_and_consume_recovery_code(uuid, text) from public, anon, authenticated;
