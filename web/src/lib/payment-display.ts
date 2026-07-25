import type { PaymentStatus, PaymentType } from '@/lib/database.types';

export const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  downpayment: 'Downpayment',
  deposit: 'Security deposit',
  balance: 'Balance',
  refund: 'Refund',
  payout: 'Payout',
  subscription: 'Subscription',
};

// A 'refund' row's own status means money coming back, so "Paid" would read
// backwards there — everything else is money going out, where "Paid" fits.
export function paymentStatusLabel(type: PaymentType, status: PaymentStatus) {
  if (type === 'refund') {
    if (status === 'succeeded') return 'Refunded';
    if (status === 'failed') return 'Failed';
    return 'Processing';
  }
  if (status === 'succeeded') return 'Paid';
  if (status === 'failed') return 'Failed';
  return 'Processing';
}

export function paymentStatusTone(status: PaymentStatus) {
  if (status === 'succeeded') return 'good' as const;
  if (status === 'failed') return 'bad' as const;
  return 'warn' as const;
}
