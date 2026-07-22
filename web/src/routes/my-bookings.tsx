import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookingStatusPill } from '@/components/ui/pill';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Booking, CarModel, CarBrand } from '@/lib/database.types';

type BookingRow = Booking & { vehicle: { plate_number: string; model: CarModel & { brand: CarBrand } } };

async function fetchMyBookings(renterId: string): Promise<BookingRow[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*, vehicle:vehicles(plate_number, model:car_models(*, brand:car_brands(*)))')
    .eq('renter_id', renterId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as any;
}

export function MyBookingsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const { data: bookings, isLoading } = useQuery({
    queryKey: ['bookings', 'mine', profile?.id],
    queryFn: () => fetchMyBookings(profile!.id),
    enabled: !!profile,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['bookings'] });

  const cancel = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc('cancel_booking', { p_booking_id: bookingId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const markComplete = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc('mark_complete', { p_booking_id: bookingId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  if (isLoading) return <p className="text-muted">Loading…</p>;

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Renter</div>
        <h1 className="text-2xl">My Bookings</h1>
        <p className="mt-1.5 text-muted">Track your rental requests from request to completion.</p>
      </div>

      <div className="flex flex-col gap-3.5">
        {bookings?.map((b) => (
          <Card key={b.id} className="flex gap-4 p-5">
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[14.5px] font-bold">
                    {b.vehicle.model.brand.name} {b.vehicle.model.name} · {b.vehicle.plate_number}
                  </div>
                  <div className="text-xs text-muted">
                    {formatDate(b.start_date)} – {formatDate(b.end_date)} · {b.total_days} days
                  </div>
                </div>
                <BookingStatusPill status={b.status} />
              </div>

              <div className="mt-3 flex gap-5 text-[12.5px]">
                <div><span className="text-muted">Total</span> <strong className="tabular">{formatCurrency(b.total_price)}</strong></div>
                {b.status === 'downpayment_paid' ? (
                  <div><span className="text-muted">Balance due</span> <strong className="tabular text-bad">{formatCurrency(b.balance_amount)}</strong></div>
                ) : null}
              </div>

              <div className="mt-3.5 flex gap-2">
                {b.status === 'pending_payment' ? (
                  <Button size="sm">Pay Downpayment</Button>
                ) : null}
                {b.status === 'downpayment_paid' ? (
                  <Button size="sm">Pay Balance</Button>
                ) : null}
                {['pending_owner', 'pending_payment', 'downpayment_paid', 'fully_paid'].includes(b.status) ? (
                  <Button variant="ghost" size="sm" onClick={() => cancel.mutate(b.id)}>
                    Cancel
                  </Button>
                ) : null}
                {b.status === 'active' ? (
                  <>
                    <Button variant="danger" size="sm">Report an Issue</Button>
                    <Button size="sm" onClick={() => markComplete.mutate(b.id)}>Mark Complete</Button>
                  </>
                ) : null}
                {b.status === 'completed' ? <Button variant="secondary" size="sm">★ Rate this rental</Button> : null}
              </div>
            </div>
          </Card>
        ))}

        {bookings?.length === 0 ? (
          <p className="py-16 text-center text-muted">No bookings yet — go find a car on Browse.</p>
        ) : null}
      </div>
    </div>
  );
}
