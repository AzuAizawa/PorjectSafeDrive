import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookingStatusPill, RatingBadge } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { ConfirmDialog, useConfirmTarget } from '@/components/ui/confirm-dialog';
import { ReportIssueDialog } from '@/components/report-issue-dialog';
import { RateBookingDialog } from '@/components/rate-booking-dialog';
import { EmergencyBanner } from '@/components/emergency-banner';
import { BookingChat } from '@/components/booking-chat';
import { formatCurrency, formatDate } from '@/lib/utils';
import { previewCancellation } from '@/lib/cancellation';
import { signedUrl } from '@/lib/storage';
import { fetchRatingSummaries } from '@/lib/ratings';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import type { Booking, CarModel, CarBrand, Profile } from '@/lib/database.types';

type BookingRow = Booking & {
  vehicle: { plate_number: string; rental_agreement_path: string | null; model: CarModel & { brand: CarBrand } };
  owner: Pick<Profile, 'first_name' | 'last_name' | 'avatar_url'>;
};

async function fetchMyBookings(renterId: string): Promise<BookingRow[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select(
      `*, vehicle:vehicles(plate_number, rental_agreement_path, model:car_models(*, brand:car_brands(*))),
       owner:profiles!bookings_owner_id_fkey(first_name, last_name, avatar_url)`
    )
    .eq('renter_id', renterId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as any;
}

async function fetchCancellationSettings() {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('key, value')
    .in('key', ['free_cancel_hours', 'cancellation_fee_percent']);
  if (error) throw error;
  return Object.fromEntries(data.map((s) => [s.key, Number(s.value)])) as {
    free_cancel_hours: number;
    cancellation_fee_percent: number;
  };
}

async function fetchMyReviewedBookingIds(reviewerId: string) {
  const { data, error } = await supabase.from('reviews').select('booking_id').eq('reviewer_id', reviewerId);
  if (error) throw error;
  return new Set(data.map((r) => r.booking_id));
}

export function MyBookingsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const cancelDialog = useConfirmTarget<string>();
  const reportDialog = useConfirmTarget<string>();
  const rateDialog = useConfirmTarget<string>();
  const [chatOpenId, setChatOpenId] = useState<string | null>(null);

  const { data: bookings, isLoading } = useQuery({
    queryKey: ['bookings', 'mine', profile?.id],
    queryFn: () => fetchMyBookings(profile!.id),
    enabled: !!profile,
  });
  const { data: settings } = useQuery({ queryKey: ['cancellation-settings'], queryFn: fetchCancellationSettings });
  const { data: reviewedIds } = useQuery({
    queryKey: ['my-reviewed-bookings', profile?.id],
    queryFn: () => fetchMyReviewedBookingIds(profile!.id),
    enabled: !!profile,
  });
  const ownerIds = bookings?.map((b) => b.owner_id) ?? [];
  const { data: ownerRatings } = useQuery({
    queryKey: ['rating-summaries', 'owners', ownerIds],
    queryFn: () => fetchRatingSummaries(ownerIds),
    enabled: ownerIds.length > 0,
  });

  const [actionError, setActionError] = useState<string | null>(null);
  const invalidate = () => {
    setActionError(null);
    queryClient.invalidateQueries({ queryKey: ['bookings'] });
  };

  const cancel = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc('cancel_booking', { p_booking_id: bookingId });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      cancelDialog.close();
    },
    onError: (e) => setActionError(friendlyErrorMessage(e)),
  });
  const markComplete = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc('mark_complete', { p_booking_id: bookingId });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e) => setActionError(friendlyErrorMessage(e)),
  });

  const pay = useMutation({
    mutationFn: async (vars: { bookingId: string; paymentType: 'downpayment' | 'balance' }) => {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { booking_id: vars.bookingId, payment_type: vars.paymentType },
      });
      if (error) throw error;
      return data.checkout_url as string;
    },
    onSuccess: (checkoutUrl) => {
      window.location.href = checkoutUrl;
    },
  });

  if (isLoading) return <p className="text-muted">Loading…</p>;

  const targetBooking = bookings?.find((b) => b.id === cancelDialog.target);
  const preview = targetBooking && settings ? previewCancellation(targetBooking, settings) : null;
  const rateTargetBooking = bookings?.find((b) => b.id === rateDialog.target);

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Renter</div>
        <h1 className="text-2xl">My Bookings</h1>
        <p className="mt-1.5 text-muted">Track your rental requests from request to completion.</p>
      </div>

      {bookings?.some((b) => b.status === 'active') ? <EmergencyBanner /> : null}
      {actionError ? (
        <p className="mb-4 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad">{actionError}</p>
      ) : null}

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

              <div className="mt-2.5 flex items-center gap-2">
                <Avatar avatarPath={b.owner.avatar_url} firstName={b.owner.first_name} lastName={b.owner.last_name} size="sm" />
                <div className="text-[12.5px]">
                  <span className="text-muted">Owner</span> <strong>{b.owner.first_name} {b.owner.last_name}</strong>
                </div>
                {ownerRatings ? <RatingBadge {...(ownerRatings.get(b.owner_id) ?? { avg: 0, count: 0 })} /> : null}
              </div>

              <div className="mt-3 flex gap-5 text-[12.5px]">
                <div><span className="text-muted">Total</span> <strong className="tabular">{formatCurrency(b.total_price)}</strong></div>
                {b.status === 'downpayment_paid' ? (
                  <div><span className="text-muted">Balance due</span> <strong className="tabular text-bad">{formatCurrency(b.balance_amount)}</strong></div>
                ) : null}
              </div>

              <div className="mt-3.5 flex flex-wrap gap-2">
                {b.status === 'pending_payment' ? (
                  <Button
                    size="sm"
                    disabled={pay.isPending}
                    onClick={() => pay.mutate({ bookingId: b.id, paymentType: 'downpayment' })}
                  >
                    {pay.isPending && pay.variables?.bookingId === b.id ? 'Redirecting…' : 'Pay Downpayment'}
                  </Button>
                ) : null}
                {b.status === 'downpayment_paid' ? (
                  <Button
                    size="sm"
                    disabled={pay.isPending}
                    onClick={() => pay.mutate({ bookingId: b.id, paymentType: 'balance' })}
                  >
                    {pay.isPending && pay.variables?.bookingId === b.id ? 'Redirecting…' : 'Pay Balance'}
                  </Button>
                ) : null}
                {['pending_owner', 'pending_payment', 'downpayment_paid', 'fully_paid'].includes(b.status) ? (
                  <Button variant="ghost" size="sm" onClick={() => cancelDialog.open(b.id)}>
                    Cancel
                  </Button>
                ) : null}
                {b.status === 'active' ? (
                  <>
                    <Button variant="danger" size="sm" onClick={() => reportDialog.open(b.id)}>Report an Issue</Button>
                    <Button size="sm" onClick={() => markComplete.mutate(b.id)}>Mark Complete</Button>
                  </>
                ) : null}
                {b.status === 'completed' ? (
                  reviewedIds?.has(b.id) ? (
                    <span className="self-center text-xs font-semibold text-muted">★ Rated — thanks!</span>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => rateDialog.open(b.id)}>★ Rate this rental</Button>
                  )
                ) : null}
                {b.vehicle.rental_agreement_path && ['active', 'fully_paid', 'completed'].includes(b.status) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      const url = await signedUrl('vehicle-documents', b.vehicle.rental_agreement_path!);
                      window.open(url, '_blank');
                    }}
                  >
                    ⬇ Rental agreement
                  </Button>
                ) : null}
                {!['pending_owner', 'owner_rejected', 'expired'].includes(b.status) ? (
                  <Button variant="ghost" size="sm" onClick={() => setChatOpenId(chatOpenId === b.id ? null : b.id)}>
                    💬 {chatOpenId === b.id ? 'Hide Chat' : 'Message Owner'}
                  </Button>
                ) : null}
              </div>
              {pay.isError && pay.variables?.bookingId === b.id ? (
                <p className="mt-2 text-xs text-bad">{friendlyErrorMessage(pay.error)}</p>
              ) : null}
              {chatOpenId === b.id && profile ? <BookingChat bookingId={b.id} currentUserId={profile.id} /> : null}
            </div>
          </Card>
        ))}

        {bookings?.length === 0 ? (
          <p className="py-16 text-center text-muted">No bookings yet — go find a car on Browse.</p>
        ) : null}
      </div>

      <ConfirmDialog
        open={!!cancelDialog.target}
        title="Cancel this booking?"
        description={preview?.message ?? 'Loading…'}
        confirmLabel="Cancel Booking"
        confirmVariant="danger"
        pending={cancel.isPending}
        onConfirm={() => cancelDialog.target && cancel.mutate(cancelDialog.target)}
        onCancel={cancelDialog.close}
        error={cancel.isError ? friendlyErrorMessage(cancel.error) : null}
      />

      <ReportIssueDialog
        bookingId={reportDialog.target}
        onClose={reportDialog.close}
        onSubmitted={reportDialog.close}
      />

      <RateBookingDialog
        target={rateTargetBooking ? { bookingId: rateTargetBooking.id, revieweeId: rateTargetBooking.owner_id } : null}
        onClose={rateDialog.close}
        onSubmitted={() => {
          queryClient.invalidateQueries({ queryKey: ['my-reviewed-bookings'] });
          rateDialog.close();
        }}
      />
    </div>
  );
}
