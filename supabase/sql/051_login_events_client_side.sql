-- SafeDrive 2.0 -- 050's plan (log logins via the "Password Verification
-- Attempt" Auth Hook) doesn't work on this project: enabling that hook via
-- the Management API returned 402 -- custom Auth Hooks require a paid
-- Supabase organization tier, confirmed unavailable here. The hook was
-- never actually enabled (verified: config still shows disabled), so
-- nothing broke, but hook_log_password_verification_attempt() will never
-- fire and is dead code. Dropping it.
--
-- Fallback: the app itself records a row right after a successful sign-in,
-- via an RPC any authenticated user can call only for themselves. This is a
-- real, honest downgrade from a server-side hook -- it only captures
-- successful logins made through this app's own login form, not failed
-- attempts and not logins via some other client. login_events and
-- get_auth_activity_log() from 050 are unchanged and still correct; only
-- how rows get in changes.

drop function if exists hook_log_password_verification_attempt(jsonb);

create or replace function record_login_event()
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into login_events (user_id, success) values (auth.uid(), true);
end;
$$;

revoke execute on function record_login_event() from public, anon;
grant execute on function record_login_event() to authenticated;
