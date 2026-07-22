import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PasswordInput, passwordMeetsRules } from '@/components/password-input';

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
    if (!passwordMeetsRules(password)) {
      setError('Password does not meet all the requirements below.');
      return;
    }
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) { setError(updateError.message); return; }
    setDone(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <Card className="w-full max-w-sm p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-2.5 font-bold">
          <span className="btn-gradient-accent grid h-6.5 w-6.5 place-items-center rounded-lg text-xs text-white shadow-[0_4px_12px_-4px_rgba(var(--shadow-tint),0.6)]">SD</span>
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
            <PasswordInput value={password} onChange={setPassword} label="New password" showChecklist />
            <PasswordInput value={confirmPassword} onChange={setConfirmPassword} label="Confirm new password" />
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
