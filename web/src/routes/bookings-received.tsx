import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookingStatusPill, RatingBadge } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { ConfirmDialog, useConfirmTarget } from '@/components/ui/confirm-dialog';
import { RateBookingDialog } from '@/components/rate-booking-dialog';
import { EmergencyBanner } from '@/components/emergency-banner';
import { BookingChat } from '@/components/booking-chat';
import { formatCurrency, formatDate } from '@/lib/utils';
import { fetchRatingSummaries } from '@/lib/ratings';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import type { Booking, CarModel, CarBrand, Profile } from '@/lib/database.types';

type BookingRow = Booking & {
  vehicle: { plate_number: string; model: CarModel & { brand: CarBrand } };
  renter: Pick<Profile, 'first_name' | 'last_name' | 'phone' | 'address' | 'birthday' | 'verified_status' | 'avatar_url'>;
};

async function fetchBookingsReceived(ownerId: string): Promise<BookingRow[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select(
      `*, vehicle:vehicles(plate_number, model:car_models(*, brand:car_brands(*))),
       renter:profiles!bookings_renter_id_fkey(first_name, last_name, phone, address, birthday, verified_status, avatar_url)`
    )
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as any;
}

async function fetchMyReviewedBookingIds(reviewerId: string) {
  const { data, error } = await supabase.from('reviews').select('booking_id').eq('reviewer_id', reviewerId);
  if (error) throw error;
  return new Set(data.map((r) => r.booking_id));
}

export function BookingsReceivedPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const declineDialog = useConfirmTarget<string>();
  const noShowDialog = useConfirmTarget<string>();
  const rateDialog = useConfirmTarget<string>();
  const [chatOpenId, setChatOpenId] = useState<string | null>(null);

  const { data: bookings, isLoading } = useQuery({
    queryKey: ['bookings', 'received', profile?.id],
    queryFn: () => fetchBookingsReceived(profile!.id),
    enabled: !!profile,
  });
  const { data: reviewedIds } = useQuery({
    queryKey: ['my-reviewed-bookings', profile?.id],
    queryFn: () => fetchMyReviewedBookingIds(profile!.id),
    enabled: !!profile,
  });
  const renterIds = bookings?.map((b) => b.renter_id) ?? [];
  const { data: renterRatings } = useQuery({
    queryKey: ['rating-summaries', 'renters', renterIds],
    queryFn: () => fetchRatingSummaries(renterIds),
    enabled: renterIds.length > 0,
  });

  const [actionError, setActionError] = useState<string | null>(null);
  const invalidate = () => {
    setActionError(null);
    queryClient.invalidateQueries({ queryKey: ['bookings'] });
  };

  function useRpcMutation(fn: string) {
    return useMutation({
      mutationFn: async (bookingId: string) => {
        const { error } = await supabase.rpc(fn, { p_booking_id: bookingId });
        if (error) throw error;
      },
      onSuccess: invalidate,
      onError: (e) => setActionError(friendlyErrorMessage(e)),
    });
  }

  const accept = useRpcMutation('accept_booking');
  const confirmHandover = useRpcMutation('confirm_handover');
  const markComplete = useRpcMutation('mark_complete');

  const reject = useMutation({
    mutationFn: async (vars: { bookingId: string; reason: string }) => {
      const { error } = await supabase.rpc('reject_booking', { p_booking_id: vars.bookingId, p_reason: vars.reason });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      declineDialog.close();
    },
    onError: (e) => setActionError(friendlyErrorMessage(e)),
  });

  const cancelNoShow = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc('cancel_no_show', { p_booking_id: bookingId });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      noShowDialog.close();
    },
    onError: (e) => setActionError(friendlyErrorMessage(e)),
  });

  if (isLoading) return <p className="text-muted">Loading…</p>;

  const rateTargetBooking = bookings?.find((b) => b.id === rateDialog.target);

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Lister</div>
        <h1 className="text-2xl">Bookings Received</h1>
        <p className="mt-1.5 text-muted">Requests and active rentals for your vehicles.</p>
      </div>

      {bookings?.some((b) => b.status === 'active') ? <EmergencyBanner /> : null}
      {actionError ? (
        <p className="mb-4 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad">{actionError}</p>
      ) : null}

      <div className="flex flex-col gap-3.5">
        {bookings?.map((b) => (
          <Card key={b.id} className="p-5">
            <div className="flex items-start justify-between">
              <div className="flex gap-3">
                <Avatar avatarPath={b.renter.avatar_url} firstName={b.renter.first_name} lastName={b.renter.last_name} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[14.5px] font-bold">{b.renter.first_name} {b.renter.last_name}</span>
                    {renterRatings ? <RatingBadge {...(renterRatings.get(b.renter_id) ?? { avg: 0, count: 0 })} /> : null}
                  </div>
                  <div className="text-xs text-muted">
                    {b.renter.verified_status === 'verified' ? 'Verified' : 'Not verified'} · Born{' '}
                    {b.renter.birthday ? formatDate(b.renter.birthday) : '—'} · {b.renter.address}
                  </div>
                  <div className="text-xs text-muted">
                    {b.vehicle.model.brand.name} {b.vehicle.model.name} · {b.vehicle.plate_number} ·{' '}
                    {formatDate(b.start_date)}–{formatDate(b.end_date)}
                  </div>
                </div>
              </div>
              <BookingStatusPill status={b.status} />
            </div>

            <div className="mt-3 flex gap-5 text-[12.5px]">
              <div><span className="text-muted">Total price</span> <strong className="tabular">{formatCurrency(b.total_price)}</strong></div>
              {b.status === 'downpayment_paid' ? (
                <div><span className="text-muted">Balance owed</span> <strong className="tabular text-bad">{formatCurrency(b.balance_amount)}</strong></div>
              ) : null}
            </div>

            {b.status === 'downpayment_paid' ? (
              <p className="mt-2 text-xs text-muted">Handover is locked until the balance shows as paid.</p>
            ) : null}

            <div className="mt-3.5 flex items-center gap-2">
              {b.status === 'pending_owner' ? (
                <>
                  <Button size="sm" onClick={() => accept.mutate(b.id)}>Accept</Button>
                  <Button variant="danger" size="sm" onClick={() => declineDialog.open(b.id)}>Decline</Button>
                </>
              ) : null}
              {b.status === 'downpayment_paid' ? (
                <>
                  <Button size="sm" disabled title="Balance must be paid before handover can be confirmed">
                    Confirm Handover
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => noShowDialog.open(b.id)}>
                    Cancel — Unpaid at Meetup
                  </Button>
                </>
              ) : null}
              {b.status === 'fully_paid' ? (
                <Button size="sm" onClick={() => confirmHandover.mutate(b.id)}>Confirm Handover</Button>
              ) : null}
              {b.status === 'active' ? (
                <Button size="sm" onClick={() => markComplete.mutate(b.id)}>Mark Complete</Button>
              ) : null}
              {b.status === 'completed' ? (
                reviewedIds?.has(b.id) ? (
                  <span className="text-xs font-semibold text-muted">★ Rated — thanks!</span>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => rateDialog.open(b.id)}>★ Rate this renter</Button>
                )
              ) : null}
              {!['pending_owner', 'owner_rejected', 'expired'].includes(b.status) ? (
                <Button variant="ghost" size="sm" onClick={() => setChatOpenId(chatOpenId === b.id ? null : b.id)}>
                  💬 {chatOpenId === b.id ? 'Hide Chat' : 'Message Renter'}
                </Button>
              ) : null}
            </div>
            {chatOpenId === b.id && profile ? <BookingChat bookingId={b.id} currentUserId={profile.id} /> : null}
          </Card>
        ))}

        {bookings?.length === 0 ? <p className="py-16 text-center text-muted">No booking requests yet.</p> : null}
      </div>

      <ConfirmDialog
        open={!!declineDialog.target}
        title="Decline this booking request?"
        description="The renter will see your reason and won't be charged anything."
        requireReason
        reasonPlaceholder="e.g. Car isn't available those dates"
        confirmLabel="Decline"
        confirmVariant="danger"
        pending={reject.isPending}
        onConfirm={(reason) => declineDialog.target && reject.mutate({ bookingId: declineDialog.target, reason: reason! })}
        onCancel={declineDialog.close}
        error={reject.isError ? friendlyErrorMessage(reject.error) : null}
      />

      <ConfirmDialog
        open={!!noShowDialog.target}
        title="Cancel this booking?"
        description="The renter didn't pay the balance before the meetup — they'll forfeit part of the downpayment as a cancellation fee and receive a strike."
        confirmLabel="Cancel Booking"
        confirmVariant="danger"
        pending={cancelNoShow.isPending}
        onConfirm={() => noShowDialog.target && cancelNoShow.mutate(noShowDialog.target)}
        onCancel={noShowDialog.close}
        error={cancelNoShow.isError ? friendlyErrorMessage(cancelNoShow.error) : null}
      />

      <RateBookingDialog
        target={rateTargetBooking ? { bookingId: rateTargetBooking.id, revieweeId: rateTargetBooking.renter_id } : null}
        onClose={rateDialog.close}
        onSubmitted={() => {
          queryClient.invalidateQueries({ queryKey: ['my-reviewed-bookings'] });
          rateDialog.close();
        }}
      />
    </div>
  );
}
