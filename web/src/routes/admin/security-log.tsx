import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface AuthActivityRow {
  occurred_at: string;
  ip_address: string | null;
  action: string | null;
  actor_email: string | null;
  actor_name: string | null;
}

async function fetchAuthActivity() {
  const { data, error } = await supabase.rpc('get_auth_activity_log', { p_limit: 200 });
  if (error) throw error;
  return data as AuthActivityRow[];
}

export function AdminSecurityLogPage() {
  const { data: entries } = useQuery({ queryKey: ['admin-security-log'], queryFn: fetchAuthActivity });

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Admin</div>
        <h1 className="text-2xl">Security Log</h1>
        <p className="mt-1.5 text-muted">
          Login activity from Supabase Auth — who signed in, when, and from what IP. Distinct from the Audit Trail,
          which covers business actions rather than authentication events.
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[620px] border-collapse">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">IP address</th>
            </tr>
          </thead>
          <tbody>
            {entries?.map((e, i) => (
              <tr key={i} className="border-t border-line text-[13px]">
                <td className="tabular px-4 py-3">{new Date(e.occurred_at).toLocaleString()}</td>
                <td className="px-4 py-3">{e.actor_name || e.actor_email || '—'}</td>
                <td className="px-4 py-3">{e.action ?? '—'}</td>
                <td className="tabular px-4 py-3 text-muted">{e.ip_address ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries?.length === 0 ? <p className="p-6 text-center text-muted">No entries.</p> : null}
      </div>
    </div>
  );
}
