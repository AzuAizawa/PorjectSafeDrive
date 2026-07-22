-- SafeDrive 2.0 — admin-visible cron health check
-- cron.job_run_details already tracks every run; it's just not reachable
-- via the REST API since only the public schema is exposed. Wrap it.

create or replace function get_cron_health()
returns table(job_name text, last_run timestamptz, last_status text)
language sql
security definer
stable
set search_path = public
as $$
  select j.jobname,
         d.start_time,
         d.status
  from cron.job j
  left join lateral (
    select start_time, status
    from cron.job_run_details
    where jobid = j.jobid
    order by start_time desc
    limit 1
  ) d on true
  where j.jobname in ('expire-stale-bookings', 'auto-complete-bookings');
$$;

grant execute on function get_cron_health() to authenticated;
