import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Car } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { EmptyState } from '@/components/ui/empty-state';
import { ListerAnalyticsTab } from '@/components/lister-analytics-tab';
import { cn, formatCurrency } from '@/lib/utils';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import { orcrExpiryStatus } from '@/lib/vehicle-expiry';
import type { CarBrand, CarModel, Vehicle } from '@/lib/database.types';

type VehicleRow = Vehicle & { model: CarModel & { brand: CarBrand } };

async function fetchMyVehicles(ownerId: string) {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*, model:car_models(*, brand:car_brands(*))')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const { data: settingsRows } = await supabase
    .from('platform_settings')
    .select('key, value')
    .in('key', ['free_vehicle_slots', 'subscription_price', 'subscription_slots']);
  const settings = Object.fromEntries((settingsRows ?? []).map((s) => [s.key, Number(s.value)]));

  // The actual usable capacity includes any active (non-expired) subscription
  // slots on top of the free tier — see get_vehicle_slot_capacity() /
  // 029_vehicle_quota_enforcement.sql, the source of truth approve_vehicle()
  // itself checks. Read it the same way here so the progress bar and the
  // enforcement it's describing never disagree.
  const { data: capacityRow } = await supabase.rpc('get_vehicle_slot_capacity', { p_profile_id: ownerId });

  return {
    vehicles: data as VehicleRow[],
    freeSlots: settings.free_vehicle_slots ?? 5,
    capacity: (capacityRow as unknown as number) ?? settings.free_vehicle_slots ?? 5,
    subscriptionPrice: settings.subscription_price ?? 399,
    subscriptionSlots: settings.subscription_slots ?? 15,
  };
}

function statusPill(v: Vehicle) {
  if (v.approval_status === 'pending') return <Pill tone="warn">Pending Approval</Pill>;
  if (v.approval_status === 'rejected') return <Pill tone="bad">Rejected</Pill>;
  if (v.listing_status === 'paused_over_quota') return <Pill tone="bad">Paused — Over Quota</Pill>;
  if (v.listing_status === 'paused_by_owner') return <Pill tone="muted">Paused</Pill>;
  return <Pill tone="good">Approved · Active</Pill>;
}

export function MyVehiclesPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'vehicles' | 'analytics'>('vehicles');
  const { data, isLoading } = useQuery({
    queryKey: ['vehicles', 'mine', profile?.id],
    queryFn: () => fetchMyVehicles(profile!.id),
    enabled: !!profile,
  });

  const activeCount = data?.vehicles.filter((v) => v.listing_status === 'active').length ?? 0;
  const overQuotaCount = data?.vehicles.filter((v) => v.listing_status === 'paused_over_quota').length ?? 0;
  const capacity = data?.capacity ?? data?.freeSlots ?? 5;
  const pct = Math.min(100, (activeCount / capacity) * 100);

  const isVerified = profile?.verified_status === 'verified';

  const subscribe = useMutation({
    mutationFn: async () => {
      const { data: checkout, error } = await supabase.functions.invoke('create-checkout', {
        body: { payment_type: 'subscription' },
      });
      if (error) throw error;
      return checkout.checkout_url as string;
    },
    onSuccess: (checkoutUrl) => {
      window.location.href = checkoutUrl;
    },
  });

  function handleSubscribeClick() {
    if (!isVerified) {
      navigate('/verify');
      return;
    }
    subscribe.mutate();
  }

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Lister</div>
          <h1 className="text-2xl">My Vehicles</h1>
        </div>
        {tab === 'vehicles' ? <Link to="/my-vehicles/new"><Button>+ Add Vehicle</Button></Link> : null}
      </div>

      <div className="mb-5 flex gap-1 border-b border-line">
        {(['vehicles', 'analytics'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-semibold capitalize',
              tab === t ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'
            )}
          >
            {t === 'vehicles' ? 'My Vehicles' : 'Analytics'}
          </button>
        ))}
      </div>

      {tab === 'analytics' ? (
        profile ? <ListerAnalyticsTab ownerId={profile.id} /> : null
      ) : isLoading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          <Card className="mb-5 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13.5px] font-bold">{activeCount} of {capacity} slots used</div>
                <p className="text-xs text-muted">
                  {capacity > (data?.freeSlots ?? 5)
                    ? `${data?.freeSlots ?? 5} free + subscription slots active.`
                    : `Need more? Subscribe for ${data?.subscriptionSlots ?? 15} additional slots.`}
                  {overQuotaCount > 0 ? ` ${overQuotaCount} vehicle${overQuotaCount > 1 ? 's are' : ' is'} paused over quota.` : ''}
                </p>
              </div>
              <Button variant="secondary" size="sm" disabled={subscribe.isPending} onClick={handleSubscribeClick}>
                {subscribe.isPending
                  ? 'Redirecting…'
                  : isVerified
                    ? `Subscribe — ${formatCurrency(data?.subscriptionPrice ?? 399)}/mo`
                    : 'Get Verified to Subscribe'}
              </Button>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className={cn('h-full', overQuotaCount > 0 ? 'bg-bad' : 'bg-accent')} style={{ width: `${pct}%` }} />
            </div>
            {subscribe.isError ? <p className="mt-2 text-xs text-bad">{friendlyErrorMessage(subscribe.error)}</p> : null}
          </Card>

          <div className="rounded-2xl border border-line bg-surface">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Plate</th>
                  <th className="px-4 py-3">Price/day</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {data?.vehicles.map((v) => (
                  <tr key={v.id} className="border-t border-line text-[13.5px]">
                    <td className="px-4 py-3 font-bold">{v.model.brand.name} {v.model.name}</td>
                    <td className="tabular px-4 py-3">{v.plate_number}</td>
                    <td className="tabular px-4 py-3">{formatCurrency(v.daily_price)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {statusPill(v)}
                        {orcrExpiryStatus(v.orcr_expiry_date).tone === 'warn' || orcrExpiryStatus(v.orcr_expiry_date).tone === 'bad' ? (
                          <Pill tone={orcrExpiryStatus(v.orcr_expiry_date).tone}>{orcrExpiryStatus(v.orcr_expiry_date).label}</Pill>
                        ) : null}
                      </div>
                      {v.approval_status === 'rejected' && v.rejection_reason ? (
                        <p className="mt-1 max-w-[220px] text-xs text-muted">{v.rejection_reason}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/my-vehicles/${v.id}/edit`}><Button size="sm" variant="secondary">Edit</Button></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data?.vehicles.length === 0 ? (
              <EmptyState
                icon={Car}
                title="No vehicles yet"
                description="List your first car to start earning."
                action={{ label: '+ Add Vehicle', onClick: () => navigate('/my-vehicles/new') }}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
