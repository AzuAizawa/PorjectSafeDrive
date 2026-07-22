import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { publicUrl, uploadFile, vehicleDocPath, vehicleImagePath } from '@/lib/storage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { CarBrand, CarModel, Vehicle, VehicleImage } from '@/lib/database.types';

const schema = z.object({
  brand_id: z.string().min(1, 'Required'),
  model_id: z.string().min(1, 'Required'),
  plate_number: z.string().length(7, 'LTO plates are 7 characters'),
  model_year: z.coerce.number().int().min(1980).max(new Date().getFullYear()),
  mileage: z.coerce.number().int().nonnegative(),
  daily_price: z.coerce.number().positive('Must be greater than 0'),
  pickup_location: z.string().min(1, 'Required'),
  additional_info: z.string().optional(),
  owner_contact_number: z.string().min(7, 'Enter a valid phone number'),
  requires_deposit: z.boolean(),
  deposit_amount: z.coerce.number().nonnegative().optional(),
  listing_status: z.enum(['active', 'paused_by_owner']),
});
type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

type VehicleRow = Vehicle & { model: CarModel & { brand: CarBrand } };

async function fetchVehicle(id: string) {
  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .select('*, model:car_models(*, brand:car_brands(*))')
    .eq('id', id)
    .single();
  if (error) throw error;
  const { data: images } = await supabase.from('vehicle_images').select('*').eq('vehicle_id', id).order('sort_order');
  const { data: brands } = await supabase.from('car_brands').select('*').order('name');
  const { data: models } = await supabase.from('car_models').select('*').order('name');
  return { vehicle: vehicle as VehicleRow, images: (images ?? []) as VehicleImage[], brands: brands as CarBrand[], models: models as CarModel[] };
}

const SENSITIVE_FIELDS = ['plate_number', 'model_id', 'model_year'] as const;

export function EditVehiclePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newImages, setNewImages] = useState<File[]>([]);
  const [newOrcr, setNewOrcr] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['vehicle-edit', id], queryFn: () => fetchVehicle(id!), enabled: !!id });

  const { register, handleSubmit, watch, formState: { errors, dirtyFields } } = useForm<FormInput>({
    resolver: zodResolver(schema),
    values: data
      ? {
          brand_id: data.vehicle.model.brand_id,
          model_id: data.vehicle.model_id,
          plate_number: data.vehicle.plate_number,
          model_year: data.vehicle.model_year ?? new Date().getFullYear(),
          mileage: data.vehicle.mileage,
          daily_price: data.vehicle.daily_price,
          pickup_location: data.vehicle.pickup_location,
          additional_info: data.vehicle.additional_info ?? '',
          owner_contact_number: data.vehicle.owner_contact_number,
          requires_deposit: data.vehicle.requires_deposit,
          deposit_amount: data.vehicle.deposit_amount ?? undefined,
          listing_status: data.vehicle.listing_status === 'paused_over_quota' ? 'paused_by_owner' : data.vehicle.listing_status,
        }
      : undefined,
  });
  const selectedBrandId = watch('brand_id');
  const requiresDeposit = watch('requires_deposit');
  const modelsForBrand = data?.models.filter((m) => m.brand_id === selectedBrandId) ?? [];
  const touchesSensitiveField = SENSITIVE_FIELDS.some((f) => dirtyFields[f]) || !!newOrcr;

  const deleteImage = useMutation({
    mutationFn: async (imageId: string) => {
      const { error: delErr } = await supabase.from('vehicle_images').delete().eq('id', imageId);
      if (delErr) throw delErr;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vehicle-edit', id] }),
  });

  const submit = useMutation({
    mutationFn: async (values: FormValues) => {
      const { error: updateError } = await supabase
        .from('vehicles')
        .update({
          model_id: values.model_id,
          plate_number: values.plate_number,
          model_year: values.model_year,
          mileage: values.mileage,
          daily_price: values.daily_price,
          pickup_location: values.pickup_location,
          additional_info: values.additional_info || null,
          owner_contact_number: values.owner_contact_number,
          requires_deposit: values.requires_deposit,
          deposit_amount: values.requires_deposit ? values.deposit_amount : null,
          listing_status: values.listing_status,
        })
        .eq('id', id);
      if (updateError) throw updateError;

      const existingCount = data!.images.length;
      const room = Math.max(0, 4 - existingCount);
      const toUpload = newImages.slice(0, room);
      for (let i = 0; i < toUpload.length; i++) {
        const path = vehicleImagePath(id!, existingCount + i, toUpload[i]);
        await uploadFile('car-images', path, toUpload[i]);
        await supabase.from('vehicle_images').insert({ vehicle_id: id, storage_path: path, sort_order: existingCount + i });
      }

      if (newOrcr) {
        const orcrPath = vehicleDocPath(id!, 'orcr', newOrcr);
        await uploadFile('vehicle-documents', orcrPath, newOrcr);
        await supabase.from('vehicles').update({ orcr_path: orcrPath }).eq('id', id);
      }
    },
    onSuccess: () => navigate('/my-vehicles'),
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading || !data) return <p className="text-muted">Loading…</p>;

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-3.5" onClick={() => navigate('/my-vehicles')}>
        ← Back to My Vehicles
      </Button>
      <h1 className="mb-5 text-2xl">Edit {data.vehicle.model.brand.name} {data.vehicle.model.name}</h1>

      <Card className="p-5">
        <form onSubmit={handleSubmit((v) => submit.mutate(schema.parse(v)))} className="flex flex-col gap-4">
          {touchesSensitiveField ? (
            <p className="rounded-md border border-warn bg-warn-soft p-3 text-xs text-warn">
              Changing the plate number, model, or ORCR sends this vehicle back to admin for re-approval. It stays
              visible with its current details until that's done.
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Brand" error={errors.brand_id}>
              <select className="input-base" {...register('brand_id')}>
                {data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Model" error={errors.model_id}>
              <select className="input-base" {...register('model_id')}>
                {modelsForBrand.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Plate number" error={errors.plate_number}>
              <input className="input-base" {...register('plate_number')} />
            </Field>
            <Field label="Model year" error={errors.model_year}>
              <input type="number" className="input-base" {...register('model_year')} />
            </Field>
            <Field label="Mileage (km)" error={errors.mileage}>
              <input type="number" className="input-base" {...register('mileage')} />
            </Field>
            <Field label="Daily price (₱)" error={errors.daily_price}>
              <input type="number" className="input-base" {...register('daily_price')} />
            </Field>
            <Field label="Owner contact number" error={errors.owner_contact_number}>
              <input className="input-base" {...register('owner_contact_number')} />
            </Field>
            <Field label="Listing status">
              <select className="input-base" {...register('listing_status')}>
                <option value="active">Active — visible on Browse</option>
                <option value="paused_by_owner">Paused — hidden from Browse</option>
              </select>
            </Field>
          </div>

          <Field label="Pickup / drop-off location" error={errors.pickup_location}>
            <input className="input-base" {...register('pickup_location')} />
          </Field>
          <Field label="Additional info">
            <textarea className="input-base h-20" {...register('additional_info')} />
          </Field>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="deposit" className="h-4 w-4" {...register('requires_deposit')} />
            <label htmlFor="deposit" className="text-sm font-semibold">Require a security deposit</label>
          </div>
          {requiresDeposit ? (
            <Field label="Deposit amount (₱)" error={errors.deposit_amount}>
              <input type="number" className="input-base" {...register('deposit_amount')} />
            </Field>
          ) : null}

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Photos ({data.images.length}/4)</p>
            <div className="grid grid-cols-4 gap-2">
              {data.images.map((img) => (
                <div key={img.id} className="relative">
                  <img src={publicUrl('car-images', img.storage_path)!} className="h-20 w-full rounded-md object-cover" />
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white"
                    onClick={() => deleteImage.mutate(img.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {data.images.length < 4 ? (
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png"
                className="mt-2"
                onChange={(e) => setNewImages(Array.from(e.target.files ?? []).slice(0, 4 - data.images.length))}
              />
            ) : null}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Replace ORCR (optional — admin only)</p>
            <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setNewOrcr(e.target.files?.[0] ?? null)} />
          </div>

          {error ? <p className="text-sm text-bad">{error}</p> : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: { message?: string }; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-bold uppercase tracking-wide text-muted">{label}</label>
      {children}
      {error ? <p className="text-xs text-bad">{error.message}</p> : null}
    </div>
  );
}
