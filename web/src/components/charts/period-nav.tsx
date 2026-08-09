import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { periodLabel, isCurrentPeriod, shiftPeriod, type TrendGranularity } from '@/lib/trend-periods';

const GRANULARITIES: { value: TrendGranularity; label: string }[] = [
  { value: 'day', label: 'By day' },
  { value: 'week', label: 'By week' },
  { value: 'month', label: 'By month' },
];

// Shared day/week/month drill-down control for trend charts — granularity
// picker on the left, prev/next period navigation (capped so you can't
// browse into the future) on the right. Switching granularity always resets
// to "now" since e.g. a previously-picked week has no meaningful equivalent
// once you're looking at hours-in-a-day.
export function PeriodNav({
  granularity,
  reference,
  onGranularityChange,
  onReferenceChange,
}: {
  granularity: TrendGranularity;
  reference: Date;
  onGranularityChange: (g: TrendGranularity) => void;
  onReferenceChange: (d: Date) => void;
}) {
  const atCurrent = isCurrentPeriod(granularity, reference);

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        {GRANULARITIES.map((g) => (
          <button
            key={g.value}
            className={`rounded-md px-2.5 py-1 text-xs font-bold ${
              granularity === g.value ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:text-ink'
            }`}
            onClick={() => {
              onGranularityChange(g.value);
              onReferenceChange(new Date());
            }}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onReferenceChange(shiftPeriod(granularity, reference, -1))}
          aria-label="Previous period"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2.25} />
        </Button>
        <span className="min-w-[150px] text-center text-xs font-bold">{periodLabel(granularity, reference)}</span>
        <Button
          size="sm"
          variant="ghost"
          disabled={atCurrent}
          onClick={() => onReferenceChange(shiftPeriod(granularity, reference, 1))}
          aria-label="Next period"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2.25} />
        </Button>
        {!atCurrent ? (
          <Button size="sm" variant="secondary" onClick={() => onReferenceChange(new Date())}>
            Today
          </Button>
        ) : null}
      </div>
    </div>
  );
}
