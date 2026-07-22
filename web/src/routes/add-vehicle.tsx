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
import type { CarBrand, CarModel } from '@/lib/database.types';

const schema = z.object({
  brand_id: z.string().min(1, 'Required'),
  model_id: z.string().min(1, 'Required'),
  plate_number: z.string().length(7, 'LTO plates are 7 characters'),
  mileage: z.coerce.number().int().nonnegative(),
  daily_price: z.coerce.number().positive('Must be greater than 0'),
  pickup_location: z.string().min(1, 'Required'),
  additional_info: z.string().optional(),
  owner_contact_number: z.string().min(7, 'Enter a valid phone number'),
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
  return { brands: brands as CarBrand[], models: models as CarModel[] };
}

export function AddVehiclePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [carImages, setCarImages] = useState<File[]>([]);
  const [orcr, setOrcr] = useState<File | null>(null);
  const [rentalAgreement, setRentalAgreement] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: catalog } = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog });

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormInput>({
    resolver: zodResolver(schema),
    defaultValues: { requires_deposit: false },
  });
  const selectedBrandId = watch('brand_id');
  const requiresDeposit = watch('requires_deposit');
  const modelsForBrand = catalog?.models.filter((m) => m.brand_id === selectedBrandId) ?? [];

  const submit = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!orcr) throw new Error('ORCR document is required');
      if (carImages.length === 0) throw new Error('At least one car photo is required');

      const vehicleId = crypto.randomUUID();

      const { error: insertError } = await supabase.from('vehicles').insert({
        id: vehicleId,
        owner_id: profile!.id,
        model_id: values.model_id,
        plate_number: values.plate_number,
        mileage: values.mileage,
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

      let rentalAgreementPath: string | null = null;
      if (rentalAgreement) {
        rentalAgreementPath = vehicleDocPath(vehicleId, 'rental-agreement', rentalAgreement);
        await uploadFile('vehicle-documents', rentalAgreementPath, rentalAgreement);
      }

      const { error: updateError } = await supabase
        .from('vehicles')
        .update({ orcr_path: orcrPath, rental_agreement_path: rentalAgreementPath })
        .eq('id', vehicleId);
      if (updateError) throw updateError;
    },
    onSuccess: () => navigate('/my-vehicles'),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-3.5" onClick={() => navigate('/my-vehicles')}>
        ← Back to My Vehicles
      </Button>
      <h1 className="mb-5 text-2xl">Add a Vehicle</h1>

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
              <input className="input-base" placeholder="e.g. NDW1284" {...register('plate_number')} />
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

          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Car photos (up to 4)</p>
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png"
                onChange={(e) => setCarImages(Array.from(e.target.files ?? []).slice(0, 4))}
              />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">ORCR (admin only)</p>
              <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setOrcr(e.target.files?.[0] ?? null)} />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Rental agreement (optional)</p>
              <input type="file" accept="application/pdf" onChange={(e) => setRentalAgreement(e.target.files?.[0] ?? null)} />
            </div>
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
