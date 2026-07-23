-- SafeDrive 2.0 -- fix a real gap found while verifying 037 live: creating a
-- new function picks up Supabase's project-level default privileges, which
-- grant EXECUTE directly to both `anon` and `authenticated` -- not just to
-- PUBLIC. Revoking from PUBLIC alone (what this file originally did) left
-- anon's direct grant untouched, confirmed by re-querying
-- has_function_privilege() live after that first attempt. 005_grants.sql's
-- original sweep revoked from both public AND anon explicitly for exactly
-- this reason; matching that here for the three new/changed signatures.
-- get_vehicle_calendar() is intentionally left as-is -- it's meant to be
-- anon-readable, same as the existing available_vehicle_ids().

revoke execute on function request_booking(uuid, date, date, time) from public, anon;
revoke execute on function resolve_dispute(uuid, text, numeric, uuid) from public, anon;
revoke execute on function report_owner_no_show(uuid, text) from public, anon;
