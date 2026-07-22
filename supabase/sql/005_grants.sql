-- SafeDrive 2.0 — Explicit function grants
-- Postgres grants EXECUTE to PUBLIC by default, which would let even the
-- unauthenticated `anon` role call these. Lock that down explicitly:
-- only `authenticated` (logged-in) users may call business-logic RPCs.
-- Admin-only functions still perform their own is_admin() check inside —
-- this grant only controls "logged in or not," not "which role."

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

grant execute on function
  request_booking(uuid, date, date),
  accept_booking(uuid),
  reject_booking(uuid, text),
  cancel_booking(uuid, text),
  cancel_no_show(uuid, text),
  confirm_handover(uuid),
  mark_complete(uuid),
  approve_verification(uuid),
  reject_verification(uuid, text),
  approve_vehicle(uuid),
  reject_vehicle(uuid, text),
  resolve_dispute(uuid, text, numeric),
  set_account_status(uuid, text),
  clear_strikes(uuid),
  mark_payout_sent(uuid),
  is_admin(),
  is_booking_participant(uuid)
to authenticated;

-- Webhook confirmation functions are called only by the Edge Function using
-- the service_role key (which bypasses grants/RLS entirely) — intentionally
-- NOT granted to authenticated, so no logged-in user can call them directly.
