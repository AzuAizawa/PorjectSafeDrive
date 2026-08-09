-- SafeDrive 2.0 -- rate limit for the new AI-generated analytics insights
-- feature. Gemini's free tier is shared across the whole app and rate-limited
-- at Google's end (~10 requests/minute as of writing) -- a lightweight
-- per-user cooldown here stops one impatient double-click from eating into
-- that shared quota, same reasoning as request_booking's cooldown
-- (032_rate_limiting.sql). enforce_cooldown() itself is locked down to
-- SECURITY DEFINER callers only (039_fix_anon_execute_audit_findings.sql),
-- so this thin wrapper is what the edge function actually calls.
create or replace function request_ai_insights_cooldown()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  perform enforce_cooldown(auth.uid(), 'generate_ai_insights', 20);
end;
$$;

revoke execute on function request_ai_insights_cooldown() from public, anon;
grant execute on function request_ai_insights_cooldown() to authenticated;
