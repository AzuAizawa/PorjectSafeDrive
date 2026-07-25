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
import { FileUploadBox, validateFile } from '@/components/file-upload-box';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import { formatDate } from '@/lib/utils';
import { CITY_OPTIONS } from '@/lib/cities';
import type { CarBrand, CarModel, Vehicle, VehicleBlockedDate, VehicleImage } from '@/lib/database.types';

const IMAGE_TYPES = ['image/jpeg', 'image/png'];

const schema = z.object({
  brand_id: z.string().min(1, 'Required'),
  model_id: z.string().min(1, 'Required'),
  plate_number: z
    .string()
    .length(7, 'LTO plates are exactly 7 characters')
    .regex(/^[A-Z0-9]+$/i, 'Letters and numbers only'),
  model_year: z.coerce.number().int().min(1980).max(new Date().getFullYear()),
  transmission: z.enum(['manual', 'automatic']),
  city: z.string().min(1, 'Required'),
  daily_price: z.coerce.number().positive('Must be greater than 0').max(999999, 'That seems too high'),
  pickup_location: z.string().min(1, 'Required').max(200),
  additional_info: z.string().max(1000).optional(),
  owner_contact_number: z.string().min(7, 'Enter a valid phone number').max(15),
  orcr_expiry_date: z.string().min(1, 'Required — the OR/CR renewal date'),
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

async function fetchBlockedDates(vehicleId: string) {
  const { data, error } = await supabase
    .from('vehicle_blocked_dates')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('start_date');
  if (error) throw error;
  return data as VehicleBlockedDate[];
}

const SENSITIVE_FIELDS = ['plate_number', 'model_id', 'model_year', 'orcr_expiry_date'] as const;

export function EditVehiclePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newImages, setNewImages] = useState<File[]>([]);
  const [newImagesError, setNewImagesError] = useState<string | null>(null);
  const [newOrcr, setNewOrcr] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockStart, setBlockStart] = useState('');
  const [blockEnd, setBlockEnd] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [blockError, setBlockError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['vehicle-edit', id], queryFn: () => fetchVehicle(id!), enabled: !!id });
  const { data: blockedDates } = useQuery({
    queryKey: ['vehicle-blocked-dates', id],
    queryFn: () => fetchBlockedDates(id!),
    enabled: !!id,
  });

  const { register, handleSubmit, watch, formState: { errors, dirtyFields } } = useForm<FormInput>({
    resolver: zodResolver(schema),
    values: data
      ? {
          brand_id: data.vehicle.model.brand_id,
          model_id: data.vehicle.model_id,
          plate_number: data.vehicle.plate_number,
          model_year: data.vehicle.model_year ?? new Date().getFullYear(),
          transmission: data.vehicle.transmission,
          city: data.vehicle.city,
          daily_price: data.vehicle.daily_price,
          pickup_location: data.vehicle.pickup_location,
          additional_info: data.vehicle.additional_info ?? '',
          owner_contact_number: data.vehicle.owner_contact_number,
          orcr_expiry_date: data.vehicle.orcr_expiry_date ?? '',
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

  const addBlockedDates = useMutation({
    mutationFn: async () => {
      const { error: insertErr } = await supabase
        .from('vehicle_blocked_dates')
        .insert({ vehicle_id: id, start_date: blockStart, end_date: blockEnd, reason: blockReason || null });
      if (insertErr) throw insertErr;
    },
    onSuccess: () => {
      setBlockStart('');
      setBlockEnd('');
      setBlockReason('');
      setBlockError(null);
      queryClient.invalidateQueries({ queryKey: ['vehicle-blocked-dates', id] });
      queryClient.invalidateQueries({ queryKey: ['vehicle-calendar'] });
    },
    onError: (e: Error) => setBlockError(friendlyErrorMessage(e)),
  });

  const removeBlockedDates = useMutation({
    mutationFn: async (blockedId: string) => {
      const { error: delErr } = await supabase.from('vehicle_blocked_dates').delete().eq('id', blockedId);
      if (delErr) throw delErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-blocked-dates', id] });
      queryClient.invalidateQueries({ queryKey: ['vehicle-calendar'] });
    },
  });

  const submit = useMutation({
    mutationFn: async (values: FormValues) => {
      const { error: updateError } = await supabase
        .from('vehicles')
        .update({
          model_id: values.model_id,
          plate_number: values.plate_number.toUpperCase(),
          model_year: values.model_year,
          transmission: values.transmission,
          city: values.city,
          daily_price: values.daily_price,
          pickup_location: values.pickup_location,
          additional_info: values.additional_info || null,
          owner_contact_number: values.owner_contact_number,
          orcr_expiry_date: values.orcr_expiry_date,
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
    onError: (e: Error) => setError(friendlyErrorMessage(e)),
  });

  function handleNewImagesChange(files: FileList | null) {
    const room = Math.max(0, 4 - (data?.images.length ?? 0));
    const list = Array.from(files ?? []).slice(0, room);
    for (const f of list) {
      const err = validateFile(f, IMAGE_TYPES);
      if (err) { setNewImagesError(err); setNewImages([]); return; }
    }
    setNewImagesError(null);
    setNewImages(list);
  }

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
              Changing the plate number, model, ORCR, or registration expiry sends this vehicle back to admin for
              re-approval. It stays visible with its current details until that's done.
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
              <input className="input-base uppercase" maxLength={7} {...register('plate_number')} />
            </Field>
            <Field label="Model year" error={errors.model_year}>
              <input
                type="number"
                className="input-base"
                min={1980}
                max={new Date().getFullYear()}
                maxLength={4}
                {...register('model_year')}
              />
            </Field>
            <Field label="Transmission" error={errors.transmission}>
              <select className="input-base" {...register('transmission')}>
                <option value="automatic">Automatic</option>
                <option value="manual">Manual</option>
              </select>
            </Field>
            <Field label="Daily price (₱)" error={errors.daily_price}>
              <input type="number" className="input-base" min={1} max={999999} {...register('daily_price')} />
            </Field>
            <Field label="Owner contact number" error={errors.owner_contact_number}>
              <input className="input-base" maxLength={15} {...register('owner_contact_number')} />
            </Field>
            <Field label="OR/CR registration expiry" error={errors.orcr_expiry_date}>
              <input type="date" className="input-base" {...register('orcr_expiry_date')} />
            </Field>
            <Field label="Listing status">
              <select className="input-base" {...register('listing_status')}>
                <option value="active">Active — visible on Browse</option>
                <option value="paused_by_owner">Paused — hidden from Browse</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="City" error={errors.city}>
              <select className="input-base" {...register('city')}>
                {CITY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Pickup / drop-off location" error={errors.pickup_location}>
              <input className="input-base" maxLength={200} {...register('pickup_location')} />
            </Field>
          </div>
          <Field label="Additional info">
            <textarea className="input-base h-20" maxLength={1000} {...register('additional_info')} />
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
              <>
                <label className="mt-2 block cursor-pointer rounded-xl border-2 border-dashed border-line bg-surface-2/70 p-4 text-center text-xs font-semibold text-muted backdrop-blur-sm hover:border-accent hover:text-accent hover:bg-accent-soft/40 hover:-translate-y-px hover:shadow-[0_8px_20px_-12px_rgba(var(--shadow-tint),0.4)]">
                  {newImages.length > 0 ? `📷 ${newImages.length} photo${newImages.length > 1 ? 's' : ''} selected` : '📤 Click to upload — JPG/PNG only'}
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => handleNewImagesChange(e.target.files)}
                  />
                </label>
                {newImagesError ? <p className="mt-1 text-xs text-bad">{newImagesError}</p> : null}
              </>
            ) : null}
          </div>

          <FileUploadBox
            label="Replace ORCR (optional — admin only)"
            accept="image/jpeg,image/png"
            allowedTypes={IMAGE_TYPES}
            hint="JPG/PNG only"
            file={newOrcr}
            onSelect={setNewOrcr}
          />

          {error ? <p className="text-sm text-bad">{error}</p> : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-3.5 p-5">
        <h3 className="mb-1 text-sm font-bold">Blocked Dates</h3>
        <p className="mb-3 text-xs text-muted">
          Mark dates this car is unavailable for personal use — renters will see these greyed out on the booking calendar.
        </p>

        <div className="flex flex-wrap gap-2">
          {blockedDates?.map((bd) => (
            <span key={bd.id} className="flex items-center gap-2 rounded-full bg-warn-soft px-3 py-1 text-xs font-semibold text-warn">
              {formatDate(bd.start_date)} – {formatDate(bd.end_date)}
              {bd.reason ? ` · ${bd.reason}` : ''}
              <button type="button" className="text-warn hover:text-bad" onClick={() => removeBlockedDates.mutate(bd.id)}>
                ✕
              </button>
            </span>
          ))}
          {blockedDates?.length === 0 ? <p className="text-xs text-muted">No blocked dates yet.</p> : null}
        </div>

        <div className="mt-4 grid grid-cols-[1fr_1fr_1.4fr_auto] items-end gap-2">
          <Field label="From">
            <input type="date" className="input-base" value={blockStart} onChange={(e) => setBlockStart(e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" className="input-base" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} />
          </Field>
          <Field label="Reason (optional)">
            <input className="input-base" maxLength={100} value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />
          </Field>
          <Button
            type="button"
            size="sm"
            disabled={!blockStart || !blockEnd || addBlockedDates.isPending}
            onClick={() => addBlockedDates.mutate()}
          >
            Block
          </Button>
        </div>
        {blockError ? <p className="mt-2 text-xs text-bad">{blockError}</p> : null}
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
