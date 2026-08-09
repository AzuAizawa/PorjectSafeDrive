// Shared drill-down logic for trend charts: "day" shows hour-of-day buckets,
// "week" shows day-of-week buckets, "month" shows day-of-month buckets — each
// one level finer than the period itself, which is what lets a real spike
// (a busy hour, a busy day) actually show up instead of being averaged away.
export type TrendGranularity = 'day' | 'week' | 'month';

function startOfDay(d: Date) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

// Monday-start week, matching the weekKey() helpers already used elsewhere
// in the analytics pages.
function startOfWeek(d: Date) {
  const start = startOfDay(d);
  const day = start.getDay();
  start.setDate(start.getDate() + ((day === 0 ? -6 : 1) - day));
  return start;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function periodRange(granularity: TrendGranularity, reference: Date) {
  if (granularity === 'day') {
    const start = startOfDay(reference);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (granularity === 'week') {
    const start = startOfWeek(reference);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }
  const start = startOfMonth(reference);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return { start, end };
}

export function periodLabel(granularity: TrendGranularity, reference: Date) {
  const { start, end } = periodRange(granularity, reference);
  if (granularity === 'day') {
    return start.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (granularity === 'week') {
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() - 1);
    const sameMonth = start.getMonth() === endInclusive.getMonth();
    const startStr = start.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    const endStr = endInclusive.toLocaleDateString(
      'en-PH',
      sameMonth ? { day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
    );
    return `${startStr} – ${endStr}`;
  }
  return start.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

export function shiftPeriod(granularity: TrendGranularity, reference: Date, direction: 1 | -1) {
  const d = new Date(reference);
  if (granularity === 'day') d.setDate(d.getDate() + direction);
  else if (granularity === 'week') d.setDate(d.getDate() + 7 * direction);
  else d.setMonth(d.getMonth() + direction);
  return d;
}

// Are we already viewing the period containing "now"? Used to disable
// navigating into the future.
export function isCurrentPeriod(granularity: TrendGranularity, reference: Date) {
  return periodRange(granularity, reference).start.getTime() >= periodRange(granularity, new Date()).start.getTime();
}

export function periodKey(granularity: TrendGranularity, reference: Date) {
  return `${granularity}:${periodRange(granularity, reference).start.toISOString()}`;
}

// Buckets timestamped records into the finer unit for the given
// granularity, filling every bucket -- including empty ones -- so a quiet
// hour/day shows as a real gap on the line chart rather than being skipped.
export function bucketByPeriod<T>(
  records: T[],
  timestampOf: (r: T) => string,
  valueOf: (r: T) => number,
  granularity: TrendGranularity,
  reference: Date
): { label: string; value: number }[] {
  const { start, end } = periodRange(granularity, reference);
  const inRange = records.filter((r) => {
    const t = new Date(timestampOf(r)).getTime();
    return t >= start.getTime() && t < end.getTime();
  });

  if (granularity === 'day') {
    const buckets = Array.from({ length: 24 }, () => 0);
    for (const r of inRange) buckets[new Date(timestampOf(r)).getHours()] += valueOf(r);
    return buckets.map((value, hour) => ({
      label: new Date(2000, 0, 1, hour).toLocaleTimeString('en-PH', { hour: 'numeric' }),
      value,
    }));
  }

  if (granularity === 'week') {
    const buckets = Array.from({ length: 7 }, () => 0);
    for (const r of inRange) {
      const idx = Math.floor((startOfDay(new Date(timestampOf(r))).getTime() - start.getTime()) / 86_400_000);
      if (idx >= 0 && idx < 7) buckets[idx] += valueOf(r);
    }
    return buckets.map((value, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return { label: d.toLocaleDateString('en-PH', { weekday: 'short' }), value };
    });
  }

  const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const buckets = Array.from({ length: daysInMonth }, () => 0);
  for (const r of inRange) {
    const idx = Math.round((startOfDay(new Date(timestampOf(r))).getTime() - start.getTime()) / 86_400_000);
    if (idx >= 0 && idx < daysInMonth) buckets[idx] += valueOf(r);
  }
  return buckets.map((value, i) => ({ label: String(i + 1), value }));
}
