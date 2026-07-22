import { describe, expect, it } from 'vitest';
import { cn, formatCurrency, formatDate, formatTimeAgo } from './utils';

describe('formatCurrency', () => {
  it('formats a peso amount with the currency symbol', () => {
    expect(formatCurrency(1234.5)).toContain('1,234.50');
    expect(formatCurrency(0)).toContain('0.00');
  });
});

describe('formatDate', () => {
  it('formats an ISO date as a short readable date', () => {
    expect(formatDate('2026-08-01T00:00:00.000Z')).toMatch(/2026/);
  });
});

describe('formatTimeAgo', () => {
  it('reports "Just now" for a timestamp seconds ago', () => {
    expect(formatTimeAgo(new Date(Date.now() - 5_000).toISOString())).toBe('Just now');
  });

  it('reports minutes ago within the first hour', () => {
    expect(formatTimeAgo(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5m ago');
  });

  it('reports hours ago within the first day', () => {
    expect(formatTimeAgo(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('3h ago');
  });

  it('reports days ago within the first week', () => {
    expect(formatTimeAgo(new Date(Date.now() - 2 * 86_400_000).toISOString())).toBe('2d ago');
  });

  it('falls back to a formatted date beyond a week', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000).toISOString();
    expect(formatTimeAgo(eightDaysAgo)).toBe(formatDate(eightDaysAgo));
  });
});

describe('cn', () => {
  it('merges class names and resolves Tailwind conflicts', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    const isHidden = false;
    expect(cn('text-sm', isHidden && 'hidden', 'font-bold')).toBe('text-sm font-bold');
  });
});
