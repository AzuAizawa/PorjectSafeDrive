import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, CalendarClock, History } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookingStatusPill, Pill, RatingBadge } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { ContactInfoButton } from '@/components/contact-info-button';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog, useConfirmTarget } from '@/components/ui/confirm-dialog';
import { RateBookingDialog } from '@/components/rate-booking-dialog';
import { EmergencyBanner } from '@/components/emergency-banner';
import { BookingChat } from '@/components/booking-chat';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { fetchRatingSummaries } from '@/lib/ratings';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import { formatTime, pickupTimestamp, useNoShowGraceMinutes } from '@/lib/pickup';
import { isHistoryStatus, isBookingAccepted } from '@/lib/booking-status';
import { PAYMENT_TYPE_LABEL, paymentStatusLabel, paymentStatusTone } from '@/lib/payment-display';
import type { Booking, CarModel, CarBrand, Profile, Payment, Dispute } from '@/lib/database.types';

type BookingRow = Booking & {
  vehicle: { plate_number: string; model: CarModel & { brand: CarBrand } };
  renter: Pick<Profile, 'first_name' | 'last_name' | 'verified_status' | 'avatar_url'>;
};

// Deliberately not selecting phone/address/birthday here — those are only
// shared once the owner accepts, and only name+phone, via
// get_booking_counterpart_contact() (057_booking_counterpart_contact.sql).
// This used to select all three unconditionally on every request
// regardless of status, which was a real over-exposure this fixes.
async function fetchBookingsReceived(ownerId: string): Promise<BookingRow[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select(
      `*, vehicle:vehicles(plate_number, model:car_models(*, brand:car_brands(*))),
       renter:profiles!bookings_renter_id_fkey(first_name, last_name, verified_status, avatar_url)`
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

async function fetchDisputesForBookings(bookingIds: string[]) {
  if (bookingIds.length === 0) return [];
  const { data, error } = await supabase.from('disputes').select('*').in('booking_id', bookingIds);
  if (error) throw error;
  return data as Dispute[];
}

// payer_id on a 'payout' row is the owner, not a renter (003_functions.sql) —
// so filtering payments by payer_id = this owner's id naturally returns only
// their own payouts, nothing about the renter's downpayment/balance/deposit,
// with no extra filtering needed. That's also the right privacy boundary:
// an owner has no reason to see a renter's deposit/refund detail.
async function fetchMyPayouts(ownerId: string) {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('payer_id', ownerId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data as Payment[];
}

export function BookingsReceivedPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const declineDialog = useConfirmTarget<string>();
  const noShowDialog = useConfirmTarget<string>();
  const rateDialog = useConfirmTarget<string>();
  const acceptDialog = useConfirmTarget<string>();
  const handoverDialog = useConfirmTarget<string>();
  const completeDialog = useConfirmTarget<string>();
  const [chatOpenId, setChatOpenId] = useState<string | null>(null);
  const [payoutsOpenId, setPayoutsOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'history'>('active');

  const { data: bookings, isLoading } = useQuery({
    queryKey: ['bookings', 'received', profile?.id],
    queryFn: () => fetchBookingsReceived(profile!.id),
    enabled: !!profile,
  });
  const { data: payouts } = useQuery({
    queryKey: ['payouts', 'mine', profile?.id],
    queryFn: () => fetchMyPayouts(profile!.id),
    enabled: !!profile,
  });
  const payoutsByBooking = useMemo(() => {
    const map = new Map<string, Payment[]>();
    for (const p of payouts ?? []) {
      if (!p.booking_id) continue;
      if (!map.has(p.booking_id)) map.set(p.booking_id, []);
      map.get(p.booking_id)!.push(p);
    }
    return map;
  }, [payouts]);
  const bookingIds = useMemo(() => bookings?.map((b) => b.id) ?? [], [bookings]);
  const { data: disputes } = useQuery({
    queryKey: ['disputes', 'received', bookingIds],
    queryFn: () => fetchDisputesForBookings(bookingIds),
    enabled: bookingIds.length > 0,
  });
  const disputeByBooking = useMemo(() => {
    const map = new Map<string, Dispute>();
    for (const d of disputes ?? []) map.set(d.booking_id, d);
    return map;
  }, [disputes]);
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
  const { data: graceMinutes } = useNoShowGraceMinutes();

  const [actionError, setActionError] = useState<string | null>(null);
  const invalidate = () => {
    setActionError(null);
    queryClient.invalidateQueries({ queryKey: ['bookings'] });
  };

  function useRpcMutation(fn: string, onDone?: () => void) {
    return useMutation({
      mutationFn: async (bookingId: string) => {
        const { error } = await supabase.rpc(fn, { p_booking_id: bookingId });
        if (error) throw error;
      },
      onSuccess: () => {
        invalidate();
        onDone?.();
      },
      onError: (e) => setActionError(friendlyErrorMessage(e)),
    });
  }

  const accept = useRpcMutation('accept_booking', acceptDialog.close);
  const confirmHandover = useRpcMutation('confirm_handover', handoverDialog.close);
  const markComplete = useRpcMutation('mark_complete', completeDialog.close);

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
  const visibleBookings = bookings?.filter((b) => (tab === 'history' ? isHistoryStatus(b.status) : !isHistoryStatus(b.status)));
  const historyCount = bookings?.filter((b) => isHistoryStatus(b.status)).length ?? 0;
  const activeCount = bookings ? bookings.length - historyCount : 0;

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

      <div className="mb-4 flex gap-1 border-b border-line">
        {(['active', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-semibold',
              tab === t ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'
            )}
          >
            {t === 'active' ? `Active (${activeCount})` : `History (${historyCount})`}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3.5">
        {visibleBookings?.map((b) => (
          <Card key={b.id} className="p-5">
            <div className="flex items-start justify-between">
              <div className="flex gap-3">
                {isBookingAccepted(b.status) ? (
                  <ContactInfoButton
                    bookingId={b.id}
                    avatarPath={b.renter.avatar_url}
                    firstName={b.renter.first_name}
                    lastName={b.renter.last_name}
                  />
                ) : (
                  <Avatar avatarPath={b.renter.avatar_url} firstName={b.renter.first_name} lastName={b.renter.last_name} />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[14.5px] font-bold">{b.renter.first_name} {b.renter.last_name}</span>
                    {renterRatings ? <RatingBadge {...(renterRatings.get(b.renter_id) ?? { avg: 0, count: 0 })} /> : null}
                  </div>
                  <div className="text-xs text-muted">
                    {b.renter.verified_status === 'verified' ? 'Verified' : 'Not verified'}
                  </div>
                  <div className="text-xs text-muted">
                    {b.vehicle.model.brand.name} {b.vehicle.model.name} · {b.vehicle.plate_number} ·{' '}
                    {formatDate(b.start_date)}–{formatDate(b.end_date)} · Pickup {formatTime(b.pickup_time)}
                  </div>
                </div>
              </div>
              <BookingStatusPill status={b.status} />
            </div>

            {b.cancellation_reason ? (
              <p className="mt-1.5 text-xs text-muted">Reason: {b.cancellation_reason}</p>
            ) : null}
            {disputeByBooking.has(b.id) ? (() => {
              const d = disputeByBooking.get(b.id)!;
              return d.status === 'open' ? (
                <p className="mt-1.5 text-xs font-semibold text-warn">🚩 A reported issue on this booking is under review.</p>
              ) : (
                <p className="mt-1.5 text-xs text-good">✓ Issue resolved: {d.resolution_notes}</p>
              );
            })() : null}

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
                  <Button size="sm" onClick={() => acceptDialog.open(b.id)}>Accept</Button>
                  <Button variant="danger" size="sm" onClick={() => declineDialog.open(b.id)}>Decline</Button>
                </>
              ) : null}
              {b.status === 'downpayment_paid' || b.status === 'fully_paid' ? (() => {
                const graceOver = graceMinutes != null && Date.now() >= pickupTimestamp(b.start_date, b.pickup_time) + graceMinutes * 60_000;
                return (
                  <>
                    {b.status === 'fully_paid' ? (
                      <Button size="sm" onClick={() => handoverDialog.open(b.id)}>Confirm Handover</Button>
                    ) : (
                      <Button size="sm" disabled title="Balance must be paid before handover can be confirmed">
                        Confirm Handover
                      </Button>
                    )}
                    {graceOver ? (
                      <Button variant="danger" size="sm" onClick={() => noShowDialog.open(b.id)}>
                        Mark No-Show
                      </Button>
                    ) : (
                      <span className="text-xs text-muted">
                        Renter can still show up until {formatTime(b.pickup_time)} + grace period
                      </span>
                    )}
                  </>
                );
              })() : null}
              {b.status === 'active' ? (
                <Button size="sm" onClick={() => completeDialog.open(b.id)}>Confirm Return</Button>
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
              {(payoutsByBooking.get(b.id)?.length ?? 0) > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPayoutsOpenId(payoutsOpenId === b.id ? null : b.id)}
                >
                  🧾 {payoutsOpenId === b.id ? 'Hide Payment Details' : 'Payment Details'}
                </Button>
              ) : null}
            </div>
            {payoutsOpenId === b.id ? (
              <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3.5">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Payment Details</h4>
                <div className="flex flex-col gap-2">
                  {payoutsByBooking.get(b.id)?.map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-[12.5px]">
                      <div>
                        <span className="font-semibold">{PAYMENT_TYPE_LABEL[p.payment_type]}</span>
                        <span className="ml-2 text-muted">{formatDate(p.created_at)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="tabular font-semibold">{formatCurrency(p.amount)}</span>
                        <Pill tone={paymentStatusTone(p.status)}>{paymentStatusLabel(p.payment_type, p.status)}</Pill>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {chatOpenId === b.id && profile ? <BookingChat bookingId={b.id} currentUserId={profile.id} /> : null}
          </Card>
        ))}

        {bookings?.length === 0 ? (
          <EmptyState icon={Inbox} title="No booking requests yet" description="Requests from renters will show up here." />
        ) : visibleBookings?.length === 0 ? (
          <EmptyState
            icon={tab === 'history' ? History : CalendarClock}
            title={tab === 'history' ? "You don't have any past bookings yet" : 'Nothing active right now'}
          />
        ) : null}
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
        title="Mark this renter as a no-show?"
        description="Only confirm this if the renter never showed up (or never finished paying) within the grace period after the scheduled pickup time. They'll forfeit part of what they've paid as a cancellation fee and receive a strike."
        confirmLabel="Confirm No-Show"
        confirmVariant="danger"
        pending={cancelNoShow.isPending}
        onConfirm={() => noShowDialog.target && cancelNoShow.mutate(noShowDialog.target)}
        onCancel={noShowDialog.close}
        error={cancelNoShow.isError ? friendlyErrorMessage(cancelNoShow.error) : null}
      />

      <ConfirmDialog
        open={!!acceptDialog.target}
        title="Accept this booking request?"
        description="You're committing to have the vehicle available for these dates once the renter completes payment."
        confirmLabel="Accept"
        pending={accept.isPending}
        onConfirm={() => acceptDialog.target && accept.mutate(acceptDialog.target)}
        onCancel={acceptDialog.close}
        error={accept.isError ? friendlyErrorMessage(accept.error) : null}
      />

      <ConfirmDialog
        open={!!handoverDialog.target}
        title="Confirm handover to the renter?"
        description="Only confirm once you've verified their ID in person and handed over the vehicle — this can't be easily undone."
        confirmLabel="Confirm Handover"
        pending={confirmHandover.isPending}
        onConfirm={() => handoverDialog.target && confirmHandover.mutate(handoverDialog.target)}
        onCancel={handoverDialog.close}
        error={confirmHandover.isError ? friendlyErrorMessage(confirmHandover.error) : null}
      />

      <ConfirmDialog
        open={!!completeDialog.target}
        title="Confirm the vehicle was returned?"
        description="This marks the rental complete and starts the deposit-refund/payout process. Only confirm once you've actually gotten the vehicle back."
        confirmLabel="Confirm Return"
        pending={markComplete.isPending}
        onConfirm={() => completeDialog.target && markComplete.mutate(completeDialog.target)}
        onCancel={completeDialog.close}
        error={markComplete.isError ? friendlyErrorMessage(markComplete.error) : null}
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
