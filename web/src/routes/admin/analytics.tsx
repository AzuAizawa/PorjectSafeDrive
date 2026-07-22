import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { LineChart } from '@/components/charts/line-chart';
import { BarChart } from '@/components/charts/bar-chart';
import { FunnelChart } from '@/components/charts/funnel-chart';
import { SuggestionCard } from '@/components/charts/suggestion-card';
import { formatCurrency } from '@/lib/utils';

function weekStartLabel(iso: string) {
  const d = new Date(iso);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // back up to Monday
  d.setDate(d.getDate() + diff);
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}
function weekKey(iso: string) {
  const d = new Date(iso);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

async function fetchAnalytics() {
  const twelveWeeksAgo = new Date(Date.now() - 84 * 86_400_000).toISOString();

  const [{ data: bookings }, { count: totalBookings }, { count: accepted }, { count: paid }, { count: completed }, { count: activeVehicles }, { count: disputeCount }] =
    await Promise.all([
      supabase
        .from('bookings')
        .select('created_at, commission, vehicle:vehicles(pickup_location, model:car_models(name, brand:car_brands(name)))')
        .gte('created_at', twelveWeeksAgo)
        .order('created_at'),
      supabase.from('bookings').select('*', { count: 'exact', head: true }),
      supabase.from('bookings').select('*', { count: 'exact', head: true }).not('status', 'in', '(pending_owner,owner_rejected,expired)'),
      supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('downpayment_paid', true),
      supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('vehicles').select('*', { count: 'exact', head: true }).eq('approval_status', 'approved').eq('listing_status', 'active'),
      supabase.from('disputes').select('*', { count: 'exact', head: true }),
    ]);

  const trend = new Map<string, { count: number; revenue: number }>();
  const modelCounts = new Map<string, number>();
  const locationCounts = new Map<string, number>();

  for (const b of (bookings ?? []) as any[]) {
    const key = weekKey(b.created_at);
    const bucket = trend.get(key) ?? { count: 0, revenue: 0 };
    bucket.count += 1;
    bucket.revenue += Number(b.commission);
    trend.set(key, bucket);

    const vehicle = b.vehicle;
    if (vehicle?.model) {
      const modelName = `${vehicle.model.brand?.name ?? ''} ${vehicle.model.name}`.trim();
      modelCounts.set(modelName, (modelCounts.get(modelName) ?? 0) + 1);
    }
    if (vehicle?.pickup_location) {
      locationCounts.set(vehicle.pickup_location, (locationCounts.get(vehicle.pickup_location) ?? 0) + 1);
    }
  }

  const sortedWeeks = [...trend.keys()].sort();
  const bookingsTrend = sortedWeeks.map((k) => ({ label: weekStartLabel(k), value: trend.get(k)!.count }));
  const revenueTrend = sortedWeeks.map((k) => ({ label: weekStartLabel(k), value: trend.get(k)!.revenue }));

  const topModels = [...modelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }));
  const topLocations = [...locationCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }));

  const disputeRate = completed && completed > 0 ? Math.round(((disputeCount ?? 0) / completed) * 100) : 0;

  return {
    bookingsTrend,
    revenueTrend,
    topModels,
    topLocations,
    funnel: [
      { label: 'Requested', value: totalBookings ?? 0 },
      { label: 'Accepted', value: accepted ?? 0 },
      { label: 'Paid', value: paid ?? 0 },
      { label: 'Completed', value: completed ?? 0 },
    ],
    activeVehicles: activeVehicles ?? 0,
    disputeRate,
    topLocationName: topLocations[0]?.label,
    topLocationCount: topLocations[0]?.value ?? 0,
    topModelName: topModels[0]?.label,
  };
}

export function AdminAnalyticsPage() {
  const { data } = useQuery({ queryKey: ['admin-analytics'], queryFn: fetchAnalytics });

  if (!data) return <p className="text-muted">Loading…</p>;

  const suggestions: { severity: 'info' | 'warn' | 'good'; text: string }[] = [];
  if (data.topLocationName && data.activeVehicles > 0 && data.topLocationCount >= 3) {
    suggestions.push({
      severity: 'info',
      text: `${data.topLocationName} accounts for the most bookings in the last 12 weeks (${data.topLocationCount}) — consider recruiting more listers in that area if supply feels tight there.`,
    });
  }
  if (data.topModelName) {
    suggestions.push({ severity: 'good', text: `${data.topModelName} is the most-booked model in the last 12 weeks.` });
  }
  if (data.disputeRate >= 15) {
    suggestions.push({ severity: 'warn', text: `${data.disputeRate}% of completed bookings have an associated dispute — worth reviewing common causes.` });
  } else if (data.disputeRate > 0) {
    suggestions.push({ severity: 'good', text: `Dispute rate is ${data.disputeRate}% of completed bookings — healthy.` });
  }
  const funnelTotal = data.funnel[0].value;
  if (funnelTotal > 0) {
    const completionRate = Math.round((data.funnel[3].value / funnelTotal) * 100);
    if (completionRate < 40 && funnelTotal >= 5) {
      suggestions.push({ severity: 'warn', text: `Only ${completionRate}% of booking requests reach completion — check where the biggest drop-off stage is in the funnel below.` });
    }
  }

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Admin</div>
        <h1 className="text-2xl">Analytics</h1>
        <p className="mt-1.5 text-muted">Trends and patterns across the last 12 weeks.</p>
      </div>

      {suggestions.length > 0 ? (
        <div className="mb-5 flex flex-col gap-2">
          {suggestions.map((s, i) => <SuggestionCard key={i} severity={s.severity} text={s.text} />)}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-5">
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-bold">Bookings per week</h3>
          <LineChart data={data.bookingsTrend} />
        </Card>
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-bold">Commission revenue per week</h3>
          <LineChart data={data.revenueTrend} formatValue={(v) => formatCurrency(v)} />
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-bold">Top vehicle models</h3>
          <BarChart data={data.topModels} />
        </Card>
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-bold">Top pickup locations</h3>
          <BarChart data={data.topLocations} />
        </Card>

        <Card className="col-span-2 p-5">
          <h3 className="mb-3 text-sm font-bold">Booking funnel</h3>
          <FunnelChart stages={data.funnel} />
        </Card>
      </div>
    </div>
  );
}
