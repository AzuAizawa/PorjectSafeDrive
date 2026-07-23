import type { Booking } from '@/lib/database.types';

export interface CancellationPreview {
  free: boolean;
  fee: number;
  refund: number;
  message: string;
}

// Mirrors the fee math in cancel_booking() (037_pickup_time_meetup_and_calendar.sql)
// so the UI can show the renter what they're about to be charged *before*
// they confirm — the RPC remains the source of truth that actually enforces it.
export function previewCancellation(
  booking: Booking,
  settings: { free_cancel_hours: number; cancellation_fee_percent: number; no_free_cancel_hours_before_pickup: number }
): CancellationPreview {
  const paidAmount = booking.balance_paid ? booking.total_price : booking.downpayment_paid ? booking.downpayment_amount : 0;

  // Asia/Manila is a fixed UTC+8 offset, no DST — safe to hardcode.
  const pickupTs = new Date(`${booking.start_date}T${booking.pickup_time}+08:00`).getTime();
  const closeToPickup = Date.now() > pickupTs - settings.no_free_cancel_hours_before_pickup * 3_600_000;

  const withinFreeWindow =
    !!booking.downpayment_paid_at &&
    Date.now() <= new Date(booking.downpayment_paid_at).getTime() + settings.free_cancel_hours * 3_600_000 &&
    !closeToPickup;

  if (!booking.downpayment_paid_at || withinFreeWindow) {
    return {
      free: true,
      fee: 0,
      refund: paidAmount,
      message: paidAmount > 0 ? "You're within the free-cancellation window — full refund, no fee." : 'Nothing has been charged yet — cancelling is free.',
    };
  }

  const fee = booking.total_price * (settings.cancellation_fee_percent / 100);
  const refund = Math.max(paidAmount - fee, 0);
  const reason = closeToPickup
    ? `Pickup is too close (within ${settings.no_free_cancel_hours_before_pickup}h) for a free cancellation`
    : "You're outside the free-cancellation window";
  return {
    free: false,
    fee,
    refund,
    message: `${reason}. A ${settings.cancellation_fee_percent}% fee (₱${fee.toFixed(2)}) applies — you'll be refunded ₱${refund.toFixed(2)}.`,
  };
}
