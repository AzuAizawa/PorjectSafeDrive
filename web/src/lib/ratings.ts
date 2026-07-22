import { supabase } from '@/lib/supabase';

export interface RatingSummary {
  avg: number;
  count: number;
}

async function fetchOne(profileId: string): Promise<RatingSummary> {
  const { data, error } = await supabase.rpc('get_rating_summary', { p_profile_id: profileId });
  if (error) throw error;
  const row = data?.[0] as { avg_rating: number | string; rating_count: number } | undefined;
  return { avg: row ? Number(row.avg_rating) : 0, count: row?.rating_count ?? 0 };
}

// One RPC call per unique profile (not per booking row) — the visibility
// rule (both sides submitted, or 14 days since completion) lives entirely
// server-side in get_rating_summary(), so this never has to re-derive it.
export async function fetchRatingSummaries(profileIds: string[]): Promise<Map<string, RatingSummary>> {
  const uniqueIds = [...new Set(profileIds)];
  const results = await Promise.all(uniqueIds.map(fetchOne));
  return new Map(uniqueIds.map((id, i) => [id, results[i]]));
}
