import { describe, expect, it } from 'vitest';
import { previewCancellation } from './cancellation';
import type { Booking } from './database.types';

const settings = { free_cancel_hours: 24, cancellation_fee_percent: 20, no_free_cancel_hours_before_pickup: 24 };

// Far enough out that "close to pickup" never accidentally triggers in the
// baseline fixture, no matter when the suite actually runs.
const FAR_FUTURE_START = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const FAR_FUTURE_END = new Date(Date.now() + 34 * 86_400_000).toISOString().slice(0, 10);

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b1',
    vehicle_id: 'v1',
    renter_id: 'r1',
    owner_id: 'o1',
    start_date: FAR_FUTURE_START,
    end_date: FAR_FUTURE_END,
    pickup_time: '10:00:00',
    total_days: 4,
    base_price: 4000,
    commission: 400,
    total_price: 4400,
    downpayment_amount: 2200,
    balance_amount: 2200,
    deposit_amount: 0,
    downpayment_paid: false,
    downpayment_paid_at: null,
    balance_paid: false,
    balance_paid_at: null,
    deposit_paid: false,
    deposit_paid_at: null,
    deposit_refunded: false,
    status: 'pending_owner',
    cancellation_reason: null,
    owner_response_deadline: null,
    payment_deadline: null,
    renter_completed: false,
    owner_completed: false,
    completed_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('previewCancellation', () => {
  it('is free with no fee when nothing has been paid yet', () => {
    const result = previewCancellation(makeBooking(), settings);
    expect(result.free).toBe(true);
    expect(result.fee).toBe(0);
    expect(result.refund).toBe(0);
  });

  it('is free within the free-cancellation window after downpayment', () => {
    const booking = makeBooking({
      downpayment_paid: true,
      downpayment_paid_at: new Date(Date.now() - 3_600_000).toISOString(), // 1h ago
    });
    const result = previewCancellation(booking, settings);
    expect(result.free).toBe(true);
    expect(result.refund).toBe(booking.downpayment_amount);
  });

  it('charges the cancellation fee once outside the free window', () => {
    const booking = makeBooking({
      downpayment_paid: true,
      downpayment_paid_at: new Date(Date.now() - 48 * 3_600_000).toISOString(), // 48h ago
    });
    const result = previewCancellation(booking, settings);
    expect(result.free).toBe(false);
    expect(result.fee).toBeCloseTo(booking.total_price * 0.2);
    expect(result.refund).toBeCloseTo(booking.downpayment_amount - result.fee);
  });

  it('never returns a negative refund when the fee exceeds what was paid', () => {
    const booking = makeBooking({
      downpayment_paid: true,
      downpayment_paid_at: new Date(Date.now() - 48 * 3_600_000).toISOString(),
      downpayment_amount: 10,
      total_price: 4400,
    });
    const result = previewCancellation(booking, settings);
    expect(result.refund).toBe(0);
  });

  it('refunds the full total price when cancelling after the balance was paid', () => {
    const booking = makeBooking({
      downpayment_paid: true,
      balance_paid: true,
      downpayment_paid_at: new Date(Date.now() - 48 * 3_600_000).toISOString(),
    });
    const result = previewCancellation(booking, settings);
    expect(result.fee).toBeCloseTo(booking.total_price * 0.2);
    expect(result.refund).toBeCloseTo(booking.total_price - result.fee);
  });

  it('withdraws free cancellation when pickup is too close, even seconds after paying', () => {
    // previewCancellation reads start_date+pickup_time as Manila (UTC+8) wall-clock
    // time, so shift the target instant by +8h before reading its UTC date/time parts.
    const pickupInstant = Date.now() + 12 * 3_600_000; // pickup in 12h
    const manilaWallClock = new Date(pickupInstant + 8 * 3_600_000);
    const booking = makeBooking({
      start_date: manilaWallClock.toISOString().slice(0, 10),
      pickup_time: manilaWallClock.toISOString().slice(11, 19),
      downpayment_paid: true,
      downpayment_paid_at: new Date().toISOString(), // just paid
    });
    const result = previewCancellation(booking, settings);
    expect(result.free).toBe(false);
    expect(result.fee).toBeCloseTo(booking.total_price * 0.2);
  });

  it('still allows free cancellation right after paying when pickup is far away', () => {
    const booking = makeBooking({
      downpayment_paid: true,
      downpayment_paid_at: new Date().toISOString(),
    });
    const result = previewCancellation(booking, settings);
    expect(result.free).toBe(true);
  });
});
