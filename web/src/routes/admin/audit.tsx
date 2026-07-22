import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AuditEntry } from '@/lib/database.types';

type AuditRow = AuditEntry & { actor: { first_name: string | null; last_name: string | null; email: string } | null };

async function fetchAudit(entityType: string) {
  let query = supabase
    .from('audit_trail')
    .select('*, actor:profiles(first_name, last_name, email)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (entityType) query = query.eq('entity_type', entityType);
  const { data, error } = await query;
  if (error) throw error;
  return data as unknown as AuditRow[];
}

const ENTITY_TYPES = ['', 'user', 'vehicle', 'booking', 'dispute', 'review', 'subscription'];

export function AdminAuditPage() {
  const [entityType, setEntityType] = useState('');
  const { data: entries } = useQuery({ queryKey: ['admin-audit', entityType], queryFn: () => fetchAudit(entityType) });

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Admin</div>
        <h1 className="text-2xl">Audit Trail</h1>
        <p className="mt-1.5 text-muted">Chronological log of every system and admin action.</p>
      </div>

      <div className="mb-4">
        <select className="input-base w-52" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t ? t : 'All entity types'}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[620px] border-collapse">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
              <th className="px-4 py-3">Timestamp</th><th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th><th className="px-4 py-3">Entity</th>
            </tr>
          </thead>
          <tbody>
            {entries?.map((e) => (
              <tr key={e.id} className="border-t border-line text-[13px]">
                <td className="tabular px-4 py-3">{new Date(e.created_at).toLocaleString()}</td>
                <td className="px-4 py-3">{e.actor ? `${e.actor.first_name ?? ''} ${e.actor.last_name ?? ''}`.trim() || e.actor.email : 'System'}</td>
                <td className="px-4 py-3">{e.action}</td>
                <td className="px-4 py-3">{e.entity_type} {e.entity_id ? `#${e.entity_id.slice(0, 8)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries?.length === 0 ? <p className="p-6 text-center text-muted">No entries.</p> : null}
      </div>
    </div>
  );
}
