import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { signedUrl } from '@/lib/storage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { formatDate } from '@/lib/utils';
import { friendlyErrorMessage } from '@/lib/friendly-error';
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
    .maybeSingle();
  if (error) throw error;
  return data as VerificationSubmission | null;
}

const IMAGE_KEYS: (keyof VerificationSubmission)[] = [
  'license_front_path',
  'license_back_path',
  'secondary_id_front_path',
  'secondary_id_back_path',
  'selfie_with_id_path',
  'selfie_face_path',
];

function statusPill(status: Profile['verified_status']) {
  if (status === 'verified') return <Pill tone="good">Verified</Pill>;
  if (status === 'pending') return <Pill tone="warn">Pending</Pill>;
  if (status === 'rejected') return <Pill tone="bad">Rejected</Pill>;
  return <Pill tone="muted">Unverified</Pill>;
}

function accountPill(status: Profile['account_status']) {
  if (status === 'suspended') return <Pill tone="warn">Suspended</Pill>;
  if (status === 'banned') return <Pill tone="bad">Banned</Pill>;
  return null;
}

export function AdminUsersPage() {
  const { profile: viewer } = useAuth();
  const isFullAdmin = viewer?.role === 'admin';
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Profile | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState('');

  const { data: users } = useQuery({ queryKey: ['admin-users'], queryFn: fetchUsers });
  const { data: submission } = useQuery({
    queryKey: ['verification-submission', selected?.id],
    queryFn: () => fetchLatestSubmission(selected!.id),
    enabled: !!selected,
  });

  async function openUser(user: Profile) {
    setSelected(user);
    setRejectReason('');
    setImageUrls({});
    if (user.verified_status === 'pending') {
      const sub = await fetchLatestSubmission(user.id);
      if (sub) {
        const urls: Record<string, string> = {};
        for (const key of IMAGE_KEYS) urls[key] = await signedUrl('user-verification', sub[key] as string);
        setImageUrls(urls);
      }
    }
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    setSelected(null);
  };

  const approve = useMutation({
    mutationFn: async (vars: { submissionId: string; profileId: string; selfieFacePath: string }) => {
      // The face-only selfie lives in the private user-verification bucket
      // (ID-document-adjacent). On approval, copy just that one file into
      // the public avatars bucket so it can double as the user's visible
      // profile picture for the other party in a booking — see 027_profile_avatar.sql.
      const { data: blob, error: downloadError } = await supabase.storage
        .from('user-verification')
        .download(vars.selfieFacePath);
      if (downloadError) throw downloadError;

      const avatarPath = `${vars.profileId}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(avatarPath, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { error } = await supabase.rpc('approve_verification', {
        p_submission_id: vars.submissionId,
        p_avatar_path: avatarPath,
      });
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
  const setStatus = useMutation({
    mutationFn: async (status: 'active' | 'suspended' | 'banned') => {
      const { error } = await supabase.rpc('set_account_status', { p_profile_id: selected!.id, p_status: status });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const clearStrikes = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('clear_strikes', { p_profile_id: selected!.id });
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

      <div className="grid grid-cols-[1.4fr_1fr] items-start gap-5">
        <div className="rounded-2xl border border-line bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Verification</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Strikes</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users?.map((u) => (
                <tr key={u.id} className="border-t border-line text-[13.5px]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar avatarPath={u.avatar_url} firstName={u.first_name} lastName={u.last_name} size="sm" />
                      <div>
                        <div className="font-bold">{u.first_name ?? '—'} {u.last_name ?? ''}</div>
                        <div className="text-xs text-muted">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{statusPill(u.verified_status)}</td>
                  <td className="px-4 py-3">{accountPill(u.account_status) ?? <span className="text-xs text-muted">Active</span>}</td>
                  <td className="tabular px-4 py-3">{u.account_flagged ? <Pill tone="bad">⚠ {u.strike_count}</Pill> : u.strike_count}</td>
                  <td className="tabular px-4 py-3">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="secondary" onClick={() => openUser(u)}>Manage</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected ? (
          <Card className="sticky top-[76px] p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <Avatar avatarPath={selected.avatar_url} firstName={selected.first_name} lastName={selected.last_name} />
              <h3 className="text-sm font-bold">{selected.first_name} {selected.last_name}</h3>
            </div>

            {selected.verified_status === 'pending' && submission ? (
              <>
                {submission.ban_evasion_flag ? (
                  <div className="mb-3 rounded-md border border-bad bg-bad-soft p-3 text-xs text-bad">
                    ⚠ This submission's driver's license or national ID number matches a previously <strong>banned</strong> account.
                    Review carefully before approving — it may be the same person re-registering under a new email.
                  </div>
                ) : null}
                <dl className="mb-4 grid grid-cols-2 gap-3 text-[13px]">
                  <div><dt className="text-xs text-muted">Full name</dt><dd className="font-semibold">{submission.first_name} {submission.middle_name} {submission.last_name}</dd></div>
                  <div><dt className="text-xs text-muted">Birthday</dt><dd className="font-semibold">{formatDate(submission.birthday)}</dd></div>
                  <div><dt className="text-xs text-muted">Phone</dt><dd className="font-semibold">{submission.phone}</dd></div>
                  <div><dt className="text-xs text-muted">Address</dt><dd className="font-semibold">{submission.address}</dd></div>
                  <div><dt className="text-xs text-muted">Driver's license #</dt><dd className="tabular font-semibold">{submission.driver_license_number}</dd></div>
                  <div><dt className="text-xs text-muted">Secondary ID type</dt><dd className="font-semibold capitalize">{submission.secondary_id_type.replace(/_/g, ' ')}</dd></div>
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
                <div className="mb-4 flex justify-end gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={!rejectReason || reject.isPending}
                    onClick={() => reject.mutate({ submissionId: submission.id, reason: rejectReason })}
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    disabled={approve.isPending}
                    onClick={() =>
                      approve.mutate({
                        submissionId: submission.id,
                        profileId: selected.id,
                        selfieFacePath: submission.selfie_face_path,
                      })
                    }
                  >
                    {approve.isPending ? 'Approving…' : 'Approve'}
                  </Button>
                </div>
                {approve.isError ? <p className="mb-3 text-xs text-bad">{friendlyErrorMessage(approve.error)}</p> : null}
              </>
            ) : (
              <p className="mb-4 text-sm text-muted">{statusPill(selected.verified_status)}</p>
            )}

            <div className="border-t border-line pt-4">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Account Standing</h4>
              <div className="mb-3 flex items-center justify-between text-sm">
                <span>Strikes: {selected.strike_count}{selected.account_flagged ? ' — flagged for review' : ''}</span>
                {isFullAdmin && selected.strike_count > 0 ? (
                  <Button size="sm" variant="secondary" disabled={clearStrikes.isPending} onClick={() => clearStrikes.mutate()}>
                    Clear Strikes
                  </Button>
                ) : null}
              </div>
              {isFullAdmin ? (
                <div className="flex flex-wrap gap-2">
                  {selected.account_status !== 'active' ? (
                    <Button size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate('active')}>Reactivate</Button>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" disabled={setStatus.isPending} onClick={() => setStatus.mutate('suspended')}>
                        Suspend
                      </Button>
                      <Button size="sm" variant="danger" disabled={setStatus.isPending} onClick={() => setStatus.mutate('banned')}>
                        Ban
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted">Suspend/ban actions require full admin access.</p>
              )}
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
