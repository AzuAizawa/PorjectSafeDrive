import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { LineChart } from '@/components/charts/line-chart';
import { SuggestionCard } from '@/components/charts/suggestion-card';
import { AiInsights } from '@/components/charts/ai-insights';
import { HeatmapChart, type HeatmapCell } from '@/components/charts/heatmap-chart';
import { formatCurrency } from '@/lib/utils';
import type { Booking, CarBrand, CarModel, Vehicle } from '@/lib/database.types';

type VehicleRow = Vehicle & { model: CarModel & { brand: CarBrand } };

function weekKey(iso: string) {
  const d = new Date(iso);
  const day = d.getDay();
  d.setDate(d.getDate() + ((day === 0 ? -6 : 1) - day));
  return d.toISOString().slice(0, 10);
}
function weekLabel(key: string) {
  return new Date(key).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

async function fetchListerAnalytics(ownerId: string) {
  const { data: vehicles, error: vErr } = await supabase
    .from('vehicles')
    .select('*, model:car_models(*, brand:car_brands(*))')
    .eq('owner_id', ownerId);
  if (vErr) throw vErr;

  const vehicleIds = (vehicles as VehicleRow[]).map((v) => v.id);
  const { data: bookings, error: bErr } = vehicleIds.length
    ? await supabase.from('bookings').select('*').in('vehicle_id', vehicleIds)
    : { data: [] as Booking[], error: null };
  if (bErr) throw bErr;

  const { data: reviews } = await supabase.from('reviews').select('rating').eq('reviewee_id', ownerId).eq('is_hidden', false);
  const overallRating = reviews && reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;

  const revenueByWeek = new Map<string, number>();
  const peakTimeCounts = new Map<string, number>();
  for (const b of bookings as Booking[]) {
    const day = new Date(`${b.start_date}T12:00:00`).getDay();
    const hour = Number(String(b.pickup_time).slice(0, 2));
    const peakKey = `${day}-${hour}`;
    peakTimeCounts.set(peakKey, (peakTimeCounts.get(peakKey) ?? 0) + 1);
  }
  const peakTimes: HeatmapCell[] = [...peakTimeCounts.entries()].map(([key, value]) => {
    const [day, hour] = key.split('-').map(Number);
    return { day, hour, value };
  });

  const perVehicle = (vehicles as VehicleRow[]).map((v) => {
    const vBookings = (bookings as Booking[]).filter((b) => b.vehicle_id === v.id);
    const completed = vBookings.filter((b) => b.status === 'completed');
    const revenue = completed.reduce((s, b) => s + Number(b.base_price), 0);
    const bookedDays = vBookings
      .filter((b) => ['active', 'completed'].includes(b.status))
      .reduce((s, b) => s + b.total_days, 0);
    const daysListed = Math.max(1, Math.round((Date.now() - new Date(v.created_at).getTime()) / 86_400_000));
    const occupancy = Math.min(100, Math.round((bookedDays / daysListed) * 100));

    const lastBooking = vBookings.length > 0
      ? Math.max(...vBookings.map((b) => new Date(b.created_at).getTime()))
      : null;
    const daysSinceLastBooking = lastBooking ? Math.round((Date.now() - lastBooking) / 86_400_000) : null;

    for (const b of completed) {
      const key = weekKey(b.created_at);
      revenueByWeek.set(key, (revenueByWeek.get(key) ?? 0) + Number(b.base_price));
    }

    let suggestion: { severity: 'info' | 'warn' | 'good'; text: string } | null = null;
    if (occupancy >= 70) {
      suggestion = { severity: 'good', text: 'High demand — consider raising your daily price.' };
    } else if (daysSinceLastBooking !== null && daysSinceLastBooking >= 30) {
      suggestion = { severity: 'warn', text: `No bookings in ${daysSinceLastBooking} days — consider lowering price or refreshing photos.` };
    } else if (daysListed >= 14 && vBookings.length === 0) {
      suggestion = { severity: 'warn', text: 'No bookings since listing — consider lowering price or checking your photos/description.' };
    }

    return {
      vehicle: v,
      bookingsCount: completed.length,
      revenue,
      occupancy,
      suggestion,
    };
  });

  const sortedWeeks = [...revenueByWeek.keys()].sort();
  const revenueTrend = sortedWeeks.map((k) => ({ label: weekLabel(k), value: revenueByWeek.get(k)! }));

  return { perVehicle, revenueTrend, overallRating, peakTimes };
}

export function ListerAnalyticsTab({ ownerId }: { ownerId: string }) {
  const { data } = useQuery({ queryKey: ['lister-analytics', ownerId], queryFn: () => fetchListerAnalytics(ownerId) });

  if (!data) return <p className="text-muted">Loading…</p>;

  return (
    <div>
      <AiInsights
        role="lister"
        stats={{
          overallRating: data.overallRating,
          revenueTrend: data.revenueTrend,
          vehicles: data.perVehicle.map((p) => ({
            model: `${p.vehicle.model.brand.name} ${p.vehicle.model.name}`,
            bookingsCount: p.bookingsCount,
            revenue: p.revenue,
            occupancyPercent: p.occupancy,
          })),
        }}
      />

      {data.overallRating !== null ? (
        <Card className="mb-5 flex items-center justify-between p-5">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-muted">Your overall rating</div>
            <div className="text-2xl font-bold">★ {data.overallRating.toFixed(1)}</div>
          </div>
        </Card>
      ) : null}

      <Card className="mb-5 p-5">
        <h3 className="mb-3 text-sm font-bold">Revenue per week (completed bookings)</h3>
        {data.revenueTrend.length > 0 ? (
          <LineChart data={data.revenueTrend} formatValue={(v) => formatCurrency(v)} />
        ) : (
          <p className="text-sm text-muted">No completed bookings yet.</p>
        )}
      </Card>

      <Card className="mb-5 p-5">
        <h3 className="mb-1 text-sm font-bold">Peak pickup times</h3>
        <p className="mb-3 text-xs text-muted">When renters schedule pickup for your vehicles, by day of week and hour.</p>
        <HeatmapChart cells={data.peakTimes} />
      </Card>

      <div className="grid grid-cols-2 gap-4">
        {data.perVehicle.map((p) => (
          <Card key={p.vehicle.id} className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-bold">{p.vehicle.model.brand.name} {p.vehicle.model.name}</h4>
              <span className="tabular text-xs text-muted">{p.vehicle.plate_number}</span>
            </div>
            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="tabular text-lg font-bold">{p.bookingsCount}</div>
                <div className="text-[11px] text-muted">Bookings</div>
              </div>
              <div>
                <div className="tabular text-lg font-bold">{formatCurrency(p.revenue)}</div>
                <div className="text-[11px] text-muted">Revenue</div>
              </div>
              <div>
                <div className="tabular text-lg font-bold">{p.occupancy}%</div>
                <div className="text-[11px] text-muted">Occupancy</div>
              </div>
            </div>
            {p.suggestion ? <SuggestionCard severity={p.suggestion.severity} text={p.suggestion.text} /> : null}
          </Card>
        ))}
        {data.perVehicle.length === 0 ? <p className="col-span-2 py-10 text-center text-muted">No vehicles yet.</p> : null}
      </div>
    </div>
  );
}
