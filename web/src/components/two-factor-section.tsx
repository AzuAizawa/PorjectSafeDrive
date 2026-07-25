import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

async function fetchFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data.totp.filter((f) => f.status === 'verified');
}

// Supabase Auth's native TOTP MFA — opt-in for any user (not just admin),
// enroll returns a ready-made QR code SVG so no client-side QR library
// is needed.
export function TwoFactorSection() {
  const { profile } = useAuth();
  const isStaff = profile?.role === 'admin' || profile?.role === 'support' || profile?.role === 'super_admin';
  const queryClient = useQueryClient();
  const { data: verifiedFactors } = useQuery({ queryKey: ['mfa-factors'], queryFn: fetchFactors });
  const [enrolling, setEnrolling] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    onError: (e: Error) => setError(e.message),
  });

  const verify = useMutation({
    mutationFn: async () => {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enrolling!.factorId,
        code,
      });
      if (verifyError) throw verifyError;
    },
    onSuccess: () => {
      setEnrolling(null);
      setCode('');
      queryClient.invalidateQueries({ queryKey: ['mfa-factors'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const unenroll = useMutation({
    mutationFn: async (factorId: string) => {
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId });
      if (unenrollError) throw unenrollError;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mfa-factors'] }),
    onError: (e: Error) => setError(e.message),
  });

  const hasVerifiedFactor = (verifiedFactors?.length ?? 0) > 0;

  return (
    <Card className="mt-5 max-w-lg p-5">
      <h3 className="mb-1 text-sm font-bold">Two-Factor Authentication</h3>
      <p className="mb-3 text-xs text-muted">
        Adds a 6-digit code from an authenticator app (Google Authenticator, Authy, etc.) on top of your password.
        {isStaff ? ' Required for admin/support accounts and cannot be disabled while you have staff access.' : ''}
      </p>

      {hasVerifiedFactor ? (
        <div className="flex items-center justify-between rounded-md bg-good-soft p-3 text-sm text-good">
          <span>✓ Two-factor authentication is enabled.</span>
          {isStaff ? null : (
            <Button
              size="sm"
              variant="danger"
              disabled={unenroll.isPending}
              onClick={() => unenroll.mutate(verifiedFactors![0].id)}
            >
              Disable
            </Button>
          )}
        </div>
      ) : enrolling ? (
        <div>
          {/* Supabase-generated SVG, not user input — safe to inject directly */}
          <div className="mb-3 w-40" dangerouslySetInnerHTML={{ __html: enrolling.qrCode }} />
          <p className="mb-3 text-xs text-muted">
            Scan this with your authenticator app, or enter the code manually:{' '}
            <code className="tabular rounded bg-surface-2 px-1.5 py-0.5">{enrolling.secret}</code>
          </p>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">
            Enter the 6-digit code to confirm
          </label>
          <div className="flex gap-2">
            <input className="input-base" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
            <Button disabled={code.length !== 6 || verify.isPending} onClick={() => verify.mutate()}>
              {verify.isPending ? 'Verifying…' : 'Confirm'}
            </Button>
          </div>
          {error ? <p className="mt-2 text-xs text-bad">{error}</p> : null}
        </div>
      ) : (
        <Button variant="secondary" disabled={enroll.isPending} onClick={() => enroll.mutate()}>
          {enroll.isPending ? 'Setting up…' : 'Enable Two-Factor Authentication'}
        </Button>
      )}
      {error && !enrolling ? <p className="mt-2 text-xs text-bad">{error}</p> : null}
    </Card>
  );
}
