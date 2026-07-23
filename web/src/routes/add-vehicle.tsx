import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { uploadFile, vehicleDocPath, vehicleImagePath } from '@/lib/storage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileUploadBox, validateFile } from '@/components/file-upload-box';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import type { CarBrand, CarModel } from '@/lib/database.types';

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
  daily_price: z.coerce.number().positive('Must be greater than 0').max(999999, 'That seems too high'),
  pickup_location: z.string().min(1, 'Required').max(200),
  additional_info: z.string().max(1000).optional(),
  owner_contact_number: z.string().min(7, 'Enter a valid phone number').max(15),
  requires_deposit: z.boolean(),
  deposit_amount: z.coerce.number().nonnegative().optional(),
});
type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

async function fetchCatalog() {
  const { data: brands, error: e1 } = await supabase.from('car_brands').select('*').order('name');
  if (e1) throw e1;
  const { data: models, error: e2 } = await supabase.from('car_models').select('*').order('name');
  if (e2) throw e2;
  const { data: setting } = await supabase.from('platform_settings').select('value').eq('key', 'max_vehicle_age_years').single();
  return { brands: brands as CarBrand[], models: models as CarModel[], maxVehicleAge: Number(setting?.value ?? 15) };
}

async function fetchQuotaStatus(ownerId: string) {
  const { count } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('listing_status', 'active')
    .eq('approval_status', 'approved');
  const { data: capacity } = await supabase.rpc('get_vehicle_slot_capacity', { p_profile_id: ownerId });
  return { activeCount: count ?? 0, capacity: (capacity as unknown as number) ?? 5 };
}

export function AddVehiclePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [carImages, setCarImages] = useState<File[]>([]);
  const [carImagesError, setCarImagesError] = useState<string | null>(null);
  const [orcr, setOrcr] = useState<File | null>(null);
  const [rentalAgreement, setRentalAgreement] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: catalog } = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog });
  const { data: quota } = useQuery({
    queryKey: ['vehicle-quota', profile?.id],
    queryFn: () => fetchQuotaStatus(profile!.id),
    enabled: !!profile,
  });

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormInput>({
    resolver: zodResolver(schema),
    defaultValues: { requires_deposit: false, transmission: 'automatic' },
  });
  const selectedBrandId = watch('brand_id');
  const requiresDeposit = watch('requires_deposit');
  const modelsForBrand = catalog?.models.filter((m) => m.brand_id === selectedBrandId) ?? [];

  function handleCarImagesChange(files: FileList | null) {
    const list = Array.from(files ?? []).slice(0, 4);
    for (const f of list) {
      const err = validateFile(f, IMAGE_TYPES);
      if (err) { setCarImagesError(err); setCarImages([]); return; }
    }
    setCarImagesError(null);
    setCarImages(list);
  }

  const submit = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!orcr) throw new Error('ORCR document is required');
      if (!rentalAgreement) throw new Error('Rental agreement is required');
      if (carImages.length === 0) throw new Error('At least one car photo is required');

      const vehicleId = crypto.randomUUID();

      const { error: insertError } = await supabase.from('vehicles').insert({
        id: vehicleId,
        owner_id: profile!.id,
        model_id: values.model_id,
        plate_number: values.plate_number.toUpperCase(),
        model_year: values.model_year,
        transmission: values.transmission,
        daily_price: values.daily_price,
        pickup_location: values.pickup_location,
        additional_info: values.additional_info || null,
        owner_contact_number: values.owner_contact_number,
        requires_deposit: values.requires_deposit,
        deposit_amount: values.requires_deposit ? values.deposit_amount : null,
      });
      if (insertError) throw insertError;

      // Files can only be uploaded now that the vehicle row exists — storage
      // RLS checks owner_id against a real vehicles row (see 006_storage.sql).
      const imagePaths: string[] = [];
      for (let i = 0; i < carImages.length; i++) {
        const path = vehicleImagePath(vehicleId, i, carImages[i]);
        await uploadFile('car-images', path, carImages[i]);
        imagePaths.push(path);
      }
      await supabase.from('vehicle_images').insert(
        imagePaths.map((storage_path, sort_order) => ({ vehicle_id: vehicleId, storage_path, sort_order }))
      );

      const orcrPath = vehicleDocPath(vehicleId, 'orcr', orcr);
      await uploadFile('vehicle-documents', orcrPath, orcr);

      const rentalAgreementPath = vehicleDocPath(vehicleId, 'rental-agreement', rentalAgreement);
      await uploadFile('vehicle-documents', rentalAgreementPath, rentalAgreement);

      const { error: updateError } = await supabase
        .from('vehicles')
        .update({ orcr_path: orcrPath, rental_agreement_path: rentalAgreementPath })
        .eq('id', vehicleId);
      if (updateError) throw updateError;
    },
    onSuccess: () => navigate('/my-vehicles'),
    onError: (e: Error) => setError(friendlyErrorMessage(e)),
  });

  if (profile && profile.verified_status !== 'verified') {
    return (
      <Card className="p-6 text-center">
        <h1 className="mb-2 text-xl font-bold">Get verified first</h1>
        <p className="mb-4 text-muted">You need to be a verified user before you can list a vehicle.</p>
        <Button onClick={() => navigate('/verify')}>Get Verified</Button>
      </Card>
    );
  }

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-3.5" onClick={() => navigate('/my-vehicles')}>
        ← Back to My Vehicles
      </Button>
      <h1 className="mb-5 text-2xl">Add a Vehicle</h1>

      {quota && quota.activeCount >= quota.capacity ? (
        <Card className="mb-4 border-warn bg-warn-soft p-4 text-sm text-warn">
          You're already using all {quota.capacity} of your listing slots. This vehicle can still be submitted for
          review, but once approved it'll be placed in "Paused — Over Quota" until you free up a slot or subscribe
          for more.
        </Card>
      ) : null}

      <Card className="p-5">
        <form onSubmit={handleSubmit((v) => submit.mutate(schema.parse(v)))} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Brand" error={errors.brand_id}>
              <select className="input-base" {...register('brand_id')}>
                <option value="">Select brand</option>
                {catalog?.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Model" error={errors.model_id}>
              <select className="input-base" {...register('model_id')} disabled={!selectedBrandId}>
                <option value="">Select model</option>
                {modelsForBrand.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Plate number" error={errors.plate_number}>
              <input className="input-base uppercase" placeholder="e.g. NDW1284" maxLength={7} {...register('plate_number')} />
            </Field>
            <Field label="Model year" error={errors.model_year}>
              <input
                type="number"
                className="input-base"
                placeholder={String(new Date().getFullYear())}
                min={1980}
                max={new Date().getFullYear()}
                maxLength={4}
                {...register('model_year')}
              />
              {catalog ? <p className="mt-1 text-[11px] text-muted">Must be within the last {catalog.maxVehicleAge} years.</p> : null}
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
              <input className="input-base" maxLength={15} placeholder="+63 9XX XXX XXXX" {...register('owner_contact_number')} />
            </Field>
          </div>

          <Field label="Pickup / drop-off location" error={errors.pickup_location}>
            <input className="input-base" maxLength={200} {...register('pickup_location')} />
          </Field>
          <Field label="Additional info">
            <textarea className="input-base h-20" maxLength={1000} {...register('additional_info')} />
          </Field>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="deposit" className="h-4 w-4" {...register('requires_deposit')} />
            <label htmlFor="deposit" className="text-sm font-semibold">Require a security deposit</label>
          </div>
          {requiresDeposit ? (
            <Field label="Deposit amount (₱)" error={errors.deposit_amount}>
              <input type="number" className="input-base" min={0} {...register('deposit_amount')} />
            </Field>
          ) : null}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Car photos (up to 4)</p>
              <label className="block cursor-pointer rounded-xl border-2 border-dashed border-line bg-surface-2/70 p-4 text-center text-xs font-semibold text-muted backdrop-blur-sm hover:border-accent hover:text-accent hover:bg-accent-soft/40 hover:-translate-y-px hover:shadow-[0_8px_20px_-12px_rgba(var(--shadow-tint),0.4)]">
                {carImages.length > 0 ? `📷 ${carImages.length} photo${carImages.length > 1 ? 's' : ''} selected` : '📤 Click to upload — JPG/PNG only'}
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={(e) => handleCarImagesChange(e.target.files)}
                />
              </label>
              {carImagesError ? <p className="mt-1 text-xs text-bad">{carImagesError}</p> : null}
            </div>
            <FileUploadBox
              label="ORCR — admin only"
              accept="image/jpeg,image/png"
              allowedTypes={IMAGE_TYPES}
              hint="JPG/PNG only"
              file={orcr}
              onSelect={setOrcr}
            />
            <FileUploadBox
              label="Rental agreement (required)"
              accept="application/pdf"
              allowedTypes={['application/pdf']}
              hint="PDF only"
              file={rentalAgreement}
              onSelect={setRentalAgreement}
            />
          </div>

          {error ? <p className="text-sm text-bad">{error}</p> : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? 'Submitting…' : 'Submit for Approval'}
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
