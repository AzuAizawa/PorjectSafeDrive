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
import { CameraCapture } from '@/components/camera-capture';
import { friendlyErrorMessage } from '@/lib/friendly-error';

const SECONDARY_ID_TYPES = [
  { value: 'national_id', label: 'National ID (PhilSys)' },
  { value: 'passport', label: 'Passport' },
  { value: 'sss_id', label: 'SSS ID' },
  { value: 'philhealth_id', label: 'PhilHealth ID' },
  { value: 'postal_id', label: 'Postal ID' },
  { value: 'voters_id', label: "Voter's ID" },
  { value: 'prc_id', label: 'PRC ID' },
  { value: 'other', label: 'Other government ID' },
];

const schema = z.object({
  first_name: z.string().min(1, 'Required').max(60),
  middle_name: z.string().max(60).optional(),
  last_name: z.string().min(1, 'Required').max(60),
  phone: z.string().min(7, 'Enter a valid phone number').max(15),
  address: z.string().min(1, 'Required').max(200),
  birthday: z.string().min(1, 'Required'),
  driver_license_number: z.string().min(1, 'Required').max(20),
  secondary_id_type: z.string().min(1, 'Required'),
});
type FormValues = z.infer<typeof schema>;

const DOCUMENT_FIELDS = [
  { key: 'license_front', label: "Driver's License — Front" },
  { key: 'license_back', label: "Driver's License — Back" },
  { key: 'secondary_id_front', label: 'Secondary ID — Front' },
  { key: 'secondary_id_back', label: 'Secondary ID — Back' },
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
  const [documents, setDocuments] = useState<Record<string, File | null>>({});
  const [selfieWithId, setSelfieWithId] = useState<File | null>(null);
  const [selfieFace, setSelfieFace] = useState<File | null>(null);
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
      const missingDocs = DOCUMENT_FIELDS.filter((f) => !documents[f.key]);
      if (missingDocs.length > 0) throw new Error(`Missing: ${missingDocs.map((f) => f.label).join(', ')}`);
      if (!selfieWithId) throw new Error('Missing: Selfie holding ID');
      if (!selfieFace) throw new Error('Missing: Selfie (face only)');

      const paths: Record<string, string> = {};
      for (const field of DOCUMENT_FIELDS) {
        const file = documents[field.key]!;
        const path = verificationImagePath(profile!.id, field.key, file);
        await uploadFile('user-verification', path, file);
        paths[field.key] = path;
      }
      paths.selfie_with_id = verificationImagePath(profile!.id, 'selfie_with_id', selfieWithId);
      await uploadFile('user-verification', paths.selfie_with_id, selfieWithId);
      paths.selfie_face = verificationImagePath(profile!.id, 'selfie_face', selfieFace);
      await uploadFile('user-verification', paths.selfie_face, selfieFace);

      const { error: insertError } = await supabase.from('verification_submissions').insert({
        profile_id: profile!.id,
        ...values,
        license_front_path: paths.license_front,
        license_back_path: paths.license_back,
        secondary_id_front_path: paths.secondary_id_front,
        secondary_id_back_path: paths.secondary_id_back,
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
    onError: (e: Error) => setError(friendlyErrorMessage(e)),
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
            <Field label="First name" error={errors.first_name}><input className="input-base" maxLength={60} {...register('first_name')} /></Field>
            <Field label="Middle name" error={errors.middle_name}><input className="input-base" maxLength={60} {...register('middle_name')} /></Field>
            <Field label="Last name" error={errors.last_name}><input className="input-base" maxLength={60} {...register('last_name')} /></Field>
            <Field label="Birthday" error={errors.birthday}>
              <input type="date" className="input-base" max={new Date().toISOString().slice(0, 10)} {...register('birthday')} />
            </Field>
            <Field label="Phone number" error={errors.phone}><input className="input-base" maxLength={15} {...register('phone')} /></Field>
            <Field label="Driver's license number" error={errors.driver_license_number}>
              <input className="input-base" maxLength={20} {...register('driver_license_number')} />
            </Field>
            <Field label="Secondary ID type" error={errors.secondary_id_type}>
              <select className="input-base" {...register('secondary_id_type')}>
                <option value="">Select ID type</option>
                {SECONDARY_ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Full address" error={errors.address}><input className="input-base" maxLength={200} {...register('address')} /></Field>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Required documents (JPG/PNG, max 5MB)</p>
            <div className="grid grid-cols-2 gap-2">
              {DOCUMENT_FIELDS.map((f) => (
                <label
                  key={f.key}
                  className="cursor-pointer rounded-xl border-2 border-dashed border-line bg-surface-2/70 p-4 text-center text-xs font-semibold text-muted backdrop-blur-sm hover:border-accent hover:text-accent hover:bg-accent-soft/40 hover:-translate-y-px hover:shadow-[0_8px_20px_-12px_rgba(var(--shadow-tint),0.4)]"
                >
                  📄 {documents[f.key]?.name ?? f.label}
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => setDocuments((prev) => ({ ...prev, [f.key]: e.target.files?.[0] ?? null }))}
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
              Live selfies (taken with your camera — not uploaded from a file)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <CameraCapture label="Selfie holding ID" captured={selfieWithId} onCapture={setSelfieWithId} />
              <CameraCapture label="Selfie (face only)" captured={selfieFace} onCapture={setSelfieFace} />
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
