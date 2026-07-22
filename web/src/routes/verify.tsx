import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { uploadFile, verificationImagePath } from '@/lib/storage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';

const schema = z.object({
  first_name: z.string().min(1, 'Required'),
  middle_name: z.string().optional(),
  last_name: z.string().min(1, 'Required'),
  phone: z.string().min(7, 'Enter a valid phone number'),
  address: z.string().min(1, 'Required'),
  birthday: z.string().min(1, 'Required'),
  driver_license_number: z.string().min(1, 'Required'),
  national_id_number: z.string().min(1, 'Required'),
});
type FormValues = z.infer<typeof schema>;

const IMAGE_FIELDS = [
  { key: 'license_front', label: "Driver's License — Front" },
  { key: 'license_back', label: "Driver's License — Back" },
  { key: 'national_id_front', label: 'National ID — Front' },
  { key: 'national_id_back', label: 'National ID — Back' },
  { key: 'selfie_with_id', label: 'Selfie holding ID' },
  { key: 'selfie_face', label: 'Selfie (face only)' },
] as const;

async function fetchLatestSubmission(profileId: string) {
  const { data } = await supabase
    .from('verification_submissions')
    .select('status, rejection_reason, submitted_at')
    .eq('profile_id', profileId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export function VerifyPage() {
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [images, setImages] = useState<Record<string, File | null>>({});
  const [error, setError] = useState<string | null>(null);

  const { data: latest } = useQuery({
    queryKey: ['verification', profile?.id],
    queryFn: () => fetchLatestSubmission(profile!.id),
    enabled: !!profile,
  });

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const submit = useMutation({
    mutationFn: async (values: FormValues) => {
      const missing = IMAGE_FIELDS.filter((f) => !images[f.key]);
      if (missing.length > 0) throw new Error(`Missing: ${missing.map((f) => f.label).join(', ')}`);

      const paths: Record<string, string> = {};
      for (const field of IMAGE_FIELDS) {
        const file = images[field.key]!;
        const path = verificationImagePath(profile!.id, field.key, file);
        await uploadFile('user-verification', path, file);
        paths[field.key] = path;
      }

      const { error: insertError } = await supabase.from('verification_submissions').insert({
        profile_id: profile!.id,
        ...values,
        license_front_path: paths.license_front,
        license_back_path: paths.license_back,
        national_id_front_path: paths.national_id_front,
        national_id_back_path: paths.national_id_back,
        selfie_with_id_path: paths.selfie_with_id,
        selfie_face_path: paths.selfie_face,
      });
      if (insertError) throw insertError;

      await supabase.from('profiles').update({ verified_status: 'pending' }).eq('id', profile!.id);
    },
    onSuccess: async () => {
      await refreshProfile();
      queryClient.invalidateQueries({ queryKey: ['verification'] });
      navigate('/browse');
    },
    onError: (e: Error) => setError(e.message),
  });

  if (profile?.verified_status === 'verified') {
    return (
      <div>
        <h1 className="mb-3 text-2xl">Get Verified</h1>
        <Pill tone="good">Verified</Pill>
        <p className="mt-3 text-muted">You're all set — you can book and list vehicles.</p>
      </div>
    );
  }

  if (latest?.status === 'pending') {
    return (
      <div>
        <h1 className="mb-3 text-2xl">Get Verified</h1>
        <Pill tone="warn">Pending Review</Pill>
        <p className="mt-3 text-muted">
          Submitted {new Date(latest.submitted_at).toLocaleDateString()} — admin usually reviews within a day.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Trust &amp; Safety</div>
        <h1 className="text-2xl">Get Verified</h1>
        <p className="mt-1.5 text-muted">Verification unlocks booking and listing.</p>
      </div>

      {latest?.status === 'rejected' ? (
        <Card className="mb-4 border-bad bg-bad-soft p-4 text-sm text-bad">
          Previously rejected: {latest.rejection_reason}. Resubmit below with corrected info.
        </Card>
      ) : null}

      <Card className="p-5">
        <form onSubmit={handleSubmit((v) => submit.mutate(v))} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="First name" error={errors.first_name}><input className="input-base" {...register('first_name')} /></Field>
            <Field label="Middle name" error={errors.middle_name}><input className="input-base" {...register('middle_name')} /></Field>
            <Field label="Last name" error={errors.last_name}><input className="input-base" {...register('last_name')} /></Field>
            <Field label="Birthday" error={errors.birthday}><input type="date" className="input-base" {...register('birthday')} /></Field>
            <Field label="Phone number" error={errors.phone}><input className="input-base" {...register('phone')} /></Field>
            <Field label="Driver's license number" error={errors.driver_license_number}><input className="input-base" {...register('driver_license_number')} /></Field>
            <Field label="National ID number" error={errors.national_id_number}><input className="input-base" {...register('national_id_number')} /></Field>
            <Field label="Full address" error={errors.address}><input className="input-base" {...register('address')} /></Field>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Required photos (JPG/PNG, max 5MB)</p>
            <div className="grid grid-cols-3 gap-2">
              {IMAGE_FIELDS.map((f) => (
                <label key={f.key} className="cursor-pointer rounded-md border border-dashed border-line bg-surface-2 p-3 text-center text-xs font-semibold text-muted">
                  {images[f.key]?.name ?? f.label}
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => setImages((prev) => ({ ...prev, [f.key]: e.target.files?.[0] ?? null }))}
                  />
                </label>
              ))}
            </div>
          </div>

          {error ? <p className="text-sm text-bad">{error}</p> : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? 'Submitting…' : 'Submit for Verification'}
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
