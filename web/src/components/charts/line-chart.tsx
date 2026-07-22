import { useState } from 'react';

interface Point {
  label: string;
  value: number;
}

// Single-series trend line. Deliberately one hue (the brand accent) per the
// dataviz method: "sequential is the safe default" for a magnitude-over-time
// story with only one series — no legend needed, the card title names it.
export function LineChart({ data, formatValue = (v) => String(v) }: { data: Point[]; formatValue?: (v: number) => string }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const width = 560;
  const height = 200;
  const padding = { top: 16, right: 12, bottom: 24, left: 12 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const max = Math.max(1, ...data.map((d) => d.value));
  const niceMax = Math.ceil(max / 5) * 5 || 5;

  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
  const xFor = (i: number) => padding.left + i * stepX;
  const yFor = (v: number) => padding.top + innerH - (v / niceMax) * innerH;

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(d.value)}`).join(' ');
  const areaPath = `${linePath} L ${xFor(data.length - 1)} ${padding.top + innerH} L ${xFor(0)} ${padding.top + innerH} Z`;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => padding.top + innerH * (1 - f));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Trend over time">
        {gridLines.map((y, i) => (
          <line key={i} x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--color-line)" strokeWidth={1} />
        ))}

        <path d={areaPath} fill="var(--color-accent)" opacity={0.1} />
        <path d={linePath} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {data.map((d, i) => (
          <g key={i}>
            <circle
              cx={xFor(i)}
              cy={yFor(d.value)}
              r={hoverIndex === i ? 5 : 4}
              fill="var(--color-accent)"
              stroke="var(--color-surface)"
              strokeWidth={2}
            />
            {/* Hit target wider than the visible dot, per interaction spec */}
            <rect
              x={xFor(i) - stepX / 2}
              y={padding.top}
              width={Math.max(stepX, 16)}
              height={innerH}
              fill="transparent"
              tabIndex={0}
              aria-label={`${d.label}: ${formatValue(d.value)}`}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
              onFocus={() => setHoverIndex(i)}
              onBlur={() => setHoverIndex(null)}
            />
          </g>
        ))}

        {data.length > 0 ? (
          <text x={xFor(0)} y={height - 4} fontSize="10" fill="var(--color-muted-2)">{data[0].label}</text>
        ) : null}
        {data.length > 1 ? (
          <text x={xFor(data.length - 1)} y={height - 4} fontSize="10" fill="var(--color-muted-2)" textAnchor="end">
            {data[data.length - 1].label}
          </text>
        ) : null}
      </svg>

      {hoverIndex !== null ? (
        <div
          className="pointer-events-none absolute rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: `${(xFor(hoverIndex) / width) * 100}%`,
            top: `${(yFor(data[hoverIndex].value) / height) * 100}%`,
            transform: 'translate(-50%, -130%)',
          }}
        >
          <div className="font-bold tabular">{formatValue(data[hoverIndex].value)}</div>
          <div className="text-muted">{data[hoverIndex].label}</div>
        </div>
      ) : null}
    </div>
  );
}
