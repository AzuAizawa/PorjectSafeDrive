import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { formatDate } from '@/lib/utils';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import { roleLabel } from '@/lib/role-display';
import type { Profile, RoleChangeRequest } from '@/lib/database.types';

type RequestRow = RoleChangeRequest & {
  target: Pick<Profile, 'first_name' | 'last_name' | 'email'>;
  requester: Pick<Profile, 'first_name' | 'last_name'>;
};

async function fetchUsers() {
  const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data as Profile[];
}

async function fetchPendingRequests() {
  const { data, error } = await supabase
    .from('role_change_requests')
    .select(
      `*, target:profiles!role_change_requests_target_profile_id_fkey(first_name, last_name, email),
       requester:profiles!role_change_requests_requested_by_fkey(first_name, last_name)`
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as unknown as RequestRow[];
}

export function AdminRoleManagementPage() {
  const { profile: viewer } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Profile | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffResult, setNewStaffResult] = useState<string | null>(null);

  const { data: users } = useQuery({ queryKey: ['role-mgmt-users'], queryFn: fetchUsers });
  const { data: requests } = useQuery({ queryKey: ['role-mgmt-requests'], queryFn: fetchPendingRequests });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['role-mgmt-users'] });
    queryClient.invalidateQueries({ queryKey: ['role-mgmt-requests'] });
    setSelected(null);
  };

  const createStaff = useMutation({
    mutationFn: async (email: string) => {
      const { data, error } = await supabase.functions.invoke('create-staff-account', { body: { email } });
      if (error) throw error;
      return data as { email: string };
    },
    onSuccess: (data) => {
      setNewStaffResult(`Invite sent to ${data.email} — they'll set their own password and start as Support.`);
      setNewStaffEmail('');
      queryClient.invalidateQueries({ queryKey: ['role-mgmt-users'] });
    },
  });

  const requestChange = useMutation({
    mutationFn: async (newRole: 'admin' | 'super_admin') => {
      const { error } = await supabase.rpc('request_role_change', { p_profile_id: selected!.id, p_new_role: newRole });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const demote = useMutation({
    mutationFn: async (newRole: 'support' | 'user') => {
      const { error } = await supabase.rpc('promote_user_role', { p_profile_id: selected!.id, p_new_role: newRole });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const approve = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc('approve_role_change_request', { p_request_id: requestId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['role-mgmt-requests'] }),
  });

  const reject = useMutation({
    mutationFn: async (vars: { requestId: string; reason: string }) => {
      const { error } = await supabase.rpc('reject_role_change_request', { p_request_id: vars.requestId, p_reason: vars.reason });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-mgmt-requests'] });
      setRejectingId(null);
      setRejectReason('');
    },
  });

  const hasPendingFor = (profileId: string) => requests?.some((r) => r.target_profile_id === profileId) ?? false;

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Super Admin</div>
        <h1 className="text-2xl">Role Management</h1>
        <p className="mt-1.5 max-w-[70ch] text-muted">
          Granting Admin or Super Admin requires a second super admin's approval. Demotions to Support or User take
          effect immediately. Every change is recorded in the Audit Trail and notified to other super admins.
        </p>
      </div>

      <Card className="mb-4.5 p-5">
        <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Create Staff Account</h4>
        <p className="mb-3 max-w-[70ch] text-xs text-muted">
          Staff accounts are always created fresh, never by promoting an existing renter/customer account — the new
          hire gets their own dedicated identity from day one, starting at Support, and sets their own password via
          an emailed invite. Escalating from there still goes through the approval flow above.
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setNewStaffResult(null);
            createStaff.mutate(newStaffEmail);
          }}
        >
          <div className="flex-1 min-w-[220px]">
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Email</label>
            <input
              type="email"
              required
              className="input-base w-full"
              value={newStaffEmail}
              onChange={(e) => setNewStaffEmail(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={createStaff.isPending}>
            {createStaff.isPending ? 'Sending invite…' : 'Send Invite'}
          </Button>
        </form>
        {newStaffResult ? <p className="mt-2 text-xs text-good">{newStaffResult}</p> : null}
        {createStaff.isError ? <p className="mt-2 text-xs text-bad">{friendlyErrorMessage(createStaff.error)}</p> : null}
      </Card>

      {requests && requests.length > 0 ? (
        <Card className="mb-4.5 p-5">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Pending Approval</h4>
          <div className="flex flex-col gap-2.5">
            {requests.map((r) => {
              const isOwnRequest = r.requested_by === viewer?.id;
              return (
                <div key={r.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <strong>{r.target.first_name} {r.target.last_name}</strong> ({r.target.email}) → requested{' '}
                      <Pill tone="warn">{roleLabel(r.requested_role)}</Pill>
                    </div>
                    <span className="text-xs text-muted">
                      by {r.requester.first_name} {r.requester.last_name} · {formatDate(r.created_at)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {isOwnRequest ? (
                      <span className="text-xs text-muted">A different super admin must approve your own request.</span>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={rejectingId === r.id}
                      onClick={() => { setRejectingId(r.id); setRejectReason(''); }}
                    >
                      Reject
                    </Button>
                    <Button size="sm" disabled={isOwnRequest || approve.isPending} onClick={() => approve.mutate(r.id)}>
                      Approve
                    </Button>
                  </div>
                  {rejectingId === r.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        className="input-base flex-1"
                        placeholder="Reason for rejecting (optional)"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                      <Button size="sm" variant="danger" disabled={reject.isPending} onClick={() => reject.mutate({ requestId: r.id, reason: rejectReason })}>
                        Confirm Reject
                      </Button>
                    </div>
                  ) : null}
                  {approve.isError ? <p className="text-xs text-bad">{friendlyErrorMessage(approve.error)}</p> : null}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-[1.4fr_1fr] items-start gap-5">
        <div className="rounded-2xl border border-line bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
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
                  <td className="px-4 py-3">
                    <Pill tone={u.role === 'super_admin' ? 'warn' : u.role === 'admin' ? 'good' : u.role === 'support' ? 'muted' : undefined}>
                      {roleLabel(u.role)}
                    </Pill>
                    {hasPendingFor(u.id) ? <span className="ml-1.5 text-xs text-muted">(request pending)</span> : null}
                  </td>
                  <td className="tabular px-4 py-3">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="secondary" onClick={() => setSelected(u)}>Manage</Button>
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
              <div>
                <h3 className="text-sm font-bold">{selected.first_name} {selected.last_name}</h3>
                <p className="text-xs text-muted">Current role: {roleLabel(selected.role)}</p>
              </div>
            </div>

            {selected.id === viewer?.id ? (
              <p className="text-xs text-muted">You can't change your own role here.</p>
            ) : hasPendingFor(selected.id) ? (
              <p className="text-xs text-muted">A role change request is already pending for this account — resolve it above first.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {selected.role === 'support' ? (
                  <div>
                    <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Request escalation</h4>
                    <p className="mb-2 text-xs text-muted">Requires a different super admin to approve before it takes effect.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" disabled={requestChange.isPending} onClick={() => requestChange.mutate('admin')}>
                        Request → Admin
                      </Button>
                      <Button size="sm" variant="secondary" disabled={requestChange.isPending} onClick={() => requestChange.mutate('super_admin')}>
                        Request → Super Admin
                      </Button>
                    </div>
                    {requestChange.isError ? <p className="mt-2 text-xs text-bad">{friendlyErrorMessage(requestChange.error)}</p> : null}
                  </div>
                ) : selected.role === 'user' ? (
                  <p className="text-xs text-muted">
                    Renter/customer accounts can't be escalated to staff here — use "Create Staff Account" above to
                    provision a dedicated account instead.
                  </p>
                ) : null}

                <div>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Demote (immediate, no approval needed)</h4>
                  <div className="flex flex-wrap gap-2">
                    {selected.role === 'admin' || selected.role === 'super_admin' ? (
                      <Button size="sm" variant="secondary" disabled={demote.isPending} onClick={() => demote.mutate('support')}>
                        Set to Support
                      </Button>
                    ) : null}
                    {selected.role !== 'user' ? (
                      <Button size="sm" variant="danger" disabled={demote.isPending} onClick={() => demote.mutate('user')}>
                        Set to User
                      </Button>
                    ) : null}
                  </div>
                  {demote.isError ? <p className="mt-2 text-xs text-bad">{friendlyErrorMessage(demote.error)}</p> : null}
                </div>
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
