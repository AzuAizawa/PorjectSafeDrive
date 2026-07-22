import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import type { PlatformSetting } from '@/lib/database.types';

async function fetchSettings() {
  const { data, error } = await supabase.from('platform_settings').select('*').order('key');
  if (error) throw error;
  return data as PlatformSetting[];
}

export function AdminSettingsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['platform-settings'], queryFn: fetchSettings });
  const [edited, setEdited] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async () => {
      for (const [key, value] of Object.entries(edited)) {
        const { error } = await supabase
          .from('platform_settings')
          .update({ value: Number(value), updated_at: new Date().toISOString(), updated_by: profile!.id })
          .eq('key', key);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setEdited({});
      queryClient.invalidateQueries({ queryKey: ['platform-settings'] });
    },
  });

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Admin</div>
        <h1 className="text-2xl">Platform Settings</h1>
        <p className="mt-1.5 text-muted">Every business rule lives here — nothing is hardcoded in the app.</p>
      </div>

      <Card className="p-5">
        {settings?.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-5 border-b border-line py-4 last:border-none">
            <div>
              <div className="text-[13.5px] font-semibold">{s.key.replace(/_/g, ' ')}</div>
              <div className="text-xs text-muted">{s.description}</div>
            </div>
            <input
              className="input-base w-28 text-right tabular"
              defaultValue={String(s.value)}
              onChange={(e) => setEdited((prev) => ({ ...prev, [s.key]: e.target.value }))}
            />
          </div>
        ))}

        <div className="mt-4 flex justify-end">
          <Button disabled={Object.keys(edited).length === 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
        {save.isSuccess ? <p className="mt-2 text-right text-xs text-good">Saved — takes effect immediately.</p> : null}
        {save.isError ? <p className="mt-2 text-right text-xs text-bad">{friendlyErrorMessage(save.error)}</p> : null}
      </Card>
    </div>
  );
}
