-- SafeDrive 2.0 -- full audit of every public-schema function's live grants,
-- triggered by catching the anon-execute gap in 037/038. Root cause confirmed
-- systemic: 005_grants.sql's revoke-from-public-and-anon sweep only covered
-- functions that existed when it ran. Every migration since (015, 019, 020,
-- 029, 032, 033...) added `grant execute ... to authenticated` for its new
-- functions but never paired it with the matching `revoke ... from public,
-- anon` -- so Supabase's default privilege behavior (new functions get
-- EXECUTE granted directly to anon, not just PUBLIC) silently left every one
-- of them anon-callable since the migration that created it. Confirmed live
-- via has_function_privilege('anon', ...) against all 57 public functions,
-- not assumed from reading code.
--
-- Two of these were genuinely exploitable, not just untidy:
--   - add_strike(uuid, text) had ZERO internal authorization check -- any
--     unauthenticated caller could add a strike to any profile_id directly,
--     a real account-griefing vector (enough strikes auto-flags an account).
--   - confirm_subscription_payment(uuid, text) had no caller verification
--     either (that check normally lives in the create-checkout/webhook Edge
--     Function, never re-verified here) -- anon could grant themselves free
--     subscription slots by calling it directly with a made-up reference.
-- Both have been live and callable this way since the migrations that
-- created them (020 and 008 respectively), not introduced this session.
--
-- is_aal2()/is_support_or_admin() were checked and deliberately left alone --
-- they're referenced inside RLS USING() clauses on tables anon and
-- authenticated both query (e.g. vehicles_select_admin, listing_reports
-- select policy), so both roles genuinely need EXECUTE on them or those
-- policies would error out for everyone, not just fail closed. Confirmed via
-- grep across every RLS policy definition before touching anything here.

-- ============================================================
-- 1. Pure internal helpers / webhook-only functions -- never meant to be
--    reachable by any client role at all. Confirmed via grep that neither
--    the frontend nor any Edge Function calls these via .rpc() directly
--    (frontend rpc call sites checked); Edge Functions that DO need
--    equivalent logic (process-refund) use the service_role key, which
--    bypasses grants entirely, so no grant is needed for them either.
-- ============================================================
revoke execute on function add_strike(uuid, text) from public, anon, authenticated;
revoke execute on function enforce_cooldown(uuid, text, int) from public, anon, authenticated;
revoke execute on function confirm_subscription_payment(uuid, text) from public, anon, authenticated;
revoke execute on function confirm_deposit_refund_result(text, text) from public, anon, authenticated;
revoke execute on function get_downpayment_paymongo_reference(uuid) from public, anon, authenticated;
revoke execute on function get_active_strike_count(uuid) from public, anon, authenticated;
revoke execute on function get_profile_age(uuid) from public, anon, authenticated;
revoke execute on function expire_lapsed_subscriptions() from public, anon, authenticated;

-- ============================================================
-- 2. Functions genuinely called by logged-in clients -- keep authenticated,
--    close off anon/public.
-- ============================================================
revoke execute on function get_or_create_support_conversation() from public, anon;
revoke execute on function mark_support_read(uuid) from public, anon;
revoke execute on function approve_verification(uuid, text) from public, anon;
revoke execute on function mark_deposit_refund_processing(uuid, text) from public, anon;
revoke execute on function mark_deposit_refunded(uuid) from public, anon;
revoke execute on function resolve_listing_report(uuid) from public, anon;

-- ============================================================
-- 3. Two functions that were missing a real internal authorization check,
--    not just an overly-broad grant -- fixed at the source, then locked down.
-- ============================================================

-- get_cron_health() is surfaced on the Admin Dashboard with zero internal
-- check; anyone who could call it saw cron job run history/status.
create or replace function get_cron_health()
returns table(job_name text, last_run timestamptz, last_status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_support_or_admin() then raise exception 'not authorized'; end if;
  return query
    select j.jobname, d.start_time, d.status
    from cron.job j
    left join lateral (
      select start_time, status from cron.job_run_details
      where jobid = j.jobid order by start_time desc limit 1
    ) d on true
    where j.jobname in ('expire-stale-bookings', 'auto-complete-bookings');
end;
$$;

-- get_vehicle_slot_capacity(p_profile_id) let any caller pass any profile_id
-- and see whether that lister has an active paid subscription. Both live
-- call sites (my-vehicles.tsx, add-vehicle.tsx) already only ever pass the
-- current user's own id, so scoping this to self-or-admin changes nothing
-- for real usage.
create or replace function get_vehicle_slot_capacity(p_profile_id uuid)
returns integer
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() <> p_profile_id and not is_support_or_admin() then
    raise exception 'not authorized';
  end if;
  return get_setting_int('free_vehicle_slots')
    + coalesce((
        select sum(slots_granted) from subscriptions
        where profile_id = p_profile_id and status = 'active' and expires_at > now()
      ), 0)::integer;
end;
$$;

revoke execute on function get_cron_health() from public, anon;
revoke execute on function get_vehicle_slot_capacity(uuid) from public, anon;
grant execute on function get_cron_health() to authenticated;
grant execute on function get_vehicle_slot_capacity(uuid) to authenticated;
