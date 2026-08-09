import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, ShieldCheck, IdCard, CreditCard } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PasswordInput, passwordMeetsRules } from '@/components/password-input';
import { MfaChallengeStep } from '@/components/mfa-challenge-step';

type Mode = 'login' | 'signup' | 'forgot';

const DEFAULT_OTP_COOLDOWN_SECONDS = 45;

function formatRetryAfter(seconds: number) {
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signupSent, setSignupSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // Mandatory email-code 2FA (065_email_otp.sql) — the baseline every
  // account has from the moment it's created, since there's no native
  // Supabase "email" MFA factor type to lean on (see the migration's
  // comment). Only reached when the account has no verified TOTP factor;
  // an upgraded account skips straight to MfaChallengeStep instead.
  const [emailOtpPending, setEmailOtpPending] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpResending, setOtpResending] = useState(false);
  const [otpCooldownSetting, setOtpCooldownSetting] = useState(DEFAULT_OTP_COOLDOWN_SECONDS);

  useEffect(() => {
    if (!emailOtpPending) return;
    supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'email_otp_resend_cooldown_seconds')
      .single()
      .then(({ data }) => {
        const seconds = Number(data?.value);
        if (Number.isFinite(seconds) && seconds > 0) setOtpCooldownSetting(seconds);
      });
  }, [emailOtpPending]);

  // Ticking countdown for the Resend button — reschedules itself each
  // second rather than a single setInterval, so it can't drift out of sync
  // with otpCooldown being set directly (e.g. from the server's own
  // retry_after_seconds when a resend is blocked).
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timer = setTimeout(() => setOtpCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [otpCooldown]);

  // Shared tail for every successful login path (password-only, TOTP
  // step-up, recovery code, or email code) — logs the Security Log entry
  // and lands on "/" so LandingRedirect (App.tsx) can route by role.
  function finishLogin() {
    void supabase.rpc('record_login_event').then(({ error }) => {
      if (error) console.warn('record_login_event failed:', error);
    });
    navigate('/');
  }

  async function handleOtpVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOtpSubmitting(true);
    const { data: verified, error: verifyError } = await supabase.rpc('verify_email_otp', { p_code: otpCode });
    setOtpSubmitting(false);
    if (verifyError) { setError(verifyError.message); return; }
    if (!verified) { setError('Incorrect code. Please try again.'); return; }
    finishLogin();
  }

  // Lets a user who's upgraded to TOTP still fall back to the mandatory
  // email-code baseline for a given login, without touching their
  // authenticator enrollment — deliberately a plain function, not a
  // useMutation, since success just swaps which screen renders next rather
  // than needing its own pending UI (the email-code screen's own
  // submitting/cooldown state takes over immediately after).
  async function handleUseEmailCodeInstead() {
    setError(null);
    const { data: otpStatus, error: otpError } = await supabase.rpc('request_email_otp');
    if (otpError) { setError(otpError.message); return; }
    const status = otpStatus?.[0];
    setOtpCooldown(status && !status.sent ? status.retry_after_seconds : otpCooldownSetting);
    setMfaFactorId(null);
    setEmailOtpPending(true);
  }

  async function handleResendOtp() {
    setError(null);
    setOtpResending(true);
    const { data, error: otpError } = await supabase.rpc('request_email_otp');
    setOtpResending(false);
    if (otpError) { setError(otpError.message); return; }
    const status = data?.[0];
    setOtpCooldown(status && !status.sent ? status.retry_after_seconds : otpCooldownSetting);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === 'forgot') {
      setSubmitting(true);
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setSubmitting(false);
      if (resetError) { setError(resetError.message); return; }
      setResetSent(true);
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (mode === 'signup' && !passwordMeetsRules(password)) {
      setError('Password does not meet all the requirements below.');
      return;
    }
    if (mode === 'signup' && !agreedToTerms) {
      setError('Please agree to the Terms of Service and Data Privacy Notice to continue.');
      return;
    }

    if (mode === 'login') {
      const { data: throttle } = await supabase.rpc('check_login_throttle', { p_email: email });
      const status = throttle?.[0];
      if (status?.blocked) {
        setError(`Too many failed attempts. Try again in ${formatRetryAfter(status.retry_after_seconds)}.`);
        return;
      }
    }

    setSubmitting(true);
    const action =
      mode === 'login'
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });

    const { error: authError } = await action;

    if (authError) {
      setSubmitting(false);
      if (mode === 'login') void supabase.rpc('record_login_failure', { p_email: email });
      setError(authError.message);
      return;
    }
    if (mode === 'signup') {
      setSubmitting(false);
      setSignupSent(true);
      return;
    }

    // Password check passed — see if this account has upgraded to TOTP and
    // still needs to step up to aal2 before the session is fully trusted.
    const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (level && level.nextLevel === 'aal2' && level.currentLevel !== level.nextLevel) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp[0];
      if (totp) {
        setSubmitting(false);
        setMfaFactorId(totp.id);
        return;
      }
    }

    // Staff with no TOTP factor yet (freshly invited, or just reset via the
    // Admin Users "Reset 2FA" tool) skip the email-code detour entirely —
    // MandatoryMfaGate (inside AppShell) already owns the full staff
    // enroll/challenge flow, and staff never use email-OTP as their factor.
    const { data: authUser } = await supabase.auth.getUser();
    if (authUser.user) {
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', authUser.user.id).single();
      if (prof && ['admin', 'support', 'super_admin'].includes(prof.role)) {
        finishLogin();
        return;
      }
    }

    // No TOTP factor — every other account has mandatory email-code 2FA as
    // its baseline (065_email_otp.sql), whether this is a brand-new
    // signup's very first login or a returning user who never upgraded.
    const { data: otpStatus, error: otpError } = await supabase.rpc('request_email_otp');
    setSubmitting(false);
    if (otpError) { setError(otpError.message); return; }
    const status = otpStatus?.[0];
    setOtpCooldown(status && !status.sent ? status.retry_after_seconds : otpCooldownSetting);
    setEmailOtpPending(true);
  }

  const done = signupSent || resetSent;

  return (
    <div className="grid min-h-screen grid-cols-[1fr_1fr] max-[900px]:grid-cols-1">
      <div className="btn-gradient-accent relative hidden flex-col justify-between overflow-hidden p-11 text-white min-[900px]:flex">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-28 -left-16 h-80 w-80 rounded-full bg-black/10 blur-3xl"
          aria-hidden
        />

        <div className="relative flex items-center gap-2.5 text-lg font-bold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/15 text-sm">SD</span>
          SafeDrive
        </div>

        <div className="relative">
          <Car className="mb-5 h-11 w-11 opacity-90" strokeWidth={1.5} aria-hidden />
          <h2 className="mb-3 text-[32px] font-bold leading-tight">
            Rent smarter,<br />drive further.
          </h2>
          <p className="max-w-[38ch] text-[15px] text-white/80">
            Peer-to-peer car rental built on verified identities and secure payments.
          </p>
        </div>

        <div className="relative flex flex-col gap-3 text-sm text-white/90">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden /> Verified owners &amp; renters
          </div>
          <div className="flex items-center gap-2.5">
            <IdCard className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden /> Government ID verification
          </div>
          <div className="flex items-center gap-2.5">
            <CreditCard className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden /> Secure PayMongo payments
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center px-5 py-10">
      <Card className="w-full max-w-sm p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-2.5 font-bold min-[900px]:hidden">
          <span className="btn-gradient-accent grid h-6.5 w-6.5 place-items-center rounded-lg text-xs text-white shadow-[0_4px_12px_-4px_rgba(var(--shadow-tint),0.6)]">SD</span>
          SafeDrive
        </div>

        {mfaFactorId ? (
          <MfaChallengeStep factorId={mfaFactorId} onSuccess={finishLogin} onUseEmailCode={handleUseEmailCodeInstead} />
        ) : emailOtpPending ? (
          <form onSubmit={handleOtpVerify} className="flex flex-col gap-3.5">
            <p className="text-sm text-muted">We emailed a 6-digit code to {email}. Enter it below to finish signing in.</p>
            <input
              className="h-[38px] w-full rounded-md border border-line bg-surface px-3"
              maxLength={6}
              autoFocus
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
            />
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <Button type="submit" block disabled={otpCode.length !== 6 || otpSubmitting}>
              {otpSubmitting ? 'Verifying…' : 'Verify'}
            </Button>
            <button
              type="button"
              className="text-xs font-semibold text-muted hover:text-ink disabled:opacity-50"
              disabled={otpCooldown > 0 || otpResending}
              onClick={handleResendOtp}
            >
              {otpResending ? 'Sending…' : otpCooldown > 0 ? `Resend code (${otpCooldown}s)` : 'Resend code'}
            </button>
          </form>
        ) : signupSent ? (
          <div>
            <p className="text-sm text-muted">Check your email for a confirmation link before signing in.</p>
            <button
              className="mt-4 text-xs font-semibold text-muted hover:text-ink"
              onClick={() => { setSignupSent(false); setMode('login'); }}
            >
              ← Back to Sign In
            </button>
          </div>
        ) : resetSent ? (
          <div>
            <p className="text-sm text-muted">Check your email for a password reset link.</p>
            <button
              className="mt-4 text-xs font-semibold text-muted hover:text-ink"
              onClick={() => { setResetSent(false); setMode('login'); }}
            >
              ← Back to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Email</label>
              <input
                type="email"
                required
                className="h-[38px] w-full rounded-md border border-line bg-surface px-3"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {mode !== 'forgot' ? (
              <PasswordInput value={password} onChange={setPassword} showChecklist={mode === 'signup'} />
            ) : null}
            {mode === 'signup' ? (
              <PasswordInput value={confirmPassword} onChange={setConfirmPassword} label="Confirm password" />
            ) : null}

            {mode === 'login' ? (
              <button
                type="button"
                className="-mt-1 self-end text-xs font-semibold text-muted hover:text-ink"
                onClick={() => setMode('forgot')}
              >
                Forgot password?
              </button>
            ) : null}

            {mode === 'signup' ? (
              <label className="flex items-start gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                />
                <span>
                  I agree to the Terms of Service and{' '}
                  <a href="/privacy" target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">
                    Data Privacy Notice
                  </a>
                  , and consent to SafeDrive processing my identity documents for verification.
                </span>
              </label>
            ) : null}

            {error ? <p className="text-sm text-bad">{error}</p> : null}

            <Button type="submit" block disabled={submitting || (mode === 'signup' && !agreedToTerms)}>
              {submitting ? 'Please wait…' : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Sign Up' : 'Send Reset Link'}
            </Button>
          </form>
        )}

        {!done && !mfaFactorId && !emailOtpPending ? (
          <button
            className="mt-4 w-full text-center text-xs font-semibold text-muted hover:text-ink"
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
          >
            {mode === 'signup' || mode === 'forgot' ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
        ) : null}
      </Card>
      </div>
    </div>
  );
}
