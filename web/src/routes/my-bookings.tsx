import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CarFront, CalendarClock, History } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookingStatusPill, Pill, RatingBadge } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { ContactInfoButton } from '@/components/contact-info-button';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog, useConfirmTarget } from '@/components/ui/confirm-dialog';
import { ReportIssueDialog } from '@/components/report-issue-dialog';
import { RateBookingDialog } from '@/components/rate-booking-dialog';
import { EmergencyBanner } from '@/components/emergency-banner';
import { BookingChat } from '@/components/booking-chat';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { previewCancellation } from '@/lib/cancellation';
import { signedUrl } from '@/lib/storage';
import { fetchRatingSummaries } from '@/lib/ratings';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import { formatTime, pickupTimestamp, useNoShowGraceMinutes } from '@/lib/pickup';
import { isHistoryStatus, isBookingAccepted } from '@/lib/booking-status';
import { PAYMENT_TYPE_LABEL, paymentStatusLabel, paymentStatusTone } from '@/lib/payment-display';
import type { Booking, CarModel, CarBrand, Profile, Payment, Dispute } from '@/lib/database.types';

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
    .in('key', ['free_cancel_hours', 'cancellation_fee_percent', 'no_free_cancel_hours_before_pickup']);
  if (error) throw error;
  return Object.fromEntries(data.map((s) => [s.key, Number(s.value)])) as {
    free_cancel_hours: number;
    cancellation_fee_percent: number;
    no_free_cancel_hours_before_pickup: number;
  };
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

async function fetchMyPayments(payerId: string) {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('payer_id', payerId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data as Payment[];
}

export function MyBookingsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cancelDialog = useConfirmTarget<string>();
  const reportDialog = useConfirmTarget<string>();
  const rateDialog = useConfirmTarget<string>();
  const [chatOpenId, setChatOpenId] = useState<string | null>(null);
  const [paymentsOpenId, setPaymentsOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [payConfirm, setPayConfirm] = useState<{ bookingId: string; paymentType: 'downpayment' | 'balance' } | null>(null);

  const { data: bookings, isLoading } = useQuery({
    queryKey: ['bookings', 'mine', profile?.id],
    queryFn: () => fetchMyBookings(profile!.id),
    enabled: !!profile,
  });
  const { data: payments } = useQuery({
    queryKey: ['payments', 'mine', profile?.id],
    queryFn: () => fetchMyPayments(profile!.id),
    enabled: !!profile,
  });
  const paymentsByBooking = useMemo(() => {
    const map = new Map<string, Payment[]>();
    for (const p of payments ?? []) {
      if (!p.booking_id) continue;
      if (!map.has(p.booking_id)) map.set(p.booking_id, []);
      map.get(p.booking_id)!.push(p);
    }
    return map;
  }, [payments]);
  const bookingIds = useMemo(() => bookings?.map((b) => b.id) ?? [], [bookings]);
  const { data: disputes } = useQuery({
    queryKey: ['disputes', 'mine', bookingIds],
    queryFn: () => fetchDisputesForBookings(bookingIds),
    enabled: bookingIds.length > 0,
  });
  const disputeByBooking = useMemo(() => {
    const map = new Map<string, Dispute>();
    for (const d of disputes ?? []) map.set(d.booking_id, d);
    return map;
  }, [disputes]);
  const { data: settings } = useQuery({ queryKey: ['cancellation-settings'], queryFn: fetchCancellationSettings });
  const { data: graceMinutes } = useNoShowGraceMinutes();
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
  const reportOwnerNoShow = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc('report_owner_no_show', { p_booking_id: bookingId });
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
  const visibleBookings = bookings?.filter((b) => (tab === 'history' ? isHistoryStatus(b.status) : !isHistoryStatus(b.status)));
  const historyCount = bookings?.filter((b) => isHistoryStatus(b.status)).length ?? 0;
  const activeCount = bookings ? bookings.length - historyCount : 0;

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
          <Card key={b.id} className="flex gap-4 p-5">
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[14.5px] font-bold">
                    {b.vehicle.model.brand.name} {b.vehicle.model.name} · {b.vehicle.plate_number}
                  </div>
                  <div className="text-xs text-muted">
                    {formatDate(b.start_date)} – {formatDate(b.end_date)} · {b.total_days} days · Pickup {formatTime(b.pickup_time)}
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
                  <p className="mt-1.5 text-xs font-semibold text-warn">🚩 Your reported issue is under review.</p>
                ) : (
                  <p className="mt-1.5 text-xs text-good">✓ Issue resolved: {d.resolution_notes}</p>
                );
              })() : null}

              <div className="mt-2.5 flex items-center gap-2">
                {isBookingAccepted(b.status) ? (
                  <ContactInfoButton
                    bookingId={b.id}
                    avatarPath={b.owner.avatar_url}
                    firstName={b.owner.first_name}
                    lastName={b.owner.last_name}
                  />
                ) : (
                  <Avatar avatarPath={b.owner.avatar_url} firstName={b.owner.first_name} lastName={b.owner.last_name} size="sm" />
                )}
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
                  <Button size="sm" onClick={() => setPayConfirm({ bookingId: b.id, paymentType: 'downpayment' })}>
                    Pay Downpayment
                  </Button>
                ) : null}
                {b.status === 'downpayment_paid' ? (
                  <Button size="sm" onClick={() => setPayConfirm({ bookingId: b.id, paymentType: 'balance' })}>
                    Pay Balance
                  </Button>
                ) : null}
                {['pending_owner', 'pending_payment', 'downpayment_paid', 'fully_paid'].includes(b.status) ? (
                  <Button variant="ghost" size="sm" onClick={() => cancelDialog.open(b.id)}>
                    Cancel
                  </Button>
                ) : null}
                {(b.status === 'downpayment_paid' || b.status === 'fully_paid') &&
                graceMinutes != null &&
                Date.now() >= pickupTimestamp(b.start_date, b.pickup_time) + graceMinutes * 60_000 ? (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={reportOwnerNoShow.isPending}
                    onClick={() => reportOwnerNoShow.mutate(b.id)}
                  >
                    Owner Didn't Show Up
                  </Button>
                ) : null}
                {b.status === 'active' ? (
                  <Button variant="danger" size="sm" onClick={() => reportDialog.open(b.id)}>Report an Issue</Button>
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
                {(paymentsByBooking.get(b.id)?.length ?? 0) > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPaymentsOpenId(paymentsOpenId === b.id ? null : b.id)}
                  >
                    🧾 {paymentsOpenId === b.id ? 'Hide Payment Details' : 'Payment Details'}
                  </Button>
                ) : null}
                {b.invoice_number ? (
                  <Link to={`/invoice/${b.id}`}>
                    <Button variant="ghost" size="sm">📄 View Invoice</Button>
                  </Link>
                ) : null}
              </div>
              {paymentsOpenId === b.id ? (
                <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3.5">
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Payment Details</h4>
                  <div className="flex flex-col gap-2">
                    {paymentsByBooking.get(b.id)?.map((p) => (
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
            </div>
          </Card>
        ))}

        {bookings?.length === 0 ? (
          <EmptyState
            icon={CarFront}
            title="No bookings yet"
            description="Find a car on Browse and send your first booking request."
            action={{ label: 'Browse Cars', onClick: () => navigate('/browse') }}
          />
        ) : visibleBookings?.length === 0 ? (
          <EmptyState
            icon={tab === 'history' ? History : CalendarClock}
            title={tab === 'history' ? "You don't have any past bookings yet" : 'Nothing active right now'}
          />
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

      <ConfirmDialog
        open={!!payConfirm}
        title={payConfirm?.paymentType === 'balance' ? 'Pay the remaining balance?' : 'Pay the downpayment?'}
        description="You'll be redirected to PayMongo's secure checkout to complete this payment."
        confirmLabel="Continue to Payment"
        pending={pay.isPending}
        onConfirm={() => payConfirm && pay.mutate(payConfirm)}
        onCancel={() => setPayConfirm(null)}
        error={pay.isError ? friendlyErrorMessage(pay.error) : null}
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
