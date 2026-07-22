import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

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

    setSubmitting(true);
    const action =
      mode === 'login'
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });

    const { error: authError } = await action;
    setSubmitting(false);

    if (authError) {
      setError(authError.message);
      return;
    }
    if (mode === 'signup') {
      setSignupSent(true);
      return;
    }
    navigate('/browse');
  }

  const done = signupSent || resetSent;

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-5">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2.5 font-bold">
          <span className="grid h-6.5 w-6.5 place-items-center rounded-md bg-accent text-xs text-white">SD</span>
          SafeDrive
        </div>

        {signupSent ? (
          <p className="text-sm text-muted">Check your email for a confirmation link before signing in.</p>
        ) : resetSent ? (
          <p className="text-sm text-muted">Check your email for a password reset link.</p>
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
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  className="h-[38px] w-full rounded-md border border-line bg-surface px-3"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            ) : null}
            {mode === 'signup' ? (
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Confirm password</label>
                <input
                  type="password"
                  required
                  className="h-[38px] w-full rounded-md border border-line bg-surface px-3"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
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

            {error ? <p className="text-sm text-bad">{error}</p> : null}

            <Button type="submit" block disabled={submitting}>
              {submitting ? 'Please wait…' : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Sign Up' : 'Send Reset Link'}
            </Button>
          </form>
        )}

        {!done ? (
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
