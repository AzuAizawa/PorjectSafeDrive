import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';
import type { Booking, CarBrand, CarModel, Profile } from '@/lib/database.types';

type CompletedBooking = Booking & {
  owner: Pick<Profile, 'first_name' | 'last_name'>;
  renter: Pick<Profile, 'first_name' | 'last_name'>;
  vehicle: { model: CarModel & { brand: CarBrand } };
};

async function fetchDuePayments() {
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(
      `*, owner:profiles!bookings_owner_id_fkey(first_name, last_name), renter:profiles!bookings_renter_id_fkey(first_name, last_name),
       vehicle:vehicles(model:car_models(*, brand:car_brands(*)))`
    )
    .eq('status', 'completed')
    .order('updated_at', { ascending: true });
  if (error) throw error;

  const { data: payouts } = await supabase.from('payments').select('booking_id').eq('payment_type', 'payout');
  const paidOutIds = new Set((payouts ?? []).map((p) => p.booking_id));

  const { data: openDisputes } = await supabase.from('disputes').select('booking_id').eq('status', 'open');
  const disputedIds = new Set((openDisputes ?? []).map((d) => d.booking_id));

  const all = bookings as CompletedBooking[];
  return {
    payoutsDue: all.filter((b) => !paidOutIds.has(b.id) && !disputedIds.has(b.id)),
    depositRefundsDue: all.filter((b) => b.deposit_paid && !b.deposit_refunded && !disputedIds.has(b.id)),
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
  const markRefunded = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc('mark_deposit_refunded', { p_booking_id: bookingId });
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
      <div className="mb-6 rounded-2xl border border-line bg-surface">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-2">
              <th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Total price</th><th className="px-4 py-3">Commission</th>
              <th className="px-4 py-3">Net payout</th><th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data?.payoutsDue.map((b) => (
              <tr key={b.id} className="border-t border-line text-[13.5px]">
                <td className="px-4 py-3 font-bold">{b.vehicle.model.brand.name} {b.vehicle.model.name}</td>
                <td className="px-4 py-3">{b.owner.first_name} {b.owner.last_name}</td>
                <td className="tabular px-4 py-3">{formatCurrency(b.total_price)}</td>
                <td className="tabular px-4 py-3">{formatCurrency(b.commission)}</td>
                <td className="tabular px-4 py-3"><strong>{formatCurrency(b.base_price)}</strong></td>
                <td className="px-4 py-3">
                  <Button size="sm" disabled={markSent.isPending} onClick={() => markSent.mutate(b.id)}>Mark as Sent</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.payoutsDue.length === 0 ? <p className="p-6 text-center text-muted">Nothing due.</p> : null}
      </div>

      <h3 className="mb-2 text-sm font-bold">Deposit refunds due</h3>
      <Card className="p-0">
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
                  <Button size="sm" disabled={markRefunded.isPending} onClick={() => markRefunded.mutate(b.id)}>Mark Refunded</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.depositRefundsDue.length === 0 ? <p className="p-6 text-center text-muted">Nothing due.</p> : null}
      </Card>
    </div>
  );
}
