-- SafeDrive 2.0 — wire up real email sending, finally.
--
-- notify_user() (003_functions.sql, patched in 030 to fail gracefully) was
-- designed to read its Edge Function URL/auth key via
-- current_setting('app.settings.xxx'), following an older Supabase pattern.
-- On the current hosted platform, ALTER DATABASE/ROLE SET for arbitrary
-- custom GUCs is blocked ("permission denied to set parameter") — verified
-- live when attempting to configure it. Supabase Vault is the actual
-- supported mechanism for a Postgres function to hold a secret it needs at
-- runtime, so this switches to that instead of chasing a GUC that can't be
-- set on this platform.
--
-- The Edge Function URL itself isn't sensitive (just a routing address,
-- derivable from the already-public project ref), so it's hardcoded
-- directly rather than also going through Vault. The service_role key
-- (the only real secret here, used so send-email's own JWT check accepts
-- the call) is seeded into Vault separately, outside of any committed file.

create or replace function notify_user(
  p_user_id uuid, p_type text, p_message text, p_link text default null, p_send_email boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_service_role_key text;
begin
  insert into notifications(user_id, type, message, link)
  values (p_user_id, p_type, p_message, p_link)
  returning id into v_id;

  if p_send_email then
    select decrypted_secret into v_service_role_key from vault.decrypted_secrets where name = 'service_role_key';

    if v_service_role_key is not null then
      begin
        perform net.http_post(
          url := 'https://ytnsrikbsvmswhtfkdci.supabase.co/functions/v1/send-email',
          headers := jsonb_build_object('Content-Type', 'application/json',
                                         'Authorization', 'Bearer ' || v_service_role_key),
          body := jsonb_build_object('user_id', p_user_id, 'type', p_type, 'message', p_message)
        );
      exception when others then
        -- A notification-delivery problem must never roll back the real
        -- booking/payment/verification action that triggered it.
        null;
      end;
    end if;
  end if;
end;
$$;
