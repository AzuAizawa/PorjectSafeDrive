import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { publicUrl } from '@/lib/storage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MultiSelectDropdown } from '@/components/ui/multi-select-dropdown';
import { CITY_OPTIONS, cityLabel } from '@/lib/cities';
import { formatCurrency } from '@/lib/utils';
import type { CarBodyType, CarBrand, CarModel, VehicleListing } from '@/lib/database.types';

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

async function fetchCatalog() {
  const { data: brands, error: e1 } = await supabase.from('car_brands').select('*').order('name');
  if (e1) throw e1;
  const { data: models, error: e2 } = await supabase.from('car_models').select('*').order('name');
  if (e2) throw e2;
  const { data: bodyTypes, error: e3 } = await supabase.from('car_body_types').select('*').order('name');
  if (e3) throw e3;
  return { brands: brands as CarBrand[], models: models as CarModel[], bodyTypes: bodyTypes as CarBodyType[] };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function BrowsePage() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [search, setSearch] = useState('');
  const [bodyTypes, setBodyTypes] = useState<string[]>([]);
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [queryDates, setQueryDates] = useState({ start: '', end: '' });

  const { data: vehicles, isLoading, error } = useQuery({
    queryKey: ['vehicles', queryDates.start, queryDates.end],
    queryFn: () => fetchVehicles(queryDates.start, queryDates.end),
  });
  const { data: catalog } = useQuery({ queryKey: ['browse-catalog'], queryFn: fetchCatalog });

  const bodyTypeOptions = useMemo(
    () => (catalog?.bodyTypes ?? []).map((bt) => ({ value: bt.name, label: capitalize(bt.name) })),
    [catalog]
  );
  const brandOptions = useMemo(
    () => (catalog?.brands ?? []).map((b) => ({ value: b.id, label: b.name })),
    [catalog]
  );
  // Model checklist narrows to whatever brands are checked — if none are
  // checked yet, show every model so it's still usable standalone.
  const modelOptions = useMemo(() => {
    const models = catalog?.models ?? [];
    const scoped = brandIds.length > 0 ? models.filter((m) => brandIds.includes(m.brand_id)) : models;
    return scoped.map((m) => ({ value: m.id, label: m.name }));
  }, [catalog, brandIds]);

  const filtered = useMemo(() => {
    if (!vehicles) return [];
    const q = search.toLowerCase();
    return vehicles.filter((v) => {
      const matchesQ = !q || v.model.name.toLowerCase().includes(q) || v.model.brand.name.toLowerCase().includes(q);
      const matchesBt = bodyTypes.length === 0 || bodyTypes.includes(v.model.body_type);
      const matchesBrand = brandIds.length === 0 || brandIds.includes(v.model.brand_id);
      const matchesModel = modelIds.length === 0 || modelIds.includes(v.model_id);
      const matchesCity = cities.length === 0 || cities.includes(v.city);
      return matchesQ && matchesBt && matchesBrand && matchesModel && matchesCity;
    });
  }, [vehicles, search, bodyTypes, brandIds, modelIds, cities]);

  const dateQuery = queryDates.start && queryDates.end ? `?start=${queryDates.start}&end=${queryDates.end}` : '';

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-5">
        <div>
          <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Browse</div>
          <h1 className="text-2xl">Find a car near you</h1>
          <p className="mt-1.5 max-w-[60ch] text-muted">
            {vehicles ? `${filtered.length} of ${vehicles.length} vehicles match` : 'Loading vehicles…'}
          </p>
        </div>
      </div>

      <Card className="mb-4.5 p-5">
        <div className="flex flex-wrap items-end gap-2.5">
          <input
            className="input-base min-w-[200px] flex-1"
            placeholder="Search brand or model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <MultiSelectDropdown label="Body type" options={bodyTypeOptions} selected={bodyTypes} onChange={setBodyTypes} />
          <MultiSelectDropdown label="Brand" options={brandOptions} selected={brandIds} onChange={setBrandIds} />
          <MultiSelectDropdown label="Model" options={modelOptions} selected={modelIds} onChange={setModelIds} />
          <MultiSelectDropdown label="City" options={[...CITY_OPTIONS]} selected={cities} onChange={setCities} />
          <div className="flex flex-col gap-1">
            <label htmlFor="browse-start-date" className="text-[10.5px] font-bold uppercase tracking-wide text-muted">
              Start date
            </label>
            <input
              id="browse-start-date"
              type="date"
              className="input-base w-[150px]"
              min={todayIso}
              value={startDate}
              onChange={(e) => {
                const v = e.target.value;
                setStartDate(v);
                // Keep the end date valid — if it's no longer strictly after
                // the new start date, clear it rather than leaving a
                // before-start value sitting in the field.
                if (endDate && endDate <= v) setEndDate('');
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="browse-end-date" className="text-[10.5px] font-bold uppercase tracking-wide text-muted">
              End date
            </label>
            <input
              id="browse-end-date"
              type="date"
              className="input-base w-[150px]"
              min={startDate ? addDays(startDate, 1) : todayIso}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <Button variant="secondary" onClick={() => setQueryDates({ start: startDate, end: endDate })}>
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
            to={`/cars/${v.id}${dateQuery}`}
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
                <span>📍 {cityLabel(v.city)}</span>
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
        <EmptyState icon={SearchX} title="No cars match your filters" description="Try widening your search or dates." />
      ) : null}
    </div>
  );
}
