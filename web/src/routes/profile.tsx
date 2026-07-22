import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TwoFactorSection } from '@/components/two-factor-section';

const schema = z.object({
  first_name: z.string().min(1, 'Required'),
  middle_name: z.string().optional(),
  last_name: z.string().min(1, 'Required'),
  phone: z.string().min(7, 'Enter a valid phone number'),
  address: z.string().min(1, 'Required'),
});
type FormValues = z.infer<typeof schema>;

export function ProfilePage() {
  const { profile, refreshProfile } = useAuth();

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      first_name: profile?.first_name ?? '',
      middle_name: profile?.middle_name ?? '',
      last_name: profile?.last_name ?? '',
      phone: profile?.phone ?? '',
      address: profile?.address ?? '',
    },
  });

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const { error } = await supabase.from('profiles').update(values).eq('id', profile!.id);
      if (error) throw error;
    },
    onSuccess: refreshProfile,
  });

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Account</div>
        <h1 className="text-2xl">My Profile</h1>
        <p className="mt-1.5 text-muted">
          Update your contact details. Government ID/license info can only change via a new verification submission.
        </p>
      </div>

      <Card className="max-w-lg p-5">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="First name" error={errors.first_name}><input className="input-base" {...register('first_name')} /></Field>
            <Field label="Last name" error={errors.last_name}><input className="input-base" {...register('last_name')} /></Field>
          </div>
          <Field label="Middle name" error={errors.middle_name}><input className="input-base" {...register('middle_name')} /></Field>
          <Field label="Phone number" error={errors.phone}><input className="input-base" {...register('phone')} /></Field>
          <Field label="Address" error={errors.address}><input className="input-base" {...register('address')} /></Field>

          {save.isSuccess ? <p className="text-sm text-good">Saved.</p> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save Changes'}</Button>
          </div>
        </form>
      </Card>

      <TwoFactorSection />
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
