import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
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

export function AdminDashboardPage() {
  const { data } = useQuery({ queryKey: ['admin-dashboard'], queryFn: fetchDashboardStats });

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

      <Card className="p-5">
        <h3 className="mb-3 text-sm font-bold">Needs your attention</h3>
        <Row label={`${data?.pendingVerifications ?? 0} pending verifications`} to="/admin/users" />
        <Row label={`${data?.pendingVehicles ?? 0} vehicles pending approval`} to="/admin/vehicles" />
        <Row label={`${data?.openDisputes ?? 0} open disputes`} to="/admin/disputes" />
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
