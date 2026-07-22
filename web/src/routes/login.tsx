import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PasswordInput, passwordMeetsRules } from '@/components/password-input';

type Mode = 'login' | 'signup' | 'forgot';

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
  const [mfaCode, setMfaCode] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfaFactorId!, code: mfaCode });
    setSubmitting(false);
    if (verifyError) { setError(verifyError.message); return; }
    navigate('/browse');
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

    setSubmitting(true);
    const action =
      mode === 'login'
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });

    const { error: authError } = await action;

    if (authError) {
      setSubmitting(false);
      setError(authError.message);
      return;
    }
    if (mode === 'signup') {
      setSubmitting(false);
      setSignupSent(true);
      return;
    }

    // Password check passed — see if this account has 2FA enrolled and
    // still needs to step up to aal2 before the session is fully trusted.
    const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setSubmitting(false);
    if (level && level.nextLevel === 'aal2' && level.currentLevel !== level.nextLevel) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp[0];
      if (totp) {
        setMfaFactorId(totp.id);
        return;
      }
    }
    navigate('/browse');
  }

  const done = signupSent || resetSent;

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <Card className="w-full max-w-sm p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-2.5 font-bold">
          <span className="btn-gradient-accent grid h-6.5 w-6.5 place-items-center rounded-lg text-xs text-white shadow-[0_4px_12px_-4px_rgba(var(--shadow-tint),0.6)]">SD</span>
          SafeDrive
        </div>

        {mfaFactorId ? (
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

        {!done && !mfaFactorId ? (
          <button
            className="mt-4 w-full text-center text-xs font-semibold text-muted hover:text-ink"
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
          >
            {mode === 'signup' || mode === 'forgot' ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
        ) : null}
      </Card>
    </div>
  );
}
