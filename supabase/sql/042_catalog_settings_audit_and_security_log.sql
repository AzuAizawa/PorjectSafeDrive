-- SafeDrive 2.0 -- two real gaps found while discussing the audit trail with
-- the user: (1) car catalog CRUD (add/edit/delete a brand or model) and
-- platform_settings changes go through direct table writes with zero
-- log_audit() call -- confirmed by reading admin/catalog.tsx and
-- admin/settings.tsx, both do a plain supabase.from(...).insert/update/delete()
-- with nothing else. RLS already restricts these writes to is_admin() (checked
-- 002_rls_policies.sql), so this was never a security hole -- just an
-- accountability one: literally every business-rule number in the system
-- (commission %, cancellation fee %, etc.) could be changed with no record
-- of who changed it or from what value.
--
-- Fixed via triggers rather than converting every client call site into a
-- new RPC -- this guarantees the log entry can't be skipped no matter how
-- the write happens (including a raw SQL UPDATE), matching the same
-- can't-be-bypassed philosophy already used for bookings/payments, and
-- needs zero frontend changes.

create or replace function log_catalog_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_details jsonb;
begin
  if TG_OP = 'INSERT' then
    v_action := TG_TABLE_NAME || '_created';
    v_details := to_jsonb(new);
  elsif TG_OP = 'UPDATE' then
    v_action := TG_TABLE_NAME || '_updated';
    v_details := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
  else
    v_action := TG_TABLE_NAME || '_deleted';
    v_details := to_jsonb(old);
  end if;

  perform log_audit(auth.uid(), v_action, TG_TABLE_NAME, coalesce(new.id, old.id), v_details);
  return coalesce(new, old);
end;
$$;

create trigger trg_car_brands_audit after insert or update or delete on car_brands
  for each row execute function log_catalog_change();
create trigger trg_car_models_audit after insert or update or delete on car_models
  for each row execute function log_catalog_change();

-- platform_settings has no id column (key is the primary key) and is only
-- ever updated (never inserted/deleted through the admin UI -- new keys
-- arrive via migrations), so this is a narrower UPDATE-only trigger that
-- only fires when the value actually changes.
create or replace function log_settings_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.value is distinct from new.value then
    perform log_audit(auth.uid(), 'platform_setting_changed', 'platform_settings', null,
      jsonb_build_object('key', new.key, 'old_value', old.value, 'new_value', new.value));
  end if;
  return new;
end;
$$;

create trigger trg_platform_settings_audit after update on platform_settings
  for each row execute function log_settings_change();

-- ============================================================
-- Security/access log -- distinct from the audit trail (business actions)
-- and genuinely missing: nothing in this codebase tracked logins or IPs.
-- Rather than build a parallel capture system, this reads Supabase Auth's
-- own auth.audit_log_entries table, which already records every login,
-- logout, and password-recovery event with IP address and timestamp --
-- just never surfaced inside SafeDrive's own admin panel. Same
-- cross-schema-read-via-SECURITY-DEFINER pattern already proven working
-- for get_cron_health() reading cron.job_run_details.
-- ============================================================
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
  if not is_admin() then raise exception 'not authorized'; end if;

  return query
    select
      a.created_at,
      nullif(a.ip_address, '') as ip_address,
      a.payload ->> 'action' as action,
      a.payload ->> 'actor_username' as actor_email,
      nullif(trim(concat(p.first_name, ' ', p.last_name)), '') as actor_name
    from auth.audit_log_entries a
    left join profiles p on p.id = nullif(a.payload ->> 'actor_id', '')::uuid
    order by a.created_at desc
    limit p_limit;
end;
$$;

revoke execute on function get_auth_activity_log(int) from public, anon;
grant execute on function get_auth_activity_log(int) to authenticated;
