import { useState } from 'react';

interface Bar {
  label: string;
  value: number;
}

// Horizontal bar comparison — magnitude across categories, one hue per the
// "compare magnitude → sequential (one hue)" rule. Categories are already
// identified by their row label, so no categorical rainbow is needed.
export function BarChart({ data, formatValue = (v) => String(v) }: { data: Bar[]; formatValue?: (v: number) => string }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  // Cap the longest bar well short of 100% so its value label — placed at the
  // tip, outside the fill — always has room and never gets clipped by the card edge.
  const MAX_BAR_PCT = 72;

  return (
    <div className="flex flex-col gap-2.5">
      {data.map((d, i) => {
        const pct = (d.value / max) * MAX_BAR_PCT;
        const hovered = hoverIndex === i;
        return (
          <div key={d.label} className="flex items-center gap-3">
            <div className="w-28 shrink-0 truncate text-xs font-semibold text-muted" title={d.label}>
              {d.label}
            </div>
            <div
              className="relative h-6 flex-1 cursor-default"
              tabIndex={0}
              aria-label={`${d.label}: ${formatValue(d.value)}`}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
              onFocus={() => setHoverIndex(i)}
              onBlur={() => setHoverIndex(null)}
            >
              <div
                className="h-6 rounded-r-[4px] transition-opacity"
                style={{
                  width: `${Math.max(pct, 3)}%`,
                  backgroundColor: 'var(--color-accent)',
                  opacity: hovered ? 1 : 0.85,
                }}
              />
              <span className="ml-2 text-xs font-bold tabular text-ink" style={{ position: 'absolute', left: `${Math.max(pct, 3)}%`, top: '2px' }}>
                {formatValue(d.value)}
              </span>
            </div>
          </div>
        );
      })}
      {data.length === 0 ? <p className="text-sm text-muted">No data yet.</p> : null}
    </div>
  );
}
