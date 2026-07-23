import { Fragment, useState } from 'react';

export interface HeatmapCell {
  day: number; // 0 = Sunday .. 6 = Saturday
  hour: number; // 0-23
  value: number;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21];

function hourLabel(h: number) {
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${period}`;
}

// Peak pickup-time heatmap: day-of-week x hour-of-day, magnitude encoded as a
// single-hue light->dark ramp per the dataviz "sequential = one hue" rule —
// implemented as opacity of the existing accent token (not a fixed hex ramp)
// so it re-derives correctly in dark mode instead of a static light-mode ramp.
export function HeatmapChart({ cells }: { cells: HeatmapCell[] }) {
  const [hovered, setHovered] = useState<{ day: number; hour: number } | null>(null);
  const byKey = new Map(cells.map((c) => [`${c.day}-${c.hour}`, c.value]));
  const max = Math.max(1, ...cells.map((c) => c.value));
  const total = cells.reduce((s, c) => s + c.value, 0);

  if (total === 0) {
    return <p className="text-sm text-muted">No pickups recorded yet.</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <div className="grid" style={{ gridTemplateColumns: '36px repeat(24, minmax(14px, 1fr))' }}>
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="pb-1 text-center text-[9px] text-muted-2">
                {HOUR_TICKS.includes(h) ? hourLabel(h) : ''}
              </div>
            ))}
            {DAY_LABELS.map((label, day) => (
              <Fragment key={day}>
                <div className="flex items-center pr-1.5 text-[10.5px] font-semibold text-muted">
                  {label}
                </div>
                {Array.from({ length: 24 }, (_, hour) => {
                  const value = byKey.get(`${day}-${hour}`) ?? 0;
                  const intensity = value === 0 ? 0 : 0.12 + (value / max) * 0.88;
                  const isHovered = hovered?.day === day && hovered?.hour === hour;
                  return (
                    <div
                      key={`${day}-${hour}`}
                      tabIndex={0}
                      className="relative m-px aspect-square rounded-[3px] outline-none"
                      style={{
                        backgroundColor: value === 0 ? 'var(--color-surface-2)' : 'var(--color-accent)',
                        opacity: value === 0 ? 1 : intensity,
                        boxShadow: isHovered ? '0 0 0 2px var(--color-accent-strong)' : undefined,
                      }}
                      onMouseEnter={() => setHovered({ day, hour })}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered({ day, hour })}
                      onBlur={() => setHovered(null)}
                      aria-label={`${label} ${hourLabel(hour)}: ${value} pickup${value === 1 ? '' : 's'}`}
                    >
                      {isHovered ? (
                        <div className="glass absolute -top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-line/70 px-2 py-1 text-[11px] font-semibold shadow-lg">
                          {label} {hourLabel(hour)} · {value}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
        <span>Fewer</span>
        <div className="flex gap-0.5">
          {[0.15, 0.4, 0.65, 1].map((op) => (
            <div key={op} className="h-2.5 w-5 rounded-sm" style={{ backgroundColor: 'var(--color-accent)', opacity: op }} />
          ))}
        </div>
        <span>More pickups</span>
      </div>
    </div>
  );
}
