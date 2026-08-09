import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { LineChart } from '@/components/charts/line-chart';
import { BarChart } from '@/components/charts/bar-chart';
import { FunnelChart } from '@/components/charts/funnel-chart';
import { HeatmapChart, type HeatmapCell } from '@/components/charts/heatmap-chart';
import { SuggestionCard } from '@/components/charts/suggestion-card';
import { AiInsights } from '@/components/charts/ai-insights';
import { PeriodNav } from '@/components/charts/period-nav';
import { periodRange, periodLabel, bucketByPeriod, type TrendGranularity } from '@/lib/trend-periods';
import { formatCurrency } from '@/lib/utils';

// The fixed 12-week window feeding top models/locations/dispute rate/funnel
// is deliberately separate from the drill-down trend query below — those
// summarize recent activity, not a browsable arbitrary period.
async function fetchAnalytics() {
  const twelveWeeksAgo = new Date(Date.now() - 84 * 86_400_000).toISOString();

  const [{ data: bookings }, { count: totalBookings }, { count: accepted }, { count: paid }, { count: completed }, { count: activeVehicles }, { count: disputeCount }] =
    await Promise.all([
      supabase
        .from('bookings')
        .select('start_date, pickup_time, vehicle:vehicles(pickup_location, model:car_models(name, brand:car_brands(name)))')
        .gte('created_at', twelveWeeksAgo)
        .order('created_at'),
      supabase.from('bookings').select('*', { count: 'exact', head: true }),
      supabase.from('bookings').select('*', { count: 'exact', head: true }).not('status', 'in', '(pending_owner,owner_rejected,expired)'),
      supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('downpayment_paid', true),
      supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('vehicles').select('*', { count: 'exact', head: true }).eq('approval_status', 'approved').eq('listing_status', 'active'),
      supabase.from('disputes').select('*', { count: 'exact', head: true }),
    ]);

  const modelCounts = new Map<string, number>();
  const locationCounts = new Map<string, number>();
  const peakTimeCounts = new Map<string, number>();

  for (const b of (bookings ?? []) as any[]) {
    const vehicle = b.vehicle;
    if (vehicle?.model) {
      const modelName = `${vehicle.model.brand?.name ?? ''} ${vehicle.model.name}`.trim();
      modelCounts.set(modelName, (modelCounts.get(modelName) ?? 0) + 1);
    }
    if (vehicle?.pickup_location) {
      locationCounts.set(vehicle.pickup_location, (locationCounts.get(vehicle.pickup_location) ?? 0) + 1);
    }
    if (b.start_date && b.pickup_time) {
      const day = new Date(`${b.start_date}T12:00:00`).getDay();
      const hour = Number(String(b.pickup_time).slice(0, 2));
      const peakKey = `${day}-${hour}`;
      peakTimeCounts.set(peakKey, (peakTimeCounts.get(peakKey) ?? 0) + 1);
    }
  }
  const peakTimes: HeatmapCell[] = [...peakTimeCounts.entries()].map(([key, value]) => {
    const [day, hour] = key.split('-').map(Number);
    return { day, hour, value };
  });

  const topModels = [...modelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }));
  const topLocations = [...locationCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }));

  const disputeRate = completed && completed > 0 ? Math.round(((disputeCount ?? 0) / completed) * 100) : 0;

  return {
    topModels,
    topLocations,
    peakTimes,
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

// Fetches only the rows inside the currently-viewed period (a day/week/
// month, wherever the user has navigated to) rather than a fixed window —
// the drill-down is browsable, so the query has to follow it.
async function fetchTrend(granularity: TrendGranularity, reference: Date) {
  const { start, end } = periodRange(granularity, reference);
  const { data, error } = await supabase
    .from('bookings')
    .select('created_at, commission')
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString());
  if (error) throw error;

  const rows = (data ?? []) as { created_at: string; commission: number }[];
  return {
    bookingsTrend: bucketByPeriod(rows, (r) => r.created_at, () => 1, granularity, reference),
    revenueTrend: bucketByPeriod(rows, (r) => r.created_at, (r) => Number(r.commission), granularity, reference),
  };
}

export function AdminAnalyticsPage() {
  const { data } = useQuery({ queryKey: ['admin-analytics'], queryFn: fetchAnalytics });
  const [granularity, setGranularity] = useState<TrendGranularity>('week');
  const [reference, setReference] = useState(() => new Date());
  const { data: trend } = useQuery({
    queryKey: ['admin-trend', granularity, reference.toDateString()],
    queryFn: () => fetchTrend(granularity, reference),
  });

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
        <p className="mt-1.5 text-muted">
          Top models/locations, dispute rate, and the funnel below cover the last 12 weeks. The bookings and revenue
          charts drill down by day, week, or month — use the controls below to browse any period.
        </p>
      </div>

      <AiInsights
        role="admin"
        stats={{
          selectedPeriod: { granularity, label: periodLabel(granularity, reference) },
          bookingsTrend: trend?.bookingsTrend ?? [],
          revenueTrend: trend?.revenueTrend ?? [],
          topModels: data.topModels,
          topLocations: data.topLocations,
          funnel: data.funnel,
          activeVehicles: data.activeVehicles,
          disputeRatePercent: data.disputeRate,
        }}
      />

      {suggestions.length > 0 ? (
        <div className="mb-5 flex flex-col gap-2">
          {suggestions.map((s, i) => <SuggestionCard key={i} severity={s.severity} text={s.text} />)}
        </div>
      ) : null}

      <Card className="mb-5 p-5">
        <PeriodNav granularity={granularity} reference={reference} onGranularityChange={setGranularity} onReferenceChange={setReference} />
        <div className="grid grid-cols-2 gap-5">
          <div>
            <h3 className="mb-3 text-sm font-bold">Bookings</h3>
            {trend && trend.bookingsTrend.some((p) => p.value > 0) ? (
              <LineChart data={trend.bookingsTrend} />
            ) : (
              <p className="text-sm text-muted">No bookings in this period.</p>
            )}
          </div>
          <div>
            <h3 className="mb-3 text-sm font-bold">Commission revenue</h3>
            {trend && trend.revenueTrend.some((p) => p.value > 0) ? (
              <LineChart data={trend.revenueTrend} formatValue={(v) => formatCurrency(v)} />
            ) : (
              <p className="text-sm text-muted">No revenue in this period.</p>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-5">
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

        <Card className="col-span-2 p-5">
          <h3 className="mb-1 text-sm font-bold">Peak pickup times</h3>
          <p className="mb-3 text-xs text-muted">When renters schedule pickup, by day of week and hour — last 12 weeks.</p>
          <HeatmapChart cells={data.peakTimes} />
        </Card>
      </div>
    </div>
  );
}
