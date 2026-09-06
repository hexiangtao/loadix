import { describe, expect, it } from 'vitest';
import { timeAgo } from './time';

const NOW = new Date('2026-09-06T12:00:00Z').getTime();

describe('timeAgo', () => {
  it('formats sub-minute as seconds / now', () => {
    expect(timeAgo(NOW - 0, 'en', NOW)).toBe('now');
    expect(timeAgo(NOW - 45_000, 'en', NOW)).toBe('45 seconds ago');
  });

  it('formats minutes and hours with numeric auto', () => {
    expect(timeAgo(NOW - 2 * 60_000, 'en', NOW)).toBe('2 minutes ago');
    expect(timeAgo(NOW - 60 * 60_000, 'en', NOW)).toBe('1 hour ago');
  });

  it('uses the supplied locale', () => {
    expect(timeAgo(NOW - 5 * 60_000, 'zh-CN', NOW)).toContain('分钟前');
    expect(timeAgo(NOW - 3 * 3600_000, 'fr', NOW)).toContain('heures');
  });

  it('falls back to an absolute date beyond two months', () => {
    const old = NOW - 90 * 86_400_000;
    const out = timeAgo(old, 'en', NOW);
    expect(out).toMatch(/\d{4}/); // contains a year — a date, not a duration
  });

  it('never shows future durations for slightly-ahead clocks', () => {
    expect(timeAgo(NOW + 5_000, 'en', NOW)).toBe('now');
  });
});