import type { BookingStatus } from '@/lib/database.types';

// Anything that's done and isn't changing anymore — used to split "Active"
// from "History" tabs on My Bookings / Bookings Received.
const HISTORY_STATUSES = new Set<BookingStatus>([
  'completed', 'cancelled_by_renter', 'cancelled_by_owner', 'cancelled_no_show', 'owner_no_show', 'owner_rejected', 'expired',
]);

export function isHistoryStatus(status: BookingStatus): boolean {
  return HISTORY_STATUSES.has(status);
}

// Contact info (name/phone) is only shared once the owner has actually
// accepted — matches the server-side gate in
// get_booking_counterpart_contact() (057_booking_counterpart_contact.sql).
const NOT_YET_ACCEPTED_STATUSES = new Set<BookingStatus>(['pending_owner', 'owner_rejected', 'expired']);

export function isBookingAccepted(status: BookingStatus): boolean {
  return !NOT_YET_ACCEPTED_STATUSES.has(status);
}
