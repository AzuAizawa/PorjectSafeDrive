-- SafeDrive 2.0 -- mandatory email-code 2FA for every account (panel
-- feedback: 2FA must be forced from signup, not opt-in, and a working
-- "resend code" email flow must exist on the login page -- neither existed).
--
-- Real constraint (confirmed by reading Supabase's own aal2 mechanics,
-- 034_mandatory_mfa_for_staff.sql): the `aal` JWT claim is only ever minted
-- by GoTrue itself on a genuine supabase.auth.mfa.challengeAndVerify() call
-- against an enrolled totp/phone factor. There is no native "email" MFA
-- factor type, and Auth Hooks (which could otherwise customize this) hit a
-- paid-tier wall already noted elsewhere in this project. So this is
-- necessarily an APP-LAYER gate, not an aal2/RLS-enforced one -- same
-- honest-limitation category as the login-throttle in 053. Regular users
-- have no aal2-gated RLS today anyway, so this doesn't weaken anything that
-- existed; staff keep their existing real-aal2 mandatory TOTP untouched.
--
-- Existing accounts (including staff, and anyone from the live testing
-- panel already using the app) are backfilled to email_otp_verified = true
-- so this doesn't retroactively lock out an active study mid-flight --
-- only brand-new signups from this point on start at false and go through
-- the flow on their very first login.

alter table profiles add column email_otp_verified boolean not null default false;
update profiles set email_otp_verified = true;

-- email_otp_verified is only ever flipped by verify_email_otp() below (via
-- the same app.bypass_profile_protection transaction-local escape hatch
-- 021/047/etc. already use) -- without this, a user could just PATCH their
-- own profiles row directly to set it true and skip the code entirely,
-- since profiles_update_own (002_rls_policies.sql) otherwise allows
-- self-update of any column not in this revert list.
create or replace function protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() and coalesce(current_setting('app.bypass_profile_protection', true), 'false') <> 'true' then
    new.role              := old.role;
    new.verified_status   := old.verified_status;
    new.account_status    := old.account_status;
    new.strike_count      := old.strike_count;
    new.account_flagged   := old.account_flagged;
    new.first_name        := old.first_name;
    new.middle_name       := old.middle_name;
    new.last_name         := old.last_name;
    new.birthday          := old.birthday;
    new.admin_notes       := old.admin_notes;
    new.email_otp_verified := old.email_otp_verified;
    -- is_lister IS allowed to change (renter <-> lister mode switch is a user action)
  end if;
  return new;
end;
$$;

-- handle_new_user() doesn't need a code change -- email_otp_verified
-- defaults to false on every new row via the column default above, which is
-- exactly the "force it right after signup" behavior: a brand-new user's
-- very first login has no TOTP factor either, so they land on the
-- email-code screen automatically (see login.tsx changes).

create table email_otp_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index email_otp_codes_profile_idx on email_otp_codes (profile_id, created_at desc);

alter table email_otp_codes enable row level security;
-- No select/insert/update policy at all -- exact same locked-down shape as
-- mfa_recovery_codes (058): only request_email_otp()/verify_email_otp()
-- (both SECURITY DEFINER) ever touch this table. A code this short (6
-- digits, far weaker than TOTP) must never be client-readable even for the
-- user's own account, or the "attempts" brute-force cap below is pointless.

insert into platform_settings (key, value, description) values
  ('email_otp_expiry_minutes', '10', 'Minutes before a login email code expires'),
  ('email_otp_resend_cooldown_seconds', '45', 'Seconds a user must wait before requesting another login email code')
on conflict (key) do nothing;

-- Generates and emails a fresh 6-digit code for the CALLER's own account
-- (auth.uid() -- never a client-supplied target, so this can't be used to
-- spam another user's inbox). Enforces its own resend cooldown, same shape
-- as check_login_throttle (053), since this is the "resend code" endpoint
-- the panel specifically asked for.
create or replace function request_email_otp()
returns table(sent boolean, retry_after_seconds int)
language plpgsql security definer set search_path = public as $$
declare
  v_profile_id uuid := auth.uid();
  v_cooldown_seconds int := coalesce(get_setting_int('email_otp_resend_cooldown_seconds'), 45);
  v_expiry_minutes int := coalesce(get_setting_int('email_otp_expiry_minutes'), 10);
  v_last_created timestamptz;
  v_elapsed int;
  v_code text;
  v_service_role_key text;
begin
  if v_profile_id is null then
    raise exception 'not authenticated';
  end if;

  select created_at into v_last_created from email_otp_codes
  where profile_id = v_profile_id order by created_at desc limit 1;

  if v_last_created is not null then
    v_elapsed := extract(epoch from (now() - v_last_created))::int;
    if v_elapsed < v_cooldown_seconds then
      return query select false, (v_cooldown_seconds - v_elapsed);
      return;
    end if;
  end if;

  -- Secure random 6-digit code: pull 4 random bytes (pgcrypto lives in the
  -- `extensions` schema on this project, not `public` -- see 058) and fold
  -- them into a 0-999999 range, same trick as generating a bounded random
  -- int from cryptographically random bytes rather than plain random().
  v_code := lpad((abs(('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::int) % 1000000)::text, 6, '0');

  insert into email_otp_codes (profile_id, code_hash, expires_at)
  values (
    v_profile_id,
    encode(extensions.digest(v_code || v_profile_id::text, 'sha256'), 'hex'),
    now() + (v_expiry_minutes || ' minutes')::interval
  );

  begin
    select decrypted_secret into v_service_role_key from vault.decrypted_secrets where name = 'service_role_key';
    if v_service_role_key is not null then
      perform net.http_post(
        url := 'https://ytnsrikbsvmswhtfkdci.supabase.co/functions/v1/send-login-otp',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                       'Authorization', 'Bearer ' || v_service_role_key),
        body := jsonb_build_object('profile_id', v_profile_id, 'code', v_code)
      );
    end if;
  exception when others then
    -- A delivery hiccup must never block login -- same accepted tradeoff
    -- as notify_user() (030_fix_notify_user_hard_failure.sql).
    null;
  end;

  return query select true, 0;
end;
$$;

revoke execute on function request_email_otp() from public, anon;
grant execute on function request_email_otp() to authenticated;

-- Checks the CALLER's own latest unused code. Capped at 5 wrong guesses --
-- a 6-digit code has only 1,000,000 combinations and none of Supabase's own
-- MFA rate-limiting applies to a custom mechanism like this, so it needs its
-- own brute-force cap.
create or replace function verify_email_otp(p_code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_profile_id uuid := auth.uid();
  v_row email_otp_codes%rowtype;
  v_hash text;
begin
  if v_profile_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from email_otp_codes
  where profile_id = v_profile_id and used_at is null
  order by created_at desc limit 1;

  if v_row.id is null then
    raise exception 'No pending code -- request a new one';
  end if;

  if v_row.expires_at < now() then
    raise exception 'This code has expired -- request a new one';
  end if;

  if v_row.attempts >= 5 then
    raise exception 'Too many incorrect attempts -- request a new one';
  end if;

  v_hash := encode(extensions.digest(trim(p_code) || v_profile_id::text, 'sha256'), 'hex');

  if v_hash <> v_row.code_hash then
    update email_otp_codes set attempts = attempts + 1 where id = v_row.id;
    return false;
  end if;

  update email_otp_codes set used_at = now() where id = v_row.id;

  perform set_config('app.bypass_profile_protection', 'true', true);
  update profiles set email_otp_verified = true where id = v_profile_id;

  perform log_audit(v_profile_id, 'email_otp_verified', 'user', v_profile_id, '{}'::jsonb);
  return true;
end;
$$;

revoke execute on function verify_email_otp(text) from public, anon;
grant execute on function verify_email_otp(text) to authenticated;
