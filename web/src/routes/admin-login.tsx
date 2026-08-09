import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PasswordInput } from '@/components/password-input';
import { friendlyErrorMessage } from '@/lib/friendly-error';

// Staff-only entry point, separate from the consumer /login page per panel
// feedback ("admin and user login should be different, so it's separated").
// Worth being precise about what this actually buys: the real security
// boundary is still is_admin()/is_support_or_admin() requiring aal2
// (034_mandatory_mfa_for_staff.sql) plus RLS — a different URL alone
// doesn't make an account harder to compromise. What it does give: staff
// get a dedicated, undecorated bookmark instead of the consumer signup/
// forgot-password flow, and the admin surface isn't advertised inside the
// public-facing login form. Not linked from any public nav on purpose.
//
// MandatoryMfaGate (inside AppShell) is the single place that checks AAL
// and challenges/enrolls TOTP, for every role — this page (like /login)
// used to duplicate that check and render its own inline MfaChallengeStep
// right here, which meant two separate implementations of the same gate
// could disagree about what to show (e.g. a stray code-entry screen after
// pressing the browser Back button). Now this page only ever does password
// auth and hands off to "/".
export function AdminLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function finishLogin() {
    void supabase.rpc('record_login_event').then(({ error }) => {
      if (error) console.warn('record_login_event failed:', error);
    });
    navigate('/');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const { data: throttle } = await supabase.rpc('check_login_throttle', { p_email: email });
    const status = throttle?.[0];
    if (status?.blocked) {
      const minutes = Math.ceil(status.retry_after_seconds / 60);
      setError(`Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
      return;
    }

    setSubmitting(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (authError) {
      void supabase.rpc('record_login_failure', { p_email: email });
      setError(friendlyErrorMessage(authError));
      return;
    }

    finishLogin();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 px-5">
      <Card className="w-full max-w-sm p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-2.5 font-bold">
          <span className="btn-gradient-accent grid h-6.5 w-6.5 place-items-center rounded-lg text-xs text-white shadow-[0_4px_12px_-4px_rgba(var(--shadow-tint),0.6)]">SD</span>
          SafeDrive Staff Portal
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
            Admin &amp; support access only.
          </p>
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Email</label>
            <input
              type="email"
              required
              autoFocus
              className="h-[38px] w-full rounded-md border border-line bg-surface px-3"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <PasswordInput value={password} onChange={setPassword} />
          {error ? <p className="text-sm text-bad">{error}</p> : null}
          <Button type="submit" block disabled={submitting}>
            {submitting ? 'Please wait…' : 'Sign In'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
