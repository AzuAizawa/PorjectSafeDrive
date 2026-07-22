import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TwoFactorSection } from '@/components/two-factor-section';
import { friendlyErrorMessage } from '@/lib/friendly-error';

const schema = z.object({
  phone: z.string().min(7, 'Enter a valid phone number').max(15),
  address: z.string().min(1, 'Required').max(300),
});
type FormValues = z.infer<typeof schema>;

const payoutSchema = z
  .object({
    payout_method: z.enum(['bank_transfer', 'gcash']),
    bank_account_name: z.string().max(150).optional(),
    bank_name: z.string().max(150).optional(),
    bank_account_number: z.string().max(34).optional(),
    gcash_number: z.string().max(15).optional(),
  })
  .refine((v) => v.payout_method !== 'bank_transfer' || (v.bank_account_name && v.bank_name && v.bank_account_number), {
    message: 'Bank account name, bank name, and account number are all required',
    path: ['bank_account_number'],
  })
  .refine((v) => v.payout_method !== 'gcash' || !!v.gcash_number, {
    message: 'GCash number is required',
    path: ['gcash_number'],
  });
type PayoutValues = z.infer<typeof payoutSchema>;

export function ProfilePage() {
  const { profile, refreshProfile } = useAuth();

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
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

  const {
    register: registerPayout,
    handleSubmit: handlePayoutSubmit,
    watch: watchPayout,
    formState: { errors: payoutErrors },
  } = useForm<PayoutValues>({
    resolver: zodResolver(payoutSchema),
    defaultValues: {
      payout_method: profile?.payout_method ?? 'bank_transfer',
      bank_account_name: profile?.bank_account_name ?? '',
      bank_name: profile?.bank_name ?? '',
      bank_account_number: profile?.bank_account_number ?? '',
      gcash_number: profile?.gcash_number ?? '',
    },
  });
  const payoutMethod = watchPayout('payout_method');

  const savePayout = useMutation({
    mutationFn: async (values: PayoutValues) => {
      const { error } = await supabase
        .from('profiles')
        .update({
          payout_method: values.payout_method,
          bank_account_name: values.payout_method === 'bank_transfer' ? values.bank_account_name : null,
          bank_name: values.payout_method === 'bank_transfer' ? values.bank_name : null,
          bank_account_number: values.payout_method === 'bank_transfer' ? values.bank_account_number : null,
          gcash_number: values.payout_method === 'gcash' ? values.gcash_number : null,
        })
        .eq('id', profile!.id);
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
          Your name and other verified identity details come from your Get Verified submission and can only change
          through a new verification review. You can update your phone number and address here at any time.
        </p>
      </div>

      <Card className="max-w-lg p-5">
        <h3 className="mb-3 text-sm font-bold">Verified identity</h3>
        <dl className="mb-5 grid grid-cols-2 gap-3 text-[13px]">
          <div><dt className="text-xs text-muted">First name</dt><dd className="font-semibold">{profile?.first_name || '—'}</dd></div>
          <div><dt className="text-xs text-muted">Last name</dt><dd className="font-semibold">{profile?.last_name || '—'}</dd></div>
          {profile?.middle_name ? (
            <div><dt className="text-xs text-muted">Middle name</dt><dd className="font-semibold">{profile.middle_name}</dd></div>
          ) : null}
        </dl>
        {profile?.verified_status !== 'verified' ? (
          <p className="mb-5 rounded-md border border-warn bg-warn-soft p-3 text-xs text-warn">
            You're not verified yet — get verified to unlock booking and listing.
          </p>
        ) : null}

        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="flex flex-col gap-4">
          <Field label="Phone number" error={errors.phone}>
            <input className="input-base" maxLength={15} {...register('phone')} />
          </Field>
          <Field label="Address" error={errors.address}>
            <input className="input-base" maxLength={300} {...register('address')} />
          </Field>

          {save.isSuccess ? <p className="text-sm text-good">Saved.</p> : null}
          {save.isError ? <p className="text-sm text-bad">{friendlyErrorMessage(save.error)}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save Changes'}</Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5 max-w-lg p-5">
        <h3 className="mb-1 text-sm font-bold">Payout account</h3>
        <p className="mb-4 text-xs text-muted">
          Where SafeDrive sends your earnings after a completed rental. Visible to admin when processing payouts.
        </p>
        <form onSubmit={handlePayoutSubmit((v) => savePayout.mutate(v))} className="flex flex-col gap-4">
          <Field label="Payout method">
            <select className="input-base" {...registerPayout('payout_method')}>
              <option value="bank_transfer">Bank transfer</option>
              <option value="gcash">GCash</option>
            </select>
          </Field>

          {payoutMethod === 'bank_transfer' ? (
            <>
              <Field label="Account holder name" error={payoutErrors.bank_account_name}>
                <input className="input-base" maxLength={150} {...registerPayout('bank_account_name')} />
              </Field>
              <Field label="Bank name" error={payoutErrors.bank_name}>
                <input className="input-base" maxLength={150} {...registerPayout('bank_name')} />
              </Field>
              <Field label="Account number" error={payoutErrors.bank_account_number}>
                <input className="input-base" maxLength={34} {...registerPayout('bank_account_number')} />
              </Field>
            </>
          ) : (
            <Field label="GCash number" error={payoutErrors.gcash_number}>
              <input className="input-base" maxLength={15} placeholder="+63 9XX XXX XXXX" {...registerPayout('gcash_number')} />
            </Field>
          )}

          {savePayout.isSuccess ? <p className="text-sm text-good">Saved.</p> : null}
          {savePayout.isError ? <p className="text-sm text-bad">{friendlyErrorMessage(savePayout.error)}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={savePayout.isPending}>{savePayout.isPending ? 'Saving…' : 'Save Payout Info'}</Button>
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
