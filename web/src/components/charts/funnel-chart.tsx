interface Stage {
  label: string;
  value: number;
}

// Ordinal progression (requested -> accepted -> paid -> completed): same hue,
// light-to-dark steps carry the "stage" order rather than distinct hues —
// per the dataviz method's ordinal-ramp guidance for funnel stages.
const RAMP = ['#cdeae3', '#7fc9ba', '#0e7c6b', '#0a5c4f'];

export function FunnelChart({ stages }: { stages: Stage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));

  return (
    <div className="flex flex-col gap-3">
      {stages.map((s, i) => {
        const pct = (s.value / max) * 100;
        const prev = i > 0 ? stages[i - 1].value : null;
        const dropoff = prev && prev > 0 ? Math.round((s.value / prev) * 100) : null;
        const isDark = i >= 2;
        return (
          <div key={s.label}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-semibold text-muted">{s.label}</span>
              <span className="tabular">
                <strong className="text-ink">{s.value}</strong>
                {dropoff !== null ? <span className="ml-1.5 text-muted">({dropoff}% of previous)</span> : null}
              </span>
            </div>
            <div className="h-7 rounded-[4px]" style={{ width: `${Math.max(pct, 4)}%`, backgroundColor: RAMP[i % RAMP.length] }}>
              <span className={`flex h-full items-center px-2 text-xs font-bold ${isDark ? 'text-white' : 'text-ink'}`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
