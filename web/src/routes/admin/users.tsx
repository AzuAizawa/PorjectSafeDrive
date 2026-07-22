import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { signedUrl } from '@/lib/storage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { formatDate } from '@/lib/utils';
import type { Profile, VerificationSubmission } from '@/lib/database.types';

async function fetchUsers() {
  const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data as Profile[];
}

async function fetchLatestSubmission(profileId: string) {
  const { data, error } = await supabase
    .from('verification_submissions')
    .select('*')
    .eq('profile_id', profileId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  return data as VerificationSubmission;
}

const IMAGE_KEYS: (keyof VerificationSubmission)[] = [
  'license_front_path',
  'license_back_path',
  'national_id_front_path',
  'national_id_back_path',
  'selfie_with_id_path',
  'selfie_face_path',
];

function statusPill(status: Profile['verified_status']) {
  if (status === 'verified') return <Pill tone="good">Verified</Pill>;
  if (status === 'pending') return <Pill tone="warn">Pending</Pill>;
  if (status === 'rejected') return <Pill tone="bad">Rejected</Pill>;
  return <Pill tone="muted">Unverified</Pill>;
}

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState('');

  const { data: users } = useQuery({ queryKey: ['admin-users'], queryFn: fetchUsers });
  const { data: submission } = useQuery({
    queryKey: ['verification-submission', selectedId],
    queryFn: () => fetchLatestSubmission(selectedId!),
    enabled: !!selectedId,
  });

  async function openReview(profileId: string) {
    setSelectedId(profileId);
    setRejectReason('');
    const sub = await fetchLatestSubmission(profileId);
    const urls: Record<string, string> = {};
    for (const key of IMAGE_KEYS) {
      urls[key] = await signedUrl('user-verification', sub[key] as string);
    }
    setImageUrls(urls);
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    setSelectedId(null);
  };

  const approve = useMutation({
    mutationFn: async (submissionId: string) => {
      const { error } = await supabase.rpc('approve_verification', { p_submission_id: submissionId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: async (vars: { submissionId: string; reason: string }) => {
      const { error } = await supabase.rpc('reject_verification', { p_submission_id: vars.submissionId, p_reason: vars.reason });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Admin</div>
        <h1 className="text-2xl">Users</h1>
        <p className="mt-1.5 text-muted">Review verification submissions and manage accounts.</p>
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-5 items-start">
        <div className="rounded-2xl border border-line bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Strikes</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users?.map((u) => (
                <tr key={u.id} className="border-t border-line text-[13.5px]">
                  <td className="px-4 py-3 font-bold">{u.first_name ?? '—'} {u.last_name ?? ''}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">{statusPill(u.verified_status)}</td>
                  <td className="tabular px-4 py-3">{u.account_flagged ? <Pill tone="bad">⚠ {u.strike_count}</Pill> : u.strike_count}</td>
                  <td className="tabular px-4 py-3">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3">
                    {u.verified_status === 'pending' ? (
                      <Button size="sm" variant="secondary" onClick={() => openReview(u.id)}>Review</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selectedId && submission ? (
          <Card className="sticky top-[76px] p-5">
            <h3 className="mb-3 text-sm font-bold">Verification Review</h3>
            <dl className="mb-4 grid grid-cols-2 gap-3 text-[13px]">
              <div><dt className="text-xs text-muted">Full name</dt><dd className="font-semibold">{submission.first_name} {submission.middle_name} {submission.last_name}</dd></div>
              <div><dt className="text-xs text-muted">Birthday</dt><dd className="font-semibold">{formatDate(submission.birthday)}</dd></div>
              <div><dt className="text-xs text-muted">Phone</dt><dd className="font-semibold">{submission.phone}</dd></div>
              <div><dt className="text-xs text-muted">Address</dt><dd className="font-semibold">{submission.address}</dd></div>
              <div><dt className="text-xs text-muted">Driver's license #</dt><dd className="tabular font-semibold">{submission.driver_license_number}</dd></div>
              <div><dt className="text-xs text-muted">National ID #</dt><dd className="tabular font-semibold">{submission.national_id_number}</dd></div>
            </dl>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {IMAGE_KEYS.map((key) => (
                <a key={key} href={imageUrls[key]} target="_blank" rel="noreferrer" className="block rounded-md border border-line bg-surface-2 p-2 text-center text-[10px] text-muted">
                  {imageUrls[key] ? <img src={imageUrls[key]} className="mb-1 h-16 w-full rounded object-cover" /> : null}
                  {key.replace('_path', '').replace(/_/g, ' ')}
                </a>
              ))}
            </div>
            <input
              className="input-base mb-2"
              placeholder="Rejection reason (if rejecting)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={!rejectReason || reject.isPending}
                onClick={() => reject.mutate({ submissionId: submission.id, reason: rejectReason })}
              >
                Reject
              </Button>
              <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(submission.id)}>
                Approve
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
