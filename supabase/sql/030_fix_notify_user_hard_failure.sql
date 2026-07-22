-- SafeDrive 2.0 — CRITICAL FIX: notify_user() was hard-failing, not just
-- silently skipping email.
--
-- Found while testing vehicle quota enforcement (029): net.http_post()
-- inserts into net.http_request_queue, whose `url` column is NOT NULL.
-- Since app.settings.send_email_function_url was never configured,
-- current_setting(..., true) returns null, the insert violates the NOT NULL
-- constraint, and that error propagates up and ABORTS THE ENTIRE CALLING
-- TRANSACTION. Every RPC that calls notify_user(..., p_send_email = true)
-- — accept_booking, reject_booking, approve_verification, approve_vehicle,
-- reject_vehicle, mark_complete, cancel_booking, and more — has been
-- throwing whenever that code path runs, not just failing to send email.
-- Verified live: a direct call reproduced the exact
-- "null value in column url of relation http_request_queue" error.
--
-- Fix: only attempt the HTTP call when the URL setting is actually present,
-- and wrap it in an exception handler regardless — a best-effort email
-- notification must never be able to take down a booking/payment RPC.

create or replace function notify_user(
  p_user_id uuid, p_type text, p_message text, p_link text default null, p_send_email boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_email_url text;
begin
  insert into notifications(user_id, type, message, link)
  values (p_user_id, p_type, p_message, p_link)
  returning id into v_id;

  v_email_url := nullif(current_setting('app.settings.send_email_function_url', true), '');

  if p_send_email and v_email_url is not null then
    begin
      perform net.http_post(
        url := v_email_url,
        headers := jsonb_build_object('Content-Type', 'application/json',
                                       'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)),
        body := jsonb_build_object('user_id', p_user_id, 'type', p_type, 'message', p_message)
      );
    exception when others then
      -- Never let a notification-delivery problem roll back the real
      -- booking/payment/verification action that triggered it.
      null;
    end;
  end if;
end;
$$;
