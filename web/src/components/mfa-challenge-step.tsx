import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';

type View = 'totp' | 'recovery' | 'email';

// The TOTP code-entry step, shared by /login (once a user has enrolled an
// authenticator — now mandatory for everyone, see MandatoryMfaGate),
// /admin-login, and MandatoryMfaGate itself. Fully self-contained: the
// "lost your authenticator" backup-code path and the "use email code
// instead" fallback both live here, rather than handing state back up to
// whichever page embeds this component.
//
// allowEmailFallback is deliberately opt-in per caller, not a global
// default. Staff must keep a real aal2 session
// (034_mandatory_mfa_for_staff.sql) and email OTP is an app-layer-only
// check that never mints aal2 — offering it on /admin-login or inside
// MandatoryMfaGate for a staff account would let them route around the
// actual enforcement mechanism, so admin-login.tsx omits this prop.
// Regular users have no aal2-gated RLS today, so a temporary email-code
// fallback (for someone who already enrolled TOTP but doesn't have their
// device right now) doesn't weaken anything that exists.
export function MfaChallengeStep({
  factorId,
  onSuccess,
  onBack,
  allowEmailFallback,
}: {
  factorId: string;
  onSuccess: () => void;
  onBack: () => void;
  allowEmailFallback?: boolean;
}) {
  const [view, setView] = useState<View>('totp');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpBusy, setOtpBusy] = useState(false);

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

  async function requestEmailCode() {
    setError(null);
    setOtpBusy(true);
    const { data, error: otpError } = await supabase.rpc('request_email_otp');
    setOtpBusy(false);
    if (otpError) { setError(otpError.message); return; }
    const status = data?.[0];
    setOtpCooldown(status && !status.sent ? status.retry_after_seconds : 45);
    setOtpRequested(true);
  }

  async function handleEmailCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOtpBusy(true);
    const { data: verified, error: verifyError } = await supabase.rpc('verify_email_otp', { p_code: otpCode });
    setOtpBusy(false);
    if (verifyError) { setError(verifyError.message); return; }
    if (!verified) { setError('Incorrect code. Please try again.'); return; }
    onSuccess();
  }

  if (view === 'email') {
    return (
      <form onSubmit={handleEmailCodeSubmit} className="flex flex-col gap-3.5">
        {otpRequested ? (
          <>
            <p className="text-sm text-muted">We emailed a 6-digit code. Enter it below to continue.</p>
            <input
              className="h-[38px] w-full rounded-md border border-line bg-surface px-3"
              maxLength={6}
              autoFocus
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
            />
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <Button type="submit" block disabled={otpCode.length !== 6 || otpBusy}>
              {otpBusy ? 'Verifying…' : 'Verify'}
            </Button>
            <button
              type="button"
              className="text-xs font-semibold text-muted hover:text-ink disabled:opacity-50"
              disabled={otpCooldown > 0 || otpBusy}
              onClick={requestEmailCode}
            >
              {otpCooldown > 0 ? `Resend code (${otpCooldown}s)` : 'Resend code'}
            </button>
          </>
        ) : (
          <p className="text-sm text-muted">Sending a code to your email…</p>
        )}
        <button
          type="button"
          className="text-xs font-semibold text-muted hover:text-ink"
          onClick={() => { setView('totp'); setError(null); }}
        >
          ← Back to authenticator code
        </button>
      </form>
    );
  }

  if (view === 'recovery') {
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
          onClick={() => { setView('totp'); setError(null); }}
        >
          ← Back to authenticator code
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
        {allowEmailFallback ? (
          <button
            type="button"
            className="text-xs font-semibold text-muted hover:text-ink"
            onClick={() => { setView('email'); setError(null); void requestEmailCode(); }}
          >
            Use email code instead
          </button>
        ) : null}
        <button
          type="button"
          className="text-xs font-semibold text-muted hover:text-ink"
          onClick={() => { setView('recovery'); setError(null); }}
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
