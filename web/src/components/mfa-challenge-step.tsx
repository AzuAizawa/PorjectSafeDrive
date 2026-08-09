import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';

// The TOTP code-entry + "lost your authenticator" recovery-code sub-form,
// shared by both /login (for any user who's upgraded to TOTP) and
// /admin-login (staff always have a verified TOTP factor per
// MandatoryMfaGate/034_mandatory_mfa_for_staff.sql) — extracted so the two
// pages don't duplicate this ~100-line block.
//
// onUseEmailCode is deliberately optional and only ever passed by /login.
// Staff must keep a real aal2 session (034_mandatory_mfa_for_staff.sql) and
// email OTP is an app-layer-only check that never mints aal2 — offering it
// on /admin-login would let a staff member route around the actual
// enforcement mechanism, so it's omitted there on purpose.
export function MfaChallengeStep({
  factorId,
  onSuccess,
  onUseEmailCode,
  onBack,
}: {
  factorId: string;
  onSuccess: () => void;
  onUseEmailCode?: () => void;
  onBack: () => void;
}) {
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [usingRecoveryCode, setUsingRecoveryCode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: mfaCode });
    setSubmitting(false);
    if (verifyError) { setError(verifyError.message); return; }
    onSuccess();
  }

  async function handleRecoveryCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRecoverySubmitting(true);
    const { error: fnError } = await supabase.functions.invoke('verify-recovery-code', { body: { code: recoveryCode } });
    setRecoverySubmitting(false);
    if (fnError) { setError('Invalid or already-used recovery code.'); return; }
    // The lost factor was deleted server-side — nothing forces aal2 for a
    // regular (non-staff) user, so just proceed in; they can re-enroll from
    // Profile whenever they're ready.
    onSuccess();
  }

  if (usingRecoveryCode) {
    return (
      <form onSubmit={handleRecoveryCodeSubmit} className="flex flex-col gap-3.5">
        <p className="text-sm text-muted">Enter a backup code. This resets your 2FA — you can set up a new authenticator afterward from your Profile.</p>
        <input
          className="h-[38px] w-full rounded-md border border-line bg-surface px-3 uppercase"
          placeholder="XXXXX-XXXXX"
          autoFocus
          value={recoveryCode}
          onChange={(e) => setRecoveryCode(e.target.value)}
        />
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        <Button type="submit" block disabled={!recoveryCode || recoverySubmitting}>
          {recoverySubmitting ? 'Checking…' : 'Use Backup Code'}
        </Button>
        <button
          type="button"
          className="text-xs font-semibold text-muted hover:text-ink"
          onClick={() => { setUsingRecoveryCode(false); setError(null); }}
        >
          ← Back to authenticator code
        </button>
        <button type="button" className="text-xs font-semibold text-muted hover:text-ink" onClick={onBack}>
          ← Back to Sign In
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleMfaSubmit} className="flex flex-col gap-3.5">
      <p className="text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
      <input
        className="h-[38px] w-full rounded-md border border-line bg-surface px-3"
        maxLength={6}
        autoFocus
        value={mfaCode}
        onChange={(e) => setMfaCode(e.target.value)}
      />
      {error ? <p className="text-sm text-bad">{error}</p> : null}
      <Button type="submit" block disabled={mfaCode.length !== 6 || submitting}>
        {submitting ? 'Verifying…' : 'Verify'}
      </Button>
      <div className="flex flex-col gap-1.5">
        {onUseEmailCode ? (
          <button type="button" className="text-xs font-semibold text-muted hover:text-ink" onClick={onUseEmailCode}>
            Use email code instead
          </button>
        ) : null}
        <button
          type="button"
          className="text-xs font-semibold text-muted hover:text-ink"
          onClick={() => { setUsingRecoveryCode(true); setError(null); }}
        >
          Lost your authenticator? Use a backup code
        </button>
        <button type="button" className="text-xs font-semibold text-muted hover:text-ink" onClick={onBack}>
          ← Back to Sign In
        </button>
      </div>
    </form>
  );
}
