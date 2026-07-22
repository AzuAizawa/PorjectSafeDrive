import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { signedUrl } from '@/lib/storage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { formatDate } from '@/lib/utils';
import type { Dispute, Profile } from '@/lib/database.types';

type DisputeRow = Dispute & {
  reporter: Pick<Profile, 'first_name' | 'last_name'>;
  booking: { vehicle_id: string };
};

async function fetchDisputes() {
  const { data, error } = await supabase
    .from('disputes')
    .select('*, reporter:profiles(first_name, last_name), booking:bookings(vehicle_id)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as unknown as DisputeRow[];
}

export function AdminDisputesPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<DisputeRow | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [refundAmount, setRefundAmount] = useState('0');

  const { data: disputes } = useQuery({ queryKey: ['admin-disputes'], queryFn: fetchDisputes });

  async function openDispute(d: DisputeRow) {
    setSelected(d);
    setNotes('');
    setRefundAmount('0');
    const urls = await Promise.all(d.photo_paths.map((p) => signedUrl('dispute-evidence', p)));
    setPhotoUrls(urls);
  }

  const resolve = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('resolve_dispute', {
        p_dispute_id: selected!.id,
        p_resolution_notes: notes,
        p_refund_amount: Number(refundAmount) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-disputes'] });
      setSelected(null);
    },
  });

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Admin</div>
        <h1 className="text-2xl">Disputes</h1>
        <p className="mt-1.5 text-muted">Reported issues awaiting mediation.</p>
      </div>

      <div className="grid grid-cols-[1.3fr_1fr] items-start gap-5">
        <div className="flex flex-col gap-3">
          {disputes?.map((d) => (
            <Card key={d.id} className="cursor-pointer p-4" onClick={() => openDispute(d)}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-bold">Reported by {d.reporter.first_name} {d.reporter.last_name}</div>
                  <div className="text-xs text-muted">{formatDate(d.created_at)}</div>
                </div>
                <Pill tone={d.status === 'open' ? 'warn' : 'good'}>{d.status === 'open' ? 'Open' : 'Resolved'}</Pill>
              </div>
              <p className="mt-2 text-sm text-muted line-clamp-2">{d.description}</p>
            </Card>
          ))}
          {disputes?.length === 0 ? <p className="py-16 text-center text-muted">No disputes reported.</p> : null}
        </div>

        {selected ? (
          <Card className="sticky top-[76px] p-5">
            <h3 className="mb-2 text-sm font-bold">Dispute Detail</h3>
            <p className="mb-3 text-sm">{selected.description}</p>
            {photoUrls.length > 0 ? (
              <div className="mb-3 grid grid-cols-3 gap-2">
                {photoUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer">
                    <img src={url} className="h-16 w-full rounded-md object-cover" />
                  </a>
                ))}
              </div>
            ) : null}

            {selected.status === 'resolved' ? (
              <div className="rounded-md bg-good-soft p-3 text-sm text-good">
                Resolved: {selected.resolution_notes}
              </div>
            ) : (
              <>
                <textarea
                  className="input-base mb-2 h-20"
                  placeholder="Resolution notes…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Refund amount (₱)</label>
                <input
                  type="number"
                  className="input-base mb-3"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button size="sm" disabled={!notes || resolve.isPending} onClick={() => resolve.mutate()}>
                    Resolve Dispute
                  </Button>
                </div>
              </>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
