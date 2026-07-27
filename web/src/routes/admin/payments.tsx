import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { formatCurrency } from '@/lib/utils';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import type { Booking, CarBrand, CarModel, Profile } from '@/lib/database.types';

type CompletedBooking = Booking & {
  owner: Pick<Profile, 'first_name' | 'last_name' | 'payout_method' | 'bank_account_name' | 'bank_name' | 'bank_account_number' | 'gcash_number'>;
  renter: Pick<Profile, 'first_name' | 'last_name'>;
  vehicle: { model: CarModel & { brand: CarBrand } };
};

type CancelledBooking = Booking & {
  renter: Pick<Profile, 'first_name' | 'last_name'>;
  vehicle: { model: CarModel & { brand: CarBrand } };
};

function payoutDestination(owner: CompletedBooking['owner']) {
  if (owner.payout_method === 'gcash') {
    return owner.gcash_number ? `GCash ${owner.gcash_number}` : 'GCash — not set up';
  }
  if (owner.payout_method === 'bank_transfer') {
    return owner.bank_name && owner.bank_account_number
      ? `${owner.bank_name} •••${owner.bank_account_number.slice(-4)} (${owner.bank_account_name})`
      : 'Bank transfer — not set up';
  }
  return 'Not set up yet';
}

async function fetchDuePayments() {
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(
      `*, owner:profiles!bookings_owner_id_fkey(first_name, last_name, payout_method, bank_account_name, bank_name, bank_account_number, gcash_number),
       renter:profiles!bookings_renter_id_fkey(first_name, last_name),
       vehicle:vehicles(model:car_models(*, brand:car_brands(*)))`
    )
    .eq('status', 'completed')
    .order('updated_at', { ascending: true });
  if (error) throw error;

  const { data: payouts } = await supabase.from('payments').select('booking_id, status').eq('payment_type', 'payout');
  const paidOutIds = new Set((payouts ?? []).filter((p) => p.status === 'succeeded').map((p) => p.booking_id));
  const payoutInProgressIds = new Set((payouts ?? []).filter((p) => p.status === 'pending').map((p) => p.booking_id));

  const { data: pendingRefunds } = await supabase
    .from('payments')
    .select('booking_id')
    .eq('payment_type', 'refund')
    .eq('status', 'pending');
  const refundInProgressIds = new Set((pendingRefunds ?? []).map((p) => p.booking_id));

  const { data: openDisputes } = await supabase.from('disputes').select('booking_id').eq('status', 'open');
  const disputedIds = new Set((openDisputes ?? []).map((d) => d.booking_id));

  const all = bookings as CompletedBooking[];
  const depositEligible = all.filter((b) => b.deposit_paid && !b.deposit_refunded && !disputedIds.has(b.id));

  // Cancellation refunds -- cancel_booking() computes and inserts the owed
  // amount immediately at cancellation time (unlike deposit refunds, which
  // aren't recorded until an admin actually kicks one off), so "due" here
  // means a pending row that has never been sent to PayMongo at all yet
  // (paymongo_reference still null), separate from one already in flight.
  const { data: cancelledBookings, error: cancelledError } = await supabase
    .from('bookings')
    .select(
      `*, renter:profiles!bookings_renter_id_fkey(first_name, last_name),
       vehicle:vehicles(model:car_models(*, brand:car_brands(*)))`
    )
    .in('status', ['cancelled_by_renter', 'cancelled_by_owner'])
    .order('updated_at', { ascending: true });
  if (cancelledError) throw cancelledError;

  const cancelledIds = (cancelledBookings ?? []).map((b) => b.id);
  const { data: cancellationRefundPayments } =
    cancelledIds.length > 0
      ? await supabase.from('payments').select('booking_id, amount, status, paymongo_reference').eq('payment_type', 'refund').in('booking_id', cancelledIds)
      : { data: [] };
  const refundByBooking = new Map((cancellationRefundPayments ?? []).map((p) => [p.booking_id, p]));

  const cancellationRefundsDue = (cancelledBookings as CancelledBooking[] ?? []).filter((b) => {
    const p = refundByBooking.get(b.id);
    return p && p.status === 'pending' && !p.paymongo_reference && p.amount > 0;
  });
  const cancellationRefundsInProgress = (cancelledBookings as CancelledBooking[] ?? []).filter((b) => {
    const p = refundByBooking.get(b.id);
    return p && p.status === 'pending' && p.paymongo_reference;
  });

  return {
    payoutsDue: all.filter((b) => !paidOutIds.has(b.id) && !payoutInProgressIds.has(b.id) && !disputedIds.has(b.id)),
    payoutsInProgress: all.filter((b) => payoutInProgressIds.has(b.id)),
    depositRefundsDue: depositEligible.filter((b) => !refundInProgressIds.has(b.id)),
    depositRefundsInProgress: depositEligible.filter((b) => refundInProgressIds.has(b.id)),
    cancellationRefundsDue,
    cancellationRefundsInProgress,
    refundByBooking,
  };
}

export function AdminPaymentsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin-payments'], queryFn: fetchDuePayments });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-payments'] });

  const markSent = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc('mark_payout_sent', { p_booking_id: bookingId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const sendPayout = useMutation({
    mutationFn: async (bookingId: string) => {
      const { data, error } = await supabase.functions.invoke('process-payout', { body: { booking_id: bookingId } });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
  const sendRefund = useMutation({
    mutationFn: async (bookingId: string) => {
      const { data, error } = await supabase.functions.invoke('process-refund', { body: { booking_id: bookingId } });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
  const markRefundedManually = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc('mark_deposit_refunded', { p_booking_id: bookingId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const markCancellationRefundSent = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc('mark_cancellation_refund_sent', { p_booking_id: bookingId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Admin</div>
        <h1 className="text-2xl">Send Payments</h1>
        <p className="mt-1.5 text-muted">Completed bookings awaiting manual payout/refund via PayMongo.</p>
      </div>

      <h3 className="mb-2 text-sm font-bold">Owner payouts due</h3>
      {sendPayout.isError ? (
        <p className="mb-2 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad">{friendlyErrorMessage(sendPayout.error)}</p>
      ) : null}
      <div className="mb-6 rounded-2xl border border-line bg-surface">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
              <th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Payout to</th>
              <th className="px-4 py-3">Total price</th><th className="px-4 py-3">Commission</th>
              <th className="px-4 py-3">Net payout</th><th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data?.payoutsDue.map((b) => (
              <tr key={b.id} className="border-t border-line text-[13.5px]">
                <td className="px-4 py-3 font-bold">{b.vehicle.model.brand.name} {b.vehicle.model.name}</td>
                <td className="px-4 py-3">{b.owner.first_name} {b.owner.last_name}</td>
                <td className="px-4 py-3 text-xs">{payoutDestination(b.owner)}</td>
                <td className="tabular px-4 py-3">{formatCurrency(b.total_price)}</td>
                <td className="tabular px-4 py-3">{formatCurrency(b.commission)}</td>
                <td className="tabular px-4 py-3"><strong>{formatCurrency(b.base_price)}</strong></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      className="text-xs font-semibold text-muted underline hover:text-ink"
                      disabled={markSent.isPending}
                      onClick={() => confirm('Only use this if the payout was sent outside PayMongo.') && markSent.mutate(b.id)}
                    >
                      Mark as Sent
                    </button>
                    {b.owner.payout_method === 'gcash' ? (
                      <Button size="sm" disabled={sendPayout.isPending} onClick={() => sendPayout.mutate(b.id)}>
                        {sendPayout.isPending ? 'Sending…' : 'Send Payout via PayMongo'}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.payoutsDue.length === 0 ? <p className="p-6 text-center text-muted">Nothing due.</p> : null}
      </div>

      {data && data.payoutsInProgress.length > 0 ? (
        <>
          <h3 className="mb-2 text-sm font-bold">Payouts in progress</h3>
          <Card className="mb-6 p-0">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
                  <th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Net payout</th><th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.payoutsInProgress.map((b) => (
                  <tr key={b.id} className="border-t border-line text-[13.5px]">
                    <td className="px-4 py-3 font-bold">{b.vehicle.model.brand.name} {b.vehicle.model.name}</td>
                    <td className="px-4 py-3">{b.owner.first_name} {b.owner.last_name}</td>
                    <td className="tabular px-4 py-3">{formatCurrency(b.base_price)}</td>
                    <td className="px-4 py-3"><Pill tone="warn">Processing via PayMongo</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}

      <h3 className="mb-2 text-sm font-bold">Deposit refunds due</h3>
      {sendRefund.isError ? (
        <p className="mb-2 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad">{friendlyErrorMessage(sendRefund.error)}</p>
      ) : null}
      <Card className="mb-6 p-0">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
              <th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Renter</th>
              <th className="px-4 py-3">Deposit amount</th><th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data?.depositRefundsDue.map((b) => (
              <tr key={b.id} className="border-t border-line text-[13.5px]">
                <td className="px-4 py-3 font-bold">{b.vehicle.model.brand.name} {b.vehicle.model.name}</td>
                <td className="px-4 py-3">{b.renter.first_name} {b.renter.last_name}</td>
                <td className="tabular px-4 py-3">{formatCurrency(b.deposit_amount)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      className="text-xs font-semibold text-muted underline hover:text-ink"
                      disabled={markRefundedManually.isPending}
                      onClick={() => confirm('Only use this if the deposit was returned outside PayMongo.') && markRefundedManually.mutate(b.id)}
                    >
                      Mark manually refunded
                    </button>
                    <Button size="sm" disabled={sendRefund.isPending} onClick={() => sendRefund.mutate(b.id)}>
                      {sendRefund.isPending ? 'Sending…' : 'Send Refund via PayMongo'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.depositRefundsDue.length === 0 ? <p className="p-6 text-center text-muted">Nothing due.</p> : null}
      </Card>

      {data && data.depositRefundsInProgress.length > 0 ? (
        <>
          <h3 className="mb-2 text-sm font-bold">Refunds in progress</h3>
          <Card className="p-0">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
                  <th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Renter</th>
                  <th className="px-4 py-3">Deposit amount</th><th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.depositRefundsInProgress.map((b) => (
                  <tr key={b.id} className="border-t border-line text-[13.5px]">
                    <td className="px-4 py-3 font-bold">{b.vehicle.model.brand.name} {b.vehicle.model.name}</td>
                    <td className="px-4 py-3">{b.renter.first_name} {b.renter.last_name}</td>
                    <td className="tabular px-4 py-3">{formatCurrency(b.deposit_amount)}</td>
                    <td className="px-4 py-3"><Pill tone="warn">Processing via PayMongo</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}

      <h3 className="mb-2 mt-6 text-sm font-bold">Cancellation refunds due</h3>
      <p className="mb-2 text-xs text-muted">Owed to the renter when a booking was cancelled after money had already been paid.</p>
      <Card className="mb-6 p-0">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
              <th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Renter</th>
              <th className="px-4 py-3">Refund amount</th><th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data?.cancellationRefundsDue.map((b) => (
              <tr key={b.id} className="border-t border-line text-[13.5px]">
                <td className="px-4 py-3 font-bold">{b.vehicle.model.brand.name} {b.vehicle.model.name}</td>
                <td className="px-4 py-3">{b.renter.first_name} {b.renter.last_name}</td>
                <td className="tabular px-4 py-3">{formatCurrency(data.refundByBooking.get(b.id)?.amount ?? 0)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      className="text-xs font-semibold text-muted underline hover:text-ink"
                      disabled={markCancellationRefundSent.isPending}
                      onClick={() => confirm('Only use this if the refund was sent outside PayMongo.') && markCancellationRefundSent.mutate(b.id)}
                    >
                      Mark Sent Manually
                    </button>
                    <Button size="sm" disabled={sendRefund.isPending} onClick={() => sendRefund.mutate(b.id)}>
                      {sendRefund.isPending ? 'Sending…' : 'Send Refund via PayMongo'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.cancellationRefundsDue.length === 0 ? <p className="p-6 text-center text-muted">Nothing due.</p> : null}
      </Card>

      {data && data.cancellationRefundsInProgress.length > 0 ? (
        <>
          <h3 className="mb-2 text-sm font-bold">Cancellation refunds in progress</h3>
          <Card className="p-0">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
                  <th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Renter</th>
                  <th className="px-4 py-3">Refund amount</th><th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.cancellationRefundsInProgress.map((b) => (
                  <tr key={b.id} className="border-t border-line text-[13.5px]">
                    <td className="px-4 py-3 font-bold">{b.vehicle.model.brand.name} {b.vehicle.model.name}</td>
                    <td className="px-4 py-3">{b.renter.first_name} {b.renter.last_name}</td>
                    <td className="tabular px-4 py-3">{formatCurrency(data.refundByBooking.get(b.id)?.amount ?? 0)}</td>
                    <td className="px-4 py-3"><Pill tone="warn">Processing via PayMongo</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}
    </div>
  );
}
