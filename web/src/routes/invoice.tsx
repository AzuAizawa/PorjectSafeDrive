import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill, BookingStatusPill } from '@/components/ui/pill';
import { formatCurrency, formatDate } from '@/lib/utils';
import { formatTime } from '@/lib/pickup';
import { PAYMENT_TYPE_LABEL, paymentStatusLabel, paymentStatusTone } from '@/lib/payment-display';
import type { Booking, CarModel, CarBrand, Profile, Payment, CompanyInfo } from '@/lib/database.types';

type InvoiceBooking = Booking & {
  vehicle: { plate_number: string; model: CarModel & { brand: CarBrand } };
  renter: Pick<Profile, 'first_name' | 'last_name'>;
  owner: Pick<Profile, 'first_name' | 'last_name'>;
};

async function fetchBookingForInvoice(bookingId: string) {
  const { data, error } = await supabase
    .from('bookings')
    .select(
      `*, vehicle:vehicles(plate_number, model:car_models(*, brand:car_brands(*))),
       renter:profiles!bookings_renter_id_fkey(first_name, last_name),
       owner:profiles!bookings_owner_id_fkey(first_name, last_name)`
    )
    .eq('id', bookingId)
    .single();
  if (error) throw error;
  return data as unknown as InvoiceBooking;
}

async function fetchPayments(bookingId: string) {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data as Payment[];
}

async function fetchCompanyContact() {
  const { data, error } = await supabase.from('company_info').select('key, value');
  if (error) throw error;
  return Object.fromEntries((data as CompanyInfo[]).map((s) => [s.key, s.value]));
}

export function InvoicePage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const { data: booking } = useQuery({
    queryKey: ['invoice-booking', bookingId],
    queryFn: () => fetchBookingForInvoice(bookingId!),
    enabled: !!bookingId,
  });
  const { data: payments } = useQuery({
    queryKey: ['invoice-payments', bookingId],
    queryFn: () => fetchPayments(bookingId!),
    enabled: !!bookingId,
  });
  const { data: contact } = useQuery({ queryKey: ['company-info-contact'], queryFn: fetchCompanyContact });

  if (!booking) return <p className="text-muted">Loading…</p>;

  if (!booking.invoice_number) {
    return (
      <Card className="p-6">
        <h1 className="mb-2 text-xl font-bold">No invoice yet</h1>
        <p className="text-muted">An invoice is generated once the downpayment for this booking is received.</p>
      </Card>
    );
  }

  // Mirrors cancel_booking()'s own math (037_pickup_time_meetup_and_calendar.sql)
  // rather than storing a separate fee column — the persisted 'refund'
  // payment row already bundles the deposit back in full (never subject to
  // the cancellation fee), so the fee is recoverable as paid-minus-refund
  // with the deposit portion backed out of both sides.
  const refundPayment = payments?.find((p) => p.payment_type === 'refund');
  const rentalPaidBeforeRefund = booking.balance_paid ? booking.total_price : booking.downpayment_paid ? booking.downpayment_amount : 0;
  const depositIncluded = booking.deposit_paid ? booking.deposit_amount : 0;
  const cancellationFee = refundPayment ? Math.max(rentalPaidBeforeRefund - (refundPayment.amount - depositIncluded), 0) : 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <h1 className="text-2xl">Invoice</h1>
        <Button onClick={() => window.print()}>🖨 Print / Save as PDF</Button>
      </div>

      <Card className="p-6">
        <div className="mb-5 flex items-start justify-between border-b border-line pb-4">
          <div>
            <div className="flex items-center gap-2 text-lg font-bold">
              <span className="btn-gradient-accent grid h-7 w-7 place-items-center rounded-lg text-xs text-white">SD</span>
              SafeDrive
            </div>
            {contact?.support_email || contact?.support_phone ? (
              <p className="mt-1 text-xs text-muted">
                {contact.support_email}
                {contact.support_email && contact.support_phone ? ' · ' : ''}
                {contact.support_phone}
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <div className="text-sm font-bold tabular">{booking.invoice_number}</div>
            <div className="text-xs text-muted">
              Issued {booking.downpayment_paid_at ? formatDate(booking.downpayment_paid_at) : '—'}
            </div>
            <div className="mt-1">
              <BookingStatusPill status={booking.status} />
            </div>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-4 text-[13px]">
          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Renter</div>
            <div className="font-semibold">{booking.renter.first_name} {booking.renter.last_name}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Owner</div>
            <div className="font-semibold">{booking.owner.first_name} {booking.owner.last_name}</div>
          </div>
          <div className="col-span-2">
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Vehicle</div>
            <div className="font-semibold">
              {booking.vehicle.model.brand.name} {booking.vehicle.model.name} · {booking.vehicle.plate_number}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Rental Period</div>
            <div className="font-semibold">
              {formatDate(booking.start_date)} – {formatDate(booking.end_date)} ({booking.total_days} days)
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Pickup Time</div>
            <div className="font-semibold">{formatTime(booking.pickup_time)}</div>
          </div>
        </div>

        <table className="mb-5 w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-xs font-bold uppercase tracking-wide text-muted">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line/60">
              <td className="py-2">
                Rental — {formatCurrency(booking.base_price / booking.total_days)}/day × {booking.total_days} days
              </td>
              <td className="py-2 text-right tabular">{formatCurrency(booking.base_price)}</td>
            </tr>
            <tr className="border-b border-line/60">
              <td className="py-2">SafeDrive Service Fee</td>
              <td className="py-2 text-right tabular">{formatCurrency(booking.commission)}</td>
            </tr>
            <tr className="font-bold">
              <td className="py-2">Total Rental Price</td>
              <td className="py-2 text-right tabular">{formatCurrency(booking.total_price)}</td>
            </tr>
          </tbody>
        </table>

        {booking.deposit_amount > 0 ? (
          <div className="mb-5 rounded-md border border-line bg-surface-2 p-3 text-[13px]">
            <div className="flex items-center justify-between">
              <span>
                Refundable Security Deposit <span className="text-xs text-muted">(not part of rental cost)</span>
              </span>
              <span className="tabular font-semibold">{formatCurrency(booking.deposit_amount)}</span>
            </div>
            <div className="mt-1 text-xs text-muted">
              {booking.deposit_refunded ? 'Refunded' : booking.deposit_paid ? 'Held, to be refunded after the rental' : 'Not yet collected'}
            </div>
          </div>
        ) : null}

        <div className="mb-5">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Payment Schedule</h3>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-xs font-bold uppercase tracking-wide text-muted">
                <th className="py-2">Type</th>
                <th className="py-2">Date</th>
                <th className="py-2">Reference</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {payments?.map((p) => (
                <tr key={p.id} className="border-b border-line/60">
                  <td className="py-2">{PAYMENT_TYPE_LABEL[p.payment_type]}</td>
                  <td className="py-2">{formatDate(p.created_at)}</td>
                  <td className="py-2 tabular text-xs text-muted">{p.paymongo_reference ?? '—'}</td>
                  <td className="py-2 text-right tabular">{formatCurrency(p.amount)}</td>
                  <td className="py-2 text-right">
                    <Pill tone={paymentStatusTone(p.status)}>{paymentStatusLabel(p.payment_type, p.status)}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {refundPayment ? (
          <div className="rounded-md border border-warn bg-warn-soft p-3 text-[13px]">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-warn">Cancellation / Refund</h3>
            <div className="flex justify-between">
              <span>Amount paid</span>
              <span className="tabular">{formatCurrency(rentalPaidBeforeRefund + depositIncluded)}</span>
            </div>
            <div className="flex justify-between">
              <span>Cancellation fee</span>
              <span className="tabular">{formatCurrency(cancellationFee)}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>Net refund</span>
              <span className="tabular">{formatCurrency(refundPayment.amount)}</span>
            </div>
            <div className="mt-1 text-xs text-muted">
              Status: {paymentStatusLabel('refund', refundPayment.status)} · {formatDate(refundPayment.created_at)}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
