import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

const pillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold tracking-wide before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-current",
  {
    variants: {
      tone: {
        warn: 'bg-warn-soft text-warn',
        good: 'bg-good-soft text-good',
        bad: 'bg-bad-soft text-bad',
        info: 'bg-info-soft text-info',
        muted: 'bg-surface-2 text-muted',
      },
    },
    defaultVariants: { tone: 'muted' },
  }
);

export interface PillProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof pillVariants> {}

export function Pill({ className, tone, ...props }: PillProps) {
  return <span className={cn(pillVariants({ tone }), className)} {...props} />;
}

// Maps a booking status straight to its label + tone so every screen renders
// the same status consistently instead of re-deriving this per component.
const BOOKING_STATUS_MAP: Record<string, { label: string; tone: PillProps['tone'] }> = {
  pending_owner: { label: 'Awaiting Owner', tone: 'warn' },
  owner_rejected: { label: 'Declined', tone: 'bad' },
  expired: { label: 'Expired', tone: 'muted' },
  pending_payment: { label: 'Awaiting Downpayment', tone: 'warn' },
  downpayment_paid: { label: 'Balance Due Before Pickup', tone: 'warn' },
  fully_paid: { label: 'Ready for Pickup', tone: 'good' },
  active: { label: 'Active Rental', tone: 'info' },
  completed: { label: 'Completed', tone: 'good' },
  cancelled_by_renter: { label: 'Cancelled by Renter', tone: 'muted' },
  cancelled_by_owner: { label: 'Cancelled by Owner', tone: 'bad' },
  cancelled_no_show: { label: 'Cancelled — No-Show', tone: 'bad' },
  owner_no_show: { label: 'Owner No-Show — Under Review', tone: 'bad' },
};

export function BookingStatusPill({ status }: { status: string }) {
  const entry = BOOKING_STATUS_MAP[status] ?? { label: status, tone: 'muted' as const };
  return <Pill tone={entry.tone}>{entry.label}</Pill>;
}

// Same "★ 4.8 (12)" format everywhere a rating shows up, so a rating with
// zero visible reviews reads as "No ratings yet" instead of "★ 0.0 (0)".
export function RatingBadge({ avg, count }: { avg: number; count: number }) {
  if (count === 0) return <span className="text-xs text-muted">No ratings yet</span>;
  return (
    <span className="text-xs font-semibold text-warn">
      ★ {avg.toFixed(1)} <span className="font-normal text-muted">({count})</span>
    </span>
  );
}
