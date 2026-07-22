import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) { setError(updateError.message); return; }
    setDone(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-5">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2.5 font-bold">
          <span className="grid h-6.5 w-6.5 place-items-center rounded-md bg-accent text-xs text-white">SD</span>
          SafeDrive
        </div>

        {done ? (
          <>
            <p className="mb-4 text-sm text-muted">Your password has been updated.</p>
            <Button block onClick={() => navigate('/browse')}>Continue</Button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <p className="text-sm text-muted">Choose a new password for your account.</p>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">New password</label>
              <input
                type="password"
                required
                minLength={8}
                className="h-[38px] w-full rounded-md border border-line bg-surface px-3"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Confirm new password</label>
              <input
                type="password"
                required
                className="h-[38px] w-full rounded-md border border-line bg-surface px-3"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <Button type="submit" block disabled={submitting}>
              {submitting ? 'Saving…' : 'Update Password'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
