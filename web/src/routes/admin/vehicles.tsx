import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { signedUrl } from '@/lib/storage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { formatCurrency } from '@/lib/utils';
import type { CarBrand, CarModel, ListingReport, Profile, Vehicle } from '@/lib/database.types';

type VehicleRow = Vehicle & { model: CarModel & { brand: CarBrand }; owner: Pick<Profile, 'first_name' | 'last_name' | 'verified_status'> };
type ReportRow = ListingReport & {
  vehicle: { model: CarModel & { brand: CarBrand } };
  reporter: Pick<Profile, 'first_name' | 'last_name'>;
};

async function fetchVehicles() {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*, model:car_models(*, brand:car_brands(*)), owner:profiles(first_name, last_name, verified_status)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as unknown as VehicleRow[];
}

async function fetchOpenReports() {
  const { data, error } = await supabase
    .from('listing_reports')
    .select('*, vehicle:vehicles(model:car_models(*, brand:car_brands(*))), reporter:profiles(first_name, last_name)')
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as unknown as ReportRow[];
}

function statusPill(v: Vehicle) {
  if (v.approval_status === 'pending') return <Pill tone="warn">Pending</Pill>;
  if (v.approval_status === 'rejected') return <Pill tone="bad">Rejected</Pill>;
  return <Pill tone="good">Approved</Pill>;
}

export function AdminVehiclesPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<VehicleRow | null>(null);
  const [orcrUrl, setOrcrUrl] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: vehicles } = useQuery({ queryKey: ['admin-vehicles'], queryFn: fetchVehicles });
  const { data: reports } = useQuery({ queryKey: ['admin-listing-reports'], queryFn: fetchOpenReports });

  async function openReview(v: VehicleRow) {
    setSelected(v);
    setRejectReason('');
    setOrcrUrl(v.orcr_path ? await signedUrl('vehicle-documents', v.orcr_path) : null);
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-vehicles'] });
    setSelected(null);
  };

  const approve = useMutation({
    mutationFn: async (vehicleId: string) => {
      const { error } = await supabase.rpc('approve_vehicle', { p_vehicle_id: vehicleId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: async (vars: { vehicleId: string; reason: string }) => {
      const { error } = await supabase.rpc('reject_vehicle', { p_vehicle_id: vars.vehicleId, p_reason: vars.reason });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const dismissReport = useMutation({
    mutationFn: async (reportId: string) => {
      const { error } = await supabase.rpc('resolve_listing_report', { p_report_id: reportId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-listing-reports'] }),
  });

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Admin</div>
        <h1 className="text-2xl">Vehicle Approval</h1>
        <p className="mt-1.5 text-muted">Cross-check the ORCR against the owner's verified identity before approving.</p>
      </div>

      {reports && reports.length > 0 ? (
        <Card className="mb-5 p-5">
          <h3 className="mb-3 text-sm font-bold">Reported Listings ({reports.length})</h3>
          <div className="flex flex-col gap-2.5">
            {reports.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-md border border-warn bg-warn-soft p-3 text-sm">
                <div>
                  <strong>{r.vehicle.model.brand.name} {r.vehicle.model.name}</strong> — {r.reason}
                  <div className="text-xs text-muted">Reported by {r.reporter.first_name} {r.reporter.last_name}</div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const v = vehicles?.find((veh) => veh.id === r.vehicle_id);
                      if (v) openReview(v);
                    }}
                  >
                    Review Vehicle
                  </Button>
                  <Button size="sm" variant="ghost" disabled={dismissReport.isPending} onClick={() => dismissReport.mutate(r.id)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-[1.4fr_1fr] gap-5 items-start">
        <div className="rounded-2xl border border-line bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Plate</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {vehicles?.map((v) => (
                <tr key={v.id} className="border-t border-line text-[13.5px]">
                  <td className="px-4 py-3 font-bold">{v.model.brand.name} {v.model.name}</td>
                  <td className="px-4 py-3">{v.owner.first_name} {v.owner.last_name}</td>
                  <td className="tabular px-4 py-3">{v.plate_number}</td>
                  <td className="px-4 py-3">{statusPill(v)}</td>
                  <td className="px-4 py-3">
                    {v.approval_status === 'pending' ? (
                      <Button size="sm" variant="secondary" onClick={() => openReview(v)}>Review</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected ? (
          <Card className="sticky top-[76px] p-5">
            <h3 className="mb-3 text-sm font-bold">{selected.model.brand.name} {selected.model.name}</h3>
            <dl className="mb-4 grid grid-cols-2 gap-3 text-[13px]">
              <div><dt className="text-xs text-muted">Owner</dt><dd className="font-semibold">{selected.owner.first_name} {selected.owner.last_name} ({selected.owner.verified_status})</dd></div>
              <div><dt className="text-xs text-muted">Plate number</dt><dd className="tabular font-semibold">{selected.plate_number}</dd></div>
              <div><dt className="text-xs text-muted">Model year</dt><dd className="tabular font-semibold">{selected.model_year ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">Daily price</dt><dd className="tabular font-semibold">{formatCurrency(selected.daily_price)}</dd></div>
              <div><dt className="text-xs text-muted">Body / Seats / Fuel</dt><dd className="font-semibold">{selected.model.body_type} · {selected.model.seats} · {selected.model.fuel_type}</dd></div>
              <div><dt className="text-xs text-muted">Pickup location</dt><dd className="font-semibold">{selected.pickup_location}</dd></div>
            </dl>
            <p className="mb-2 text-xs text-muted">Name on ORCR should match the owner's verified name above.</p>
            {orcrUrl ? (
              <a href={orcrUrl} target="_blank" rel="noreferrer" className="mb-4 block rounded-md border border-line bg-surface-2 p-3 text-center text-xs font-semibold text-accent">
                📄 View ORCR document
              </a>
            ) : (
              <p className="mb-4 text-xs text-bad">No ORCR uploaded yet.</p>
            )}
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
                onClick={() => reject.mutate({ vehicleId: selected.id, reason: rejectReason })}
              >
                Reject
              </Button>
              <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(selected.id)}>
                Approve
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
