import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import type { CompanyInfo } from '@/lib/database.types';

async function fetchCompanyInfo() {
  const { data, error } = await supabase.from('company_info').select('*').order('key');
  if (error) throw error;
  return data as CompanyInfo[];
}

export function AdminCompanyInfoPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['company-info'], queryFn: fetchCompanyInfo });
  const [edited, setEdited] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async () => {
      for (const [key, value] of Object.entries(edited)) {
        const { error } = await supabase
          .from('company_info')
          .update({ value, updated_at: new Date().toISOString(), updated_by: profile!.id })
          .eq('key', key);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setEdited({});
      queryClient.invalidateQueries({ queryKey: ['company-info'] });
    },
  });

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Admin</div>
        <h1 className="text-2xl">Company Info</h1>
        <p className="mt-1.5 text-muted">
          Support contact details shown to users on the Help page and the emergency banner during active rentals.
        </p>
      </div>

      <Card className="p-5">
        {settings?.map((s) => (
          <div key={s.key} className="border-b border-line py-4 last:border-none">
            <label className="mb-1.5 block text-[13.5px] font-semibold">{s.key.replace(/_/g, ' ')}</label>
            <p className="mb-2 text-xs text-muted">{s.description}</p>
            <input
              className="input-base"
              placeholder="Not yet configured"
              defaultValue={s.value}
              onChange={(e) => setEdited((prev) => ({ ...prev, [s.key]: e.target.value }))}
            />
          </div>
        ))}

        <div className="mt-4 flex justify-end">
          <Button disabled={Object.keys(edited).length === 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
        {save.isSuccess ? <p className="mt-2 text-right text-xs text-good">Saved.</p> : null}
        {save.isError ? <p className="mt-2 text-right text-xs text-bad">{friendlyErrorMessage(save.error)}</p> : null}
      </Card>
    </div>
  );
}
