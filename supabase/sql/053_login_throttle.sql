-- SafeDrive 2.0 -- app-layer login throttling.
--
-- Standards reviewed: NIST SP 800-63B and OWASP ASVS both deliberately
-- avoid a fixed attempt count, preferring throttling/increasing delay over
-- hard lockout (a fixed lockout lets an attacker lock a victim out on
-- purpose by repeatedly failing their login -- a self-inflicted DoS). PCI-
-- DSS v4.0 Req 8.3.4 is the one standard with a concrete number: lock after
-- no more than 10 invalid attempts, minimum 30-minute cooldown. Landed on a
-- blend matching Microsoft Entra ID's "Smart Lockout" pattern: 10 failed
-- attempts within a rolling 24h window, then a cooldown that DOUBLES each
-- time the threshold is crossed again (15min -> 30min -> 60min..., capped
-- at 4h) rather than a single fixed lock an admin must manually clear.
--
-- Real limitation, same category as the Security Log fix: this only
-- protects SafeDrive's own login form. A true server-side guarantee (which
-- can't be bypassed by hitting Supabase's auth API directly) needs the same
-- Auth Hook that hit the 402 paid-tier wall earlier -- not available on
-- this project. This is an honest app-layer mitigation, not a platform
-- guarantee.
--
-- record_login_failure()/check_login_throttle() are necessarily callable by
-- `anon` -- a failed/blocked login attempt happens before any session
-- exists, so there's no auth.uid() to key off. Accepted tradeoff, documented
-- here rather than silently: this does let an anonymous caller probe
-- whether a given email has recent failures (a minor enumeration signal),
-- which is inherent to any client-checkable pre-auth throttle, not specific
-- to this implementation.

create table login_failures (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  occurred_at timestamptz not null default now()
);

create index login_failures_email_idx on login_failures (email, occurred_at);

alter table login_failures enable row level security;
create policy login_failures_select_admin on login_failures for select using (is_admin());

create or replace function record_login_failure(p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into login_failures (email) values (lower(trim(p_email)));
end;
$$;

revoke execute on function record_login_failure(text) from public;
grant execute on function record_login_failure(text) to anon, authenticated;

create or replace function check_login_throttle(p_email text)
returns table(blocked boolean, retry_after_seconds int)
language plpgsql security definer set search_path = public as $$
declare
  v_threshold constant int := 10;
  v_base_cooldown_minutes constant int := 15;
  v_max_cooldown_minutes constant int := 240;
  v_recent_failures int;
  v_last_failure timestamptz;
  v_cycles int;
  v_cooldown_minutes int;
  v_elapsed_seconds int;
begin
  select count(*), max(occurred_at) into v_recent_failures, v_last_failure
  from login_failures
  where email = lower(trim(p_email)) and occurred_at > now() - interval '24 hours';

  if v_recent_failures < v_threshold then
    return query select false, 0;
    return;
  end if;

  v_cycles := v_recent_failures / v_threshold; -- integer division: 1 at 10-19, 2 at 20-29, etc.
  v_cooldown_minutes := least(v_base_cooldown_minutes * power(2, v_cycles - 1)::int, v_max_cooldown_minutes);
  v_elapsed_seconds := extract(epoch from (now() - v_last_failure))::int;

  if v_elapsed_seconds >= v_cooldown_minutes * 60 then
    return query select false, 0;
  else
    return query select true, (v_cooldown_minutes * 60 - v_elapsed_seconds);
  end if;
end;
$$;

revoke execute on function check_login_throttle(text) from public;
grant execute on function check_login_throttle(text) to anon, authenticated;

-- A successful login clears this email's failure history — otherwise a
-- legitimate user who mistypes their password a few times keeps
-- accumulating toward lockout across separate, unrelated future visits.
create or replace function record_login_event()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  insert into login_events (user_id, success) values (auth.uid(), true);
  select email into v_email from profiles where id = auth.uid();
  if v_email is not null then
    delete from login_failures where email = lower(trim(v_email));
  end if;
end;
$$;
