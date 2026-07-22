import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { CompanyInfo } from '@/lib/database.types';

async function fetchContactInfo() {
  const { data, error } = await supabase.from('company_info').select('key, value');
  if (error) throw error;
  return Object.fromEntries((data as CompanyInfo[]).map((s) => [s.key, s.value]));
}

// Shown on active-rental screens. Deliberately not an in-app form/ticket -
// a real emergency needs a phone call, not async admin review (see
// decisions doc: this is a support/ops process, not a database feature).
export function EmergencyBanner() {
  const { data } = useQuery({ queryKey: ['company-info-contact'], queryFn: fetchContactInfo });
  const hasContact = data?.support_phone || data?.support_email;

  if (!hasContact) return null;

  return (
    <div className="mb-4 rounded-md border border-warn bg-warn-soft p-3 text-xs text-warn">
      <strong>In an emergency, contact SafeDrive support</strong>
      {data.support_phone ? <> at <strong>{data.support_phone}</strong></> : null}
      {data.support_phone && data.support_email ? ' or ' : data.support_email ? ' at ' : ''}
      {data.support_email ? <strong>{data.support_email}</strong> : null}.
      {data.emergency_note ? <> {data.emergency_note}</> : null}
    </div>
  );
}
