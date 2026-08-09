import { describe, expect, it } from 'vitest';
import { bucketByPeriod, isCurrentPeriod, periodRange, shiftPeriod } from './trend-periods';

type Row = { created_at: string; value: number };

describe('periodRange', () => {
  it('day: spans exactly midnight to midnight', () => {
    const { start, end } = periodRange('day', new Date('2026-08-09T15:30:00'));
    expect(start.getHours()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(86_400_000);
  });

  it('week: starts on Monday regardless of reference weekday', () => {
    // 2026-08-09 is a Sunday
    const { start } = periodRange('week', new Date('2026-08-09T12:00:00'));
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(3); // Mon Aug 3, 2026
  });

  it('month: spans the 1st through the start of the next month', () => {
    const { start, end } = periodRange('month', new Date('2026-08-15T00:00:00'));
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(7); // August (0-indexed)
    expect(end.getMonth()).toBe(8); // September
  });
});

describe('bucketByPeriod', () => {
  it('day: sums values into 24 hour buckets and excludes out-of-range rows', () => {
    const reference = new Date('2026-08-09T12:00:00');
    const rows: Row[] = [
      { created_at: '2026-08-09T03:15:00', value: 2 },
      { created_at: '2026-08-09T03:45:00', value: 1 },
      { created_at: '2026-08-09T14:00:00', value: 5 },
      { created_at: '2026-08-10T03:00:00', value: 99 }, // next day, excluded
    ];
    const result = bucketByPeriod(rows, (r) => r.created_at, (r) => r.value, 'day', reference);
    expect(result).toHaveLength(24);
    expect(result[3].value).toBe(3); // 2 + 1 in the 3am bucket
    expect(result[14].value).toBe(5);
    expect(result.reduce((s, p) => s + p.value, 0)).toBe(8); // 99 correctly excluded
  });

  it('week: sums values into 7 day-of-week buckets starting Monday', () => {
    const reference = new Date('2026-08-09T12:00:00'); // Sunday, week of Aug 3-9
    const rows: Row[] = [
      { created_at: '2026-08-03T10:00:00', value: 10 }, // Monday
      { created_at: '2026-08-09T10:00:00', value: 20 }, // Sunday (last day of that week)
      { created_at: '2026-08-10T10:00:00', value: 999 }, // next week, excluded
    ];
    const result = bucketByPeriod(rows, (r) => r.created_at, (r) => r.value, 'week', reference);
    expect(result).toHaveLength(7);
    expect(result[0].value).toBe(10);
    expect(result[6].value).toBe(20);
    expect(result.reduce((s, p) => s + p.value, 0)).toBe(30);
  });

  it('month: sums values into one bucket per day of the month', () => {
    const reference = new Date('2026-02-10T00:00:00'); // February 2026 (28 days, not a leap year)
    const rows: Row[] = [
      { created_at: '2026-02-01T00:00:00', value: 1 },
      { created_at: '2026-02-28T23:59:00', value: 2 },
      { created_at: '2026-03-01T00:00:00', value: 999 }, // next month, excluded
    ];
    const result = bucketByPeriod(rows, (r) => r.created_at, (r) => r.value, 'month', reference);
    expect(result).toHaveLength(28);
    expect(result[0].value).toBe(1);
    expect(result[27].value).toBe(2);
  });

  it('fills empty buckets with zero rather than omitting them', () => {
    const result = bucketByPeriod<Row>([], (r) => r.created_at, (r) => r.value, 'week', new Date('2026-08-09'));
    expect(result).toHaveLength(7);
    expect(result.every((p) => p.value === 0)).toBe(true);
  });
});

describe('shiftPeriod / isCurrentPeriod', () => {
  it('shifts a week reference back by 7 days', () => {
    const reference = new Date('2026-08-09T12:00:00');
    const prev = shiftPeriod('week', reference, -1);
    expect(prev.getDate()).toBe(2);
  });

  it('reports the present period as current, and a past one as not', () => {
    expect(isCurrentPeriod('day', new Date())).toBe(true);
    expect(isCurrentPeriod('day', new Date(Date.now() - 30 * 86_400_000))).toBe(false);
  });
});
