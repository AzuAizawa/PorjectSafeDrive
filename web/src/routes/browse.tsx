import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { publicUrl } from '@/lib/storage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';
import type { BodyType, VehicleListing } from '@/lib/database.types';

const BODY_TYPES: { value: BodyType | ''; label: string }[] = [
  { value: '', label: 'All body types' },
  { value: 'sedan', label: 'Sedan' },
  { value: 'suv', label: 'SUV' },
  { value: 'mpv', label: 'MPV' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'hatchback', label: 'Hatchback' },
  { value: 'van', label: 'Van' },
];

async function fetchVehicles(startDate: string, endDate: string): Promise<VehicleListing[]> {
  let availableIds: string[] | null = null;
  if (startDate && endDate) {
    const { data, error } = await supabase.rpc('available_vehicle_ids', { p_start: startDate, p_end: endDate });
    if (error) throw error;
    availableIds = (data ?? []) as string[];
  }

  let query = supabase
    .from('vehicles')
    .select(
      `*, model:car_models(*, brand:car_brands(*)), owner:profiles(id, first_name, last_name),
       vehicle_images(storage_path, sort_order)`
    )
    .eq('approval_status', 'approved')
    .eq('listing_status', 'active');

  if (availableIds) query = query.in('id', availableIds);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    ...row,
    cover_image_url: publicUrl(
      'car-images',
      row.vehicle_images?.sort((a: any, b: any) => a.sort_order - b.sort_order)[0]?.storage_path ?? null
    ),
  }));
}

export function BrowsePage() {
  const [search, setSearch] = useState('');
  const [bodyType, setBodyType] = useState<BodyType | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [queryDates, setQueryDates] = useState({ start: '', end: '' });

  const { data: vehicles, isLoading, error } = useQuery({
    queryKey: ['vehicles', queryDates.start, queryDates.end],
    queryFn: () => fetchVehicles(queryDates.start, queryDates.end),
  });

  const filtered = useMemo(() => {
    if (!vehicles) return [];
    const q = search.toLowerCase();
    return vehicles.filter((v) => {
      const matchesQ =
        !q ||
        v.model.name.toLowerCase().includes(q) ||
        v.model.brand.name.toLowerCase().includes(q) ||
        v.pickup_location.toLowerCase().includes(q);
      const matchesBt = !bodyType || v.model.body_type === bodyType;
      return matchesQ && matchesBt;
    });
  }, [vehicles, search, bodyType]);

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-5">
        <div>
          <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Browse</div>
          <h1 className="text-2xl">Find a car near you</h1>
          <p className="mt-1.5 max-w-[60ch] text-muted">
            {vehicles ? `${vehicles.length} vehicles available` : 'Loading vehicles…'}
          </p>
        </div>
      </div>

      <Card className="mb-4.5 p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            className="input-base min-w-[200px] flex-1"
            placeholder="Search brand, model, or location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input-base w-40"
            value={bodyType}
            onChange={(e) => setBodyType(e.target.value as BodyType | '')}
          >
            {BODY_TYPES.map((bt) => (
              <option key={bt.value} value={bt.value}>
                {bt.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="input-base w-[150px]"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <input
            type="date"
            className="input-base w-[150px]"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={!startDate || !endDate}
            onClick={() => setQueryDates({ start: startDate, end: endDate })}
          >
            Check availability
          </Button>
        </div>
      </Card>

      {error ? <p className="text-bad">{(error as Error).message}</p> : null}
      {isLoading ? <p className="text-muted">Loading…</p> : null}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(272px,1fr))] gap-4.5">
        {filtered.map((v) => (
          <Link
            key={v.id}
            to={`/cars/${v.id}`}
            className="glass block overflow-hidden rounded-2xl border border-line/70 shadow-[0_1px_2px_rgba(20,25,26,0.05),0_12px_28px_-20px_rgba(var(--shadow-tint),0.3)] hover:-translate-y-1 hover:shadow-[0_1px_2px_rgba(20,25,26,0.08),0_24px_48px_-20px_rgba(var(--shadow-tint),0.45)]"
          >
            <div className="h-[150px] bg-surface-2">
              {v.cover_image_url ? (
                <img src={v.cover_image_url} alt={v.model.name} className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="flex flex-col gap-2 p-4">
              <div className="text-[15px] font-bold">
                {v.model.brand.name} {v.model.name}
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted">
                <span>🪑 {v.model.seats} seats</span>
                <span>⛽ {v.model.fuel_type}</span>
                <span>📍 {v.pickup_location}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <div className="tabular text-[17px] font-bold">
                  {formatCurrency(v.daily_price)}
                  <small className="ml-0.5 text-[11px] font-semibold text-muted">/day</small>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {!isLoading && filtered.length === 0 ? (
        <p className="py-16 text-center text-muted">No cars match your filters. Try widening your search.</p>
      ) : null}
    </div>
  );
}
