-- SafeDrive 2.0 -- replace the Security Log's dead data source.
--
-- get_auth_activity_log() (042/044) reads from auth.audit_log_entries, the
-- legacy Postgres-table audit log. Confirmed live (2026-07-25): this
-- project's Auth config has audit_log_disable_postgres = true (Supabase now
-- routes auth events to its own hosted Logs Explorer instead) and it is NOT
-- settable back via the Management API -- a PATCH request returns 200 but
-- silently leaves the value unchanged, i.e. platform-locked for this
-- project. The table has zero rows despite confirmed real logins
-- (auth.users.last_sign_in_at proves it), so Security Log has shown nothing
-- for anyone, admin or renter, since it was built.
--
-- Fix: track logins ourselves via Supabase's "Password Verification
-- Attempt" Auth Hook, which fires on every password sign-in attempt
-- (success or failure) with a {user_id, valid} payload, run by the
-- supabase_auth_admin Postgres role. This hook is a *decision* hook (it can
-- block a login by returning {"decision": "reject"}), so the function is
-- written defensively: any internal error is swallowed rather than raised,
-- and it always returns {"decision": "continue"} -- it only ever observes,
-- never blocks. Wired in via a second Management API call (Auth Hooks
-- aren't SQL-configurable; see the enable step run alongside this
-- migration) and verified live with a real password-grant login before
-- being considered done.

create table login_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  success boolean not null,
  ip_address text,
  occurred_at timestamptz not null default now()
);

alter table login_events enable row level security;

-- No insert policy — the hook function is SECURITY DEFINER (owned by a
-- privileged role) and bypasses RLS on write; nothing client-facing should
-- ever be able to insert a fake row here.
create policy login_events_select_admin on login_events
  for select using (is_admin());

create or replace function hook_log_password_verification_attempt(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into login_events (user_id, success, ip_address)
    values (
      nullif(event->>'user_id', '')::uuid,
      coalesce((event->>'valid')::boolean, false),
      nullif(event->>'ip_address', '')
    );
  exception when others then
    -- A logging failure must never be able to block a real login attempt.
    null;
  end;
  return jsonb_build_object('decision', 'continue');
end;
$$;

revoke execute on function hook_log_password_verification_attempt(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function hook_log_password_verification_attempt(jsonb) to supabase_auth_admin;

-- Same signature/grants as before (042/044) — only the body changes, so no
-- frontend change is needed beyond the page's own description text.
create or replace function get_auth_activity_log(p_limit int default 200)
returns table(
  occurred_at timestamptz,
  ip_address text,
  action text,
  actor_email text,
  actor_name text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin() or is_super_admin()) then raise exception 'not authorized'; end if;

  return query
    select
      e.occurred_at,
      e.ip_address,
      case when e.success then 'login' else 'login_failed' end as action,
      p.email as actor_email,
      nullif(trim(concat(p.first_name, ' ', p.last_name)), '') as actor_name
    from login_events e
    left join profiles p on p.id = e.user_id
    order by e.occurred_at desc
    limit p_limit;
end;
$$;
