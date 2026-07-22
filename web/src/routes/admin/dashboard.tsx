import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { formatCurrency } from '@/lib/utils';

async function fetchDashboardStats() {
  const [{ count: totalUsers }, { count: pendingVerifications }, { count: activeListings }, { count: activeBookings }, { data: revenueRows }, { count: openDisputes }] =
    await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('verified_status', 'pending'),
      supabase.from('vehicles').select('*', { count: 'exact', head: true }).eq('approval_status', 'approved').eq('listing_status', 'active'),
      supabase.from('bookings').select('*', { count: 'exact', head: true }).in('status', ['downpayment_paid', 'fully_paid', 'active']),
      supabase.from('bookings').select('commission').eq('downpayment_paid', true),
      supabase.from('disputes').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    ]);

  const { count: pendingVehicles } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .eq('approval_status', 'pending');

  const revenue = (revenueRows ?? []).reduce((sum, r) => sum + Number(r.commission), 0);

  return { totalUsers, pendingVerifications, activeListings, activeBookings, revenue, openDisputes, pendingVehicles };
}

interface CronHealthRow {
  job_name: string;
  last_run: string | null;
  last_status: string | null;
}

async function fetchCronHealth() {
  const { data, error } = await supabase.rpc('get_cron_health');
  if (error) throw error;
  return data as CronHealthRow[];
}

const JOB_LABELS: Record<string, string> = {
  'expire-stale-bookings': 'Expire stale bookings (hourly)',
  'auto-complete-bookings': 'Auto-complete bookings (daily)',
};

export function AdminDashboardPage() {
  const { data } = useQuery({ queryKey: ['admin-dashboard'], queryFn: fetchDashboardStats });
  const { data: cronHealth } = useQuery({ queryKey: ['cron-health'], queryFn: fetchCronHealth });

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Admin</div>
        <h1 className="text-2xl">Dashboard</h1>
        <p className="mt-1.5 text-muted">System-wide overview.</p>
      </div>

      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5">
        <Stat label="Total Users" value={data?.totalUsers ?? '—'} />
        <Stat label="Pending Verifications" value={data?.pendingVerifications ?? '—'} />
        <Stat label="Active Listings" value={data?.activeListings ?? '—'} />
        <Stat label="Active Bookings" value={data?.activeBookings ?? '—'} />
        <Stat label="Commission Revenue" value={data ? formatCurrency(data.revenue) : '—'} />
      </div>

      <Card className="mb-5 p-5">
        <h3 className="mb-3 text-sm font-bold">Needs your attention</h3>
        <Row label={`${data?.pendingVerifications ?? 0} pending verifications`} to="/admin/users" />
        <Row label={`${data?.pendingVehicles ?? 0} vehicles pending approval`} to="/admin/vehicles" />
        <Row label={`${data?.openDisputes ?? 0} open disputes`} to="/admin/disputes" />
      </Card>

      <Card className="p-5">
        <h3 className="mb-3 text-sm font-bold">Scheduled jobs</h3>
        {cronHealth?.map((job) => {
          const stale = !job.last_run || Date.now() - new Date(job.last_run).getTime() > 26 * 3_600_000;
          const failed = job.last_status && job.last_status !== 'succeeded';
          return (
            <div key={job.job_name} className="flex items-center justify-between border-b border-line py-3 text-sm last:border-none">
              <div>
                <div className="font-semibold">{JOB_LABELS[job.job_name] ?? job.job_name}</div>
                <div className="text-xs text-muted">
                  {job.last_run ? `Last ran ${new Date(job.last_run).toLocaleString()}` : 'Never run yet'}
                </div>
              </div>
              {failed ? (
                <Pill tone="bad">Failed</Pill>
              ) : stale ? (
                <Pill tone="warn">No recent run</Pill>
              ) : (
                <Pill tone="good">Healthy</Pill>
              )}
            </div>
          );
        })}
        {!cronHealth || cronHealth.length === 0 ? <p className="text-sm text-muted">No job history yet.</p> : null}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4.5">
      <div className="text-xs font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="tabular mt-1 text-3xl font-bold">{value}</div>
    </Card>
  );
}

function Row({ label, to }: { label: string; to: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-3 text-sm last:border-none">
      <span>{label}</span>
      <Link to={to} className="font-semibold text-accent">Review →</Link>
    </div>
  );
}
