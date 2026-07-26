import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { signedUrl } from '@/lib/storage';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { ConfirmDialog, useConfirmTarget } from '@/components/ui/confirm-dialog';
import { MultiSelectDropdown } from '@/components/ui/multi-select-dropdown';
import { formatCurrency } from '@/lib/utils';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import { publicUrl } from '@/lib/storage';
import { orcrExpiryStatus } from '@/lib/vehicle-expiry';
import type { CarBrand, CarModel, ListingReport, Profile, Vehicle } from '@/lib/database.types';

const APPROVAL_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

type VehicleRow = Vehicle & {
  model: CarModel & { brand: CarBrand };
  owner: Pick<Profile, 'first_name' | 'last_name' | 'verified_status'>;
  vehicle_images: { storage_path: string; sort_order: number }[];
};
type ReportRow = ListingReport & {
  vehicle: { model: CarModel & { brand: CarBrand } };
  reporter: Pick<Profile, 'first_name' | 'last_name'>;
};

async function fetchVehicles() {
  const { data, error } = await supabase
    .from('vehicles')
    .select(
      `*, model:car_models(*, brand:car_brands(*)), owner:profiles(first_name, last_name, verified_status),
       vehicle_images(storage_path, sort_order)`
    )
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<VehicleRow | null>(null);
  const [orcrUrl, setOrcrUrl] = useState<string | null>(null);
  const rejectDialog = useConfirmTarget<string>();
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [approvalFilter, setApprovalFilter] = useState<string[]>([]);
  const [notesDraft, setNotesDraft] = useState('');

  const { data: vehicles } = useQuery({ queryKey: ['admin-vehicles'], queryFn: fetchVehicles });
  const { data: reports } = useQuery({ queryKey: ['admin-listing-reports'], queryFn: fetchOpenReports });

  const filteredVehicles = useMemo(() => {
    if (!vehicles) return [];
    const q = search.toLowerCase();
    return vehicles.filter((v) => {
      const haystack = `${v.model.brand.name} ${v.model.name} ${v.owner.first_name ?? ''} ${v.owner.last_name ?? ''} ${v.plate_number}`.toLowerCase();
      const matchesQ = !q || haystack.includes(q);
      const matchesApproval = approvalFilter.length === 0 || approvalFilter.includes(v.approval_status);
      return matchesQ && matchesApproval;
    });
  }, [vehicles, search, approvalFilter]);

  async function openReview(v: VehicleRow) {
    setSelected(v);
    setOrcrUrl(v.orcr_path ? await signedUrl('vehicle-documents', v.orcr_path) : null);
    setNotesDraft(v.admin_notes ?? '');
  }

  // Deep-link support so a "Review" button elsewhere (e.g. Admin Users'
  // vehicles-owned subsection) can land straight on a specific vehicle
  // instead of just the general list.
  useEffect(() => {
    const vehicleId = searchParams.get('vehicle');
    if (!vehicleId || !vehicles) return;
    const match = vehicles.find((v) => v.id === vehicleId);
    if (match) openReview(match);
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, vehicles]);

  const invalidate = () => {
    setActionError(null);
    queryClient.invalidateQueries({ queryKey: ['admin-vehicles'] });
    setSelected(null);
  };

  const approve = useMutation({
    mutationFn: async (vehicleId: string) => {
      const { error } = await supabase.rpc('approve_vehicle', { p_vehicle_id: vehicleId });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e) => setActionError(friendlyErrorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: async (vars: { vehicleId: string; reason: string }) => {
      const { error } = await supabase.rpc('reject_vehicle', { p_vehicle_id: vars.vehicleId, p_reason: vars.reason });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      rejectDialog.close();
    },
  });
  const dismissReport = useMutation({
    mutationFn: async (reportId: string) => {
      const { error } = await supabase.rpc('resolve_listing_report', { p_report_id: reportId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-listing-reports'] }),
    onError: (e) => setActionError(friendlyErrorMessage(e)),
  });
  const saveNotes = useMutation({
    mutationFn: async (notes: string) => {
      const { error } = await supabase.from('vehicles').update({ admin_notes: notes || null }).eq('id', selected!.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-vehicles'] }),
    onError: (e) => setActionError(friendlyErrorMessage(e)),
  });

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Admin</div>
        <h1 className="text-2xl">Vehicle Approval</h1>
        <p className="mt-1.5 text-muted">Cross-check the ORCR against the owner's verified identity before approving.</p>
      </div>

      {actionError ? (
        <p className="mb-4 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad">{actionError}</p>
      ) : null}

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

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <input
          className="input-base min-w-[220px] flex-1"
          placeholder="Search by vehicle, owner, or plate…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <MultiSelectDropdown label="Status" options={APPROVAL_OPTIONS} selected={approvalFilter} onChange={setApprovalFilter} />
      </div>

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
              {filteredVehicles.map((v) => (
                <tr key={v.id} className="border-t border-line text-[13.5px]">
                  <td className="px-4 py-3 font-bold">{v.model.brand.name} {v.model.name}</td>
                  <td className="px-4 py-3">{v.owner.first_name} {v.owner.last_name}</td>
                  <td className="tabular px-4 py-3">{v.plate_number}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {statusPill(v)}
                      {orcrExpiryStatus(v.orcr_expiry_date).tone !== 'good' && orcrExpiryStatus(v.orcr_expiry_date).tone !== 'muted' ? (
                        <Pill tone={orcrExpiryStatus(v.orcr_expiry_date).tone}>{orcrExpiryStatus(v.orcr_expiry_date).label}</Pill>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="secondary" onClick={() => openReview(v)}>
                      {v.approval_status === 'pending' ? 'Review' : 'View'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {vehicles && filteredVehicles.length === 0 ? (
            <p className="p-4 text-sm text-muted">No vehicles match your search/filters.</p>
          ) : null}
        </div>

        {selected ? (
          <Card className="sticky top-[76px] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold">{selected.model.brand.name} {selected.model.name}</h3>
              {statusPill(selected)}
            </div>

            {selected.vehicle_images.length > 0 ? (
              <div className="mb-4 grid grid-cols-4 gap-2">
                {[...selected.vehicle_images]
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((img) => (
                    <a key={img.storage_path} href={publicUrl('car-images', img.storage_path) ?? undefined} target="_blank" rel="noreferrer">
                      <img
                        src={publicUrl('car-images', img.storage_path) ?? undefined}
                        alt={`${selected.model.name} photo`}
                        className="h-16 w-full rounded-md border border-line object-cover"
                      />
                    </a>
                  ))}
              </div>
            ) : (
              <p className="mb-4 text-xs text-bad">No photos uploaded.</p>
            )}

            <dl className="mb-4 grid grid-cols-2 gap-3 text-[13px]">
              <div><dt className="text-xs text-muted">Owner</dt><dd className="font-semibold">{selected.owner.first_name} {selected.owner.last_name} ({selected.owner.verified_status})</dd></div>
              <div><dt className="text-xs text-muted">Plate number</dt><dd className="tabular font-semibold">{selected.plate_number}</dd></div>
              <div><dt className="text-xs text-muted">Model year</dt><dd className="tabular font-semibold">{selected.model_year ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">Daily price</dt><dd className="tabular font-semibold">{formatCurrency(selected.daily_price)}</dd></div>
              <div><dt className="text-xs text-muted">Body / Seats / Fuel</dt><dd className="font-semibold">{selected.model.body_type} · {selected.model.seats} · {selected.model.fuel_type}</dd></div>
              <div><dt className="text-xs text-muted">Pickup location</dt><dd className="font-semibold">{selected.pickup_location}</dd></div>
            </dl>
            <div className="mb-3">
              <Pill tone={orcrExpiryStatus(selected.orcr_expiry_date).tone}>{orcrExpiryStatus(selected.orcr_expiry_date).label}</Pill>
            </div>
            <p className="mb-2 text-xs text-muted">Name on ORCR should match the owner's verified name above.</p>
            {orcrUrl ? (
              <a href={orcrUrl} target="_blank" rel="noreferrer" className="mb-4 block rounded-md border border-line bg-surface-2 p-3 text-center text-xs font-semibold text-accent">
                📄 View ORCR document
              </a>
            ) : (
              <p className="mb-4 text-xs text-bad">No ORCR uploaded yet.</p>
            )}
            {selected.approval_status === 'pending' ? (
              <div className="flex justify-end gap-2">
                <Button variant="danger" size="sm" onClick={() => rejectDialog.open(selected.id)}>
                  Reject
                </Button>
                <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(selected.id)}>
                  Approve
                </Button>
              </div>
            ) : selected.rejection_reason ? (
              <p className="text-xs text-muted">Rejected: {selected.rejection_reason}</p>
            ) : null}

            <div className="mt-4 border-t border-line pt-4">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Internal Notes</h4>
              <p className="mb-2 text-xs text-muted">Visible to admin/support only — never shown to the owner.</p>
              <textarea
                className="input-base h-20 w-full resize-none py-2"
                placeholder="e.g. owner disputes ORCR delay, called them"
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
              />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={saveNotes.isPending || notesDraft === (selected.admin_notes ?? '')}
                  onClick={() => saveNotes.mutate(notesDraft)}
                >
                  {saveNotes.isPending ? 'Saving…' : 'Save Note'}
                </Button>
              </div>
            </div>
          </Card>
        ) : null}
      </div>

      <ConfirmDialog
        open={!!rejectDialog.target}
        title="Reject this vehicle listing?"
        description="The owner will see this reason on My Vehicles and in their notification, so they know exactly what to fix before resubmitting."
        requireReason
        reasonPlaceholder="e.g. ORCR name doesn't match the owner's verified identity"
        confirmLabel="Reject"
        confirmVariant="danger"
        pending={reject.isPending}
        onConfirm={(reason) => rejectDialog.target && reject.mutate({ vehicleId: rejectDialog.target, reason: reason! })}
        onCancel={rejectDialog.close}
        error={reject.isError ? friendlyErrorMessage(reject.error) : null}
      />
    </div>
  );
}
