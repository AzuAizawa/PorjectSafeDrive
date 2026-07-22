import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { ListerAnalyticsTab } from '@/components/lister-analytics-tab';
import { cn, formatCurrency } from '@/lib/utils';
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

  return {
    vehicles: data as VehicleRow[],
    freeSlots: settings.free_vehicle_slots ?? 5,
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
  const [tab, setTab] = useState<'vehicles' | 'analytics'>('vehicles');
  const { data, isLoading } = useQuery({
    queryKey: ['vehicles', 'mine', profile?.id],
    queryFn: () => fetchMyVehicles(profile!.id),
    enabled: !!profile,
  });

  const activeCount = data?.vehicles.filter((v) => v.listing_status === 'active').length ?? 0;
  const freeSlots = data?.freeSlots ?? 5;
  const pct = Math.min(100, (activeCount / freeSlots) * 100);

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
                <div className="text-[13.5px] font-bold">{activeCount} of {freeSlots} free slots used</div>
                <p className="text-xs text-muted">
                  Need more? Subscribe for {data?.subscriptionSlots ?? 15} additional slots.
                </p>
              </div>
              <Button variant="secondary" size="sm" disabled={subscribe.isPending} onClick={() => subscribe.mutate()}>
                {subscribe.isPending ? 'Redirecting…' : `Subscribe — ${formatCurrency(data?.subscriptionPrice ?? 399)}/mo`}
              </Button>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
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
                    <td className="px-4 py-3">{statusPill(v)}</td>
                    <td className="px-4 py-3">
                      <Link to={`/my-vehicles/${v.id}/edit`}><Button size="sm" variant="secondary">Edit</Button></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data?.vehicles.length === 0 ? <p className="p-8 text-center text-muted">No vehicles yet.</p> : null}
          </div>
        </>
      )}
    </div>
  );
}
