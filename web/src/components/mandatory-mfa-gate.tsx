import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { friendlyErrorMessage } from '@/lib/friendly-error';

async function fetchMfaStatus() {
  const [{ data: level, error: levelError }, { data: factors, error: factorsError }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  if (levelError) throw levelError;
  if (factorsError) throw factorsError;
  return {
    isAal2: level.currentLevel === 'aal2',
    verifiedFactor: factors.totp.find((f) => f.status === 'verified') ?? null,
  };
}

// is_admin()/is_support_or_admin() (034_mandatory_mfa_for_staff.sql) now
// require the current session to be aal2, not just the right role — a
// staff account with no TOTP factor can never reach aal2, so gating the
// whole admin/support shell on this forces enrollment as a side effect,
// with no separate "has factors" check needed. Without this, staff would
// just see "not authorized" errors on every admin action instead of a
// clear reason why.
export function MandatoryMfaGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [enrolling, setEnrolling] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [usingRecoveryCode, setUsingRecoveryCode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');

  const { data: status, isLoading } = useQuery({ queryKey: ['mfa-status'], queryFn: fetchMfaStatus });

  const enroll = useMutation({
    mutationFn: async () => {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (enrollError) throw enrollError;
      return data;
    },
    onSuccess: (data) => {
      setEnrolling({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      setError(null);
    },
    onError: (e) => setError(friendlyErrorMessage(e)),
  });

  const verifyEnrollment = useMutation({
    mutationFn: async () => {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling!.factorId, code });
      if (verifyError) throw verifyError;
    },
    onSuccess: () => {
      setEnrolling(null);
      setCode('');
      queryClient.invalidateQueries({ queryKey: ['mfa-status'] });
    },
    onError: (e) => setError(friendlyErrorMessage(e)),
  });

  const challenge = useMutation({
    mutationFn: async () => {
      const { error: challengeError } = await supabase.auth.mfa.challengeAndVerify({
        factorId: status!.verifiedFactor!.id,
        code,
      });
      if (challengeError) throw challengeError;
    },
    onSuccess: () => {
      setCode('');
      queryClient.invalidateQueries({ queryKey: ['mfa-status'] });
    },
    onError: (e) => setError(friendlyErrorMessage(e)),
  });

  const useRecoveryCode = useMutation({
    mutationFn: async () => {
      const { error: fnError } = await supabase.functions.invoke('verify-recovery-code', { body: { code: recoveryCode } });
      if (fnError) throw fnError;
    },
    onSuccess: () => {
      // Factor was deleted server-side — refetch flips us to the
      // enrollment screen, same as a brand-new staff account sees.
      setRecoveryCode('');
      setUsingRecoveryCode(false);
      queryClient.invalidateQueries({ queryKey: ['mfa-status'] });
    },
    onError: (e) => setError(friendlyErrorMessage(e)),
  });

  if (isLoading) return <p className="p-8 text-muted">Loading…</p>;
  if (status?.isAal2) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-2 text-xl font-bold">Two-factor authentication required</h1>
        <p className="mb-4 text-sm text-muted">
          Admin and support accounts must use two-factor authentication. This can't be skipped or disabled while
          your account has staff access.
        </p>

        {status?.verifiedFactor && !enrolling && usingRecoveryCode ? (
          <div className="flex flex-col gap-3">
            <label className="text-xs font-bold uppercase tracking-wide text-muted">Enter a backup code</label>
            <input
              className="input-base uppercase"
              placeholder="XXXXX-XXXXX"
              autoFocus
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
            />
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <Button disabled={!recoveryCode || useRecoveryCode.isPending} onClick={() => useRecoveryCode.mutate()}>
              {useRecoveryCode.isPending ? 'Checking…' : 'Use Backup Code'}
            </Button>
            <p className="text-xs text-muted">
              This resets your 2FA — you'll set up a new authenticator right after.
            </p>
            <button
              type="button"
              className="text-xs font-semibold text-muted hover:text-ink"
              onClick={() => { setUsingRecoveryCode(false); setError(null); }}
            >
              ← Back to authenticator code
            </button>
          </div>
        ) : status?.verifiedFactor && !enrolling ? (
          <div className="flex flex-col gap-3">
            <label className="text-xs font-bold uppercase tracking-wide text-muted">
              Enter the 6-digit code from your authenticator app
            </label>
            <input
              className="input-base"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <Button disabled={code.length !== 6 || challenge.isPending} onClick={() => challenge.mutate()}>
              {challenge.isPending ? 'Verifying…' : 'Verify'}
            </Button>
            <button
              type="button"
              className="text-xs font-semibold text-muted hover:text-ink"
              onClick={() => { setUsingRecoveryCode(true); setError(null); }}
            >
              Lost your authenticator? Use a backup code
            </button>
          </div>
        ) : enrolling ? (
          <div className="flex flex-col gap-3">
            {/* Supabase-generated SVG, not user input — safe to inject directly */}
            <div className="w-40" dangerouslySetInnerHTML={{ __html: enrolling.qrCode }} />
            <p className="text-xs text-muted">
              Scan this with your authenticator app, or enter the code manually:{' '}
              <code className="tabular rounded bg-surface-2 px-1.5 py-0.5">{enrolling.secret}</code>
            </p>
            <label className="text-xs font-bold uppercase tracking-wide text-muted">Enter the 6-digit code to confirm</label>
            <input
              className="input-base"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <Button disabled={code.length !== 6 || verifyEnrollment.isPending} onClick={() => verifyEnrollment.mutate()}>
              {verifyEnrollment.isPending ? 'Confirming…' : 'Confirm'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <Button disabled={enroll.isPending} onClick={() => enroll.mutate()}>
              {enroll.isPending ? 'Setting up…' : 'Set Up Two-Factor Authentication'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
