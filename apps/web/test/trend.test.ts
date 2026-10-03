import type { FeatureProgress } from '@api/domain';
import { describe, expect, it } from 'vitest';
import { daysBetween, describeTrend, trendPoints } from '@/progress/trend';
import { day } from './fixtures';

describe('daysBetween', () => {
  it('counts calendar days, across month and year ends', () => {
    expect(daysBetween('2026-01-30', '2026-02-02')).toBe(3);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-03-10', '2026-03-10')).toBe(0);
  });

  it('is not skewed by a daylight-saving change in between', () => {
    // UK clocks went forward on 29 March 2026.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
  });
});

describe('trendPoints', () => {
  it('places days by date across the window, today at the right edge', () => {
    // An 11-day window ending 2026-10-10 starts on 2026-09-30.
    const points = trendPoints(
      [day('2026-09-30', 50), day('2026-10-05', 60), day('2026-10-10', 70)],
      11,
      '2026-10-10',
    );

    expect(points.map((p) => p.x)).toEqual([0, 0.5, 1]);
    expect(points.map((p) => p.value)).toEqual([50, 60, 70]);
  });

  it('leaves out days with no score rather than plotting them at zero', () => {
    const points = trendPoints([day('2026-10-09', null), day('2026-10-10', 65)], 2, '2026-10-10');

    expect(points).toEqual([{ date: '2026-10-10', x: 1, value: 65 }]);
  });

  it('ignores days outside the window', () => {
    const points = trendPoints([day('2026-09-01', 40), day('2026-10-11', 40)], 7, '2026-10-10');

    expect(points).toEqual([]);
  });

  it('centres the only day of a one-day window', () => {
    expect(trendPoints([day('2026-10-10', 55)], 1, '2026-10-10')[0]!.x).toBe(0.5);
  });
});

describe('describeTrend', () => {
  const feature = (attempts: number): FeatureProgress => ({
    feature: 'BATH',
    label: 'TRAP–BATH split',
    attempts,
    days: [],
  });

  it('summarises the first and latest values', () => {
    const points = [
      { date: 'a', x: 0, value: 52 },
      { date: 'b', x: 0.5, value: 60 },
      { date: 'c', x: 1, value: 71 },
    ];

    expect(describeTrend(feature(5), points, 90)).toBe(
      'TRAP–BATH split clarity: 3 days practised, from 52 to 71.',
    );
  });

  it('says a single day plainly', () => {
    expect(describeTrend(feature(1), [{ date: 'a', x: 1, value: 64 }], 90)).toBe(
      'TRAP–BATH split clarity: 1 day practised, 64.',
    );
  });

  it('distinguishes never practised from practised without a score', () => {
    expect(describeTrend(feature(0), [], 90)).toBe(
      'TRAP–BATH split clarity: not practised in the last 90 days.',
    );
    expect(describeTrend(feature(2), [], 90)).toBe(
      'TRAP–BATH split clarity: practised, but no attempt produced a score.',
    );
  });
});
