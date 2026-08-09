import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import type { BodyType, CarBodyType, CarBrand, CarModel, FuelType } from '@/lib/database.types';

async function fetchCatalog() {
  const { data: brands, error: e1 } = await supabase.from('car_brands').select('*').order('name');
  if (e1) throw e1;
  const { data: models, error: e2 } = await supabase.from('car_models').select('*').order('name');
  if (e2) throw e2;
  const { data: bodyTypes, error: e3 } = await supabase.from('car_body_types').select('*').order('name');
  if (e3) throw e3;
  return { brands: brands as CarBrand[], models: models as CarModel[], bodyTypes: bodyTypes as CarBodyType[] };
}

export function AdminCatalogPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin-catalog'], queryFn: fetchCatalog });

  const [newBrand, setNewBrand] = useState('');
  const [newBodyType, setNewBodyType] = useState('');
  const [newBodyTypeSeats, setNewBodyTypeSeats] = useState(5);
  const [form, setForm] = useState({ brand_id: '', name: '', body_type: '' as BodyType, seats: 5, fuel_type: 'gasoline' as FuelType });

  // Body types load asynchronously (no longer a hardcoded default like the
  // old 'sedan' literal) — once the catalog arrives, default the Add Model
  // form to the first one so the select isn't left empty.
  useEffect(() => {
    if (data?.bodyTypes.length && !form.body_type) {
      setForm((f) => ({ ...f, body_type: data.bodyTypes[0].name, seats: data.bodyTypes[0].default_seats }));
    }
  }, [data?.bodyTypes, form.body_type]);

  const [actionError, setActionError] = useState<string | null>(null);
  const invalidate = () => {
    setActionError(null);
    queryClient.invalidateQueries({ queryKey: ['admin-catalog'] });
  };
  const onActionError = (e: unknown) => setActionError(friendlyErrorMessage(e));

  const addBrand = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('car_brands').insert({ name });
      if (error) throw error;
    },
    onSuccess: () => { setNewBrand(''); invalidate(); },
    onError: onActionError,
  });

  const addBodyType = useMutation({
    mutationFn: async (vars: { name: string; default_seats: number }) => {
      const { error } = await supabase.from('car_body_types').insert({ name: vars.name.toLowerCase(), default_seats: vars.default_seats });
      if (error) throw error;
    },
    onSuccess: () => { setNewBodyType(''); setNewBodyTypeSeats(5); invalidate(); },
    onError: onActionError,
  });
  const deleteBodyType = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('car_body_types').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onActionError,
  });

  const addModel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('car_models').insert(form);
      if (error) throw error;
    },
    onSuccess: () => { setForm((f) => ({ ...f, name: '' })); invalidate(); },
    onError: onActionError,
  });

  const deleteBrand = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('car_brands').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onActionError,
  });
  const deleteModel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('car_models').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onActionError,
  });

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Admin</div>
        <h1 className="text-2xl">Car Catalog</h1>
        <p className="mt-1.5 text-muted">Brands and models available to listers when adding a vehicle.</p>
      </div>

      {actionError ? (
        <p className="mb-4 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad">{actionError}</p>
      ) : null}

      <div className="grid grid-cols-3 gap-5 max-[1000px]:grid-cols-1">
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-bold">Brands</h3>
          <div className="mb-3 flex gap-2">
            <input className="input-base" placeholder="New brand name" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} />
            <Button size="sm" disabled={!newBrand || addBrand.isPending} onClick={() => addBrand.mutate(newBrand)}>Add</Button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {data?.brands.map((b) => (
              <li key={b.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
                {b.name}
                <button className="text-xs text-bad" onClick={() => deleteBrand.mutate(b.id)}>Remove</button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-bold">Body Types</h3>
          <p className="mb-3 text-xs text-muted">
            Used by Add Model below and shown as a filter on Browse — add a new one here first if a model doesn't
            fit any existing type.
          </p>
          <div className="mb-3 flex gap-2">
            <input
              className="input-base"
              placeholder="e.g. limousine"
              value={newBodyType}
              onChange={(e) => setNewBodyType(e.target.value)}
            />
            <input
              type="number"
              min={1}
              className="input-base w-24"
              placeholder="Seats"
              value={newBodyTypeSeats}
              onChange={(e) => setNewBodyTypeSeats(Number(e.target.value))}
            />
            <Button
              size="sm"
              disabled={!newBodyType || addBodyType.isPending}
              onClick={() => addBodyType.mutate({ name: newBodyType, default_seats: newBodyTypeSeats })}
            >
              Add
            </Button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {data?.bodyTypes.map((bt) => (
              <li key={bt.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm capitalize">
                {bt.name} <span className="tabular text-xs text-muted">{bt.default_seats} seats default</span>
                <button className="text-xs text-bad" onClick={() => deleteBodyType.mutate(bt.id)}>Remove</button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-bold">Add Model</h3>
          <div className="flex flex-col gap-2.5">
            <select className="input-base" value={form.brand_id} onChange={(e) => setForm((f) => ({ ...f, brand_id: e.target.value }))}>
              <option value="">Select brand</option>
              {data?.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <input className="input-base" placeholder="Model name (e.g. Vios)" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <select
              className="input-base"
              value={form.body_type}
              onChange={(e) => {
                const body_type = e.target.value as BodyType;
                const match = data?.bodyTypes.find((bt) => bt.name === body_type);
                setForm((f) => ({ ...f, body_type, seats: match?.default_seats ?? f.seats }));
              }}
            >
              {data?.bodyTypes.map((bt) => <option key={bt.id} value={bt.name}>{bt.name}</option>)}
            </select>
            <input type="number" className="input-base" value={form.seats} onChange={(e) => setForm((f) => ({ ...f, seats: Number(e.target.value) }))} />
            <select className="input-base" value={form.fuel_type} onChange={(e) => setForm((f) => ({ ...f, fuel_type: e.target.value as FuelType }))}>
              <option value="gasoline">gasoline</option>
              <option value="diesel">diesel</option>
              <option value="electric">electric</option>
              <option value="hybrid">hybrid</option>
            </select>
            <Button disabled={!form.brand_id || !form.name || addModel.isPending} onClick={() => addModel.mutate()}>
              Add Model
            </Button>
          </div>
        </Card>
      </div>

      <div className="mt-5 rounded-2xl border border-line bg-surface">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
              <th className="px-4 py-3">Brand</th><th className="px-4 py-3">Model</th><th className="px-4 py-3">Body</th>
              <th className="px-4 py-3">Seats</th><th className="px-4 py-3">Fuel</th><th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data?.models.map((m) => (
              <tr key={m.id} className="border-t border-line text-[13.5px]">
                <td className="px-4 py-3 font-bold">{data.brands.find((b) => b.id === m.brand_id)?.name}</td>
                <td className="px-4 py-3">{m.name}</td>
                <td className="px-4 py-3">{m.body_type}</td>
                <td className="tabular px-4 py-3">{m.seats}</td>
                <td className="px-4 py-3">{m.fuel_type}</td>
                <td className="px-4 py-3"><button className="text-xs text-bad" onClick={() => deleteModel.mutate(m.id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
