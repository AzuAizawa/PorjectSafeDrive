import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MfaChallengeStep } from '@/components/mfa-challenge-step';
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

// Mandatory authenticator-app enrollment for EVERY account, not just staff
// — flipped from the earlier design (mandatory email code, optional TOTP)
// per direct product feedback: an authenticator app should be the required
// baseline, with email code demoted to a fallback for someone who already
// enrolled but doesn't have their device right now (MfaChallengeStep,
// allowEmailFallback). is_admin()/is_support_or_admin()
// (034_mandatory_mfa_for_staff.sql) already required aal2 for staff before
// this change; wrapping every role in this same gate (AppShell.tsx) means a
// regular user's session also reaches real aal2 once they complete this,
// even though no regular-user RLS policy currently requires it — that's a
// deliberate no-op today, not a bug, and leaves room to extend aal2-gated
// RLS to regular routes later without another migration.
export function MandatoryMfaGate({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const isStaff = profile?.role === 'admin' || profile?.role === 'support' || profile?.role === 'super_admin';
  const queryClient = useQueryClient();
  const [enrolling, setEnrolling] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({ queryKey: ['mfa-status'], queryFn: fetchMfaStatus });

  const enroll = useMutation({
    mutationFn: async () => {
      // enroll() always uses friendlyName "" (we never set one), so a factor
      // left over from an abandoned attempt (closed tab, wrong code, etc.)
      // collides on retry with "A factor with the friendly name '' already
      // exists" and permanently locks the user out of finishing setup.
      // Clear any unverified leftovers first so re-enrollment always works.
      const { data: existing, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      for (const factor of existing.totp.filter((f) => f.status === 'unverified')) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
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

  if (isLoading) return <p className="p-8 text-muted">Loading…</p>;
  if (status?.isAal2) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-2 text-xl font-bold">Two-factor authentication required</h1>
        <p className="mb-4 text-sm text-muted">
          {isStaff
            ? "Admin and support accounts must use two-factor authentication. This can't be skipped or disabled while your account has staff access."
            : 'Every SafeDrive account requires an authenticator app for sign-in. Set it up once below — it only takes a minute.'}
        </p>

        {status?.verifiedFactor && !enrolling ? (
          <MfaChallengeStep
            factorId={status.verifiedFactor.id}
            onSuccess={() => queryClient.invalidateQueries({ queryKey: ['mfa-status'] })}
            onBack={() => supabase.auth.signOut()}
            allowEmailFallback={!isStaff}
          />
        ) : enrolling ? (
          <div className="flex flex-col gap-3">
            {/* Supabase-generated SVG, not user input — safe to inject directly.
                White background + padding + larger size: on a dark card the
                bare SVG left too little quiet zone/contrast for phone cameras
                to autofocus on reliably. shape-rendering:crispEdges: the raw
                SVG is tiny at its intrinsic size, and the browser
                anti-aliases module edges when scaling it up to fill the box
                — soft edges read as low-contrast to a camera decoder,
                especially off-angle, and slow the scan way down. */}
            <div
              className="w-64 rounded-md bg-white p-3 [&>svg]:[shape-rendering:crispEdges]"
              dangerouslySetInnerHTML={{ __html: enrolling.qrCode }}
            />
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
            <button
              type="button"
              className="text-xs font-semibold text-muted hover:text-ink"
              onClick={() => supabase.auth.signOut()}
            >
              ← Back to Sign In
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
