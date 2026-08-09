import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Supabase Auth's native TOTP MFA — mandatory for every account
// (mandatory-mfa-gate.tsx wraps all of AppShell, including this page's
// /profile route), so a verified factor always already exists by the time
// this renders. There's deliberately no "Disable" button: an account can't
// drop back below aal2 on its own, matching staff's existing restriction
// (034_mandatory_mfa_for_staff.sql). Losing the device is handled via backup
// codes below, which re-enroll a fresh factor rather than removing 2FA.
export function TwoFactorSection() {
  const [error, setError] = useState<string | null>(null);

  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const generateCodes = useMutation({
    mutationFn: async () => {
      const { data, error: genError } = await supabase.rpc('generate_mfa_recovery_codes');
      if (genError) throw genError;
      return data as string[];
    },
    onSuccess: (codes) => setRecoveryCodes(codes),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Card className="mt-5 max-w-lg p-5">
      <h3 className="mb-1 text-sm font-bold">Two-Factor Authentication</h3>
      <p className="mb-3 text-xs text-muted">
        Required for every account and can't be disabled.
      </p>

      <div className="rounded-md bg-good-soft p-3 text-sm text-good">
        ✓ Authenticator app enabled
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Backup Codes</h4>
        <p className="mb-2 text-xs text-muted">
          Lost your authenticator? A backup code lets you reset 2FA and enroll a new one. Generate a set now,
          while you still have access — each code works once, and generating a new set invalidates any old ones.
        </p>
        {recoveryCodes ? (
          <div className="rounded-md border border-warn bg-warn-soft p-3">
            <p className="mb-2 text-xs font-bold text-warn">
              Save these somewhere safe now — they won't be shown again.
            </p>
            <div className="tabular grid grid-cols-2 gap-1.5 text-sm font-semibold">
              {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
            </div>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setRecoveryCodes(null)}>
              Done
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" disabled={generateCodes.isPending} onClick={() => generateCodes.mutate()}>
            {generateCodes.isPending ? 'Generating…' : 'Generate Backup Codes'}
          </Button>
        )}
      </div>
      {error ? <p className="mt-2 text-xs text-bad">{error}</p> : null}
    </Card>
  );
}
