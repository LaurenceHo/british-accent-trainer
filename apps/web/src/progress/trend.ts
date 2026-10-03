import type { DailyProgress, FeatureProgress } from '@api/domain';

/**
 * Placing a feature's daily clarity on a chart that spans the whole progress window.
 * Pure, so the date arithmetic is tested with known dates rather than by eye.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A date as `YYYY-MM-DD` in the learner's local calendar — the API's day boundary. */
export function localDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Calendar days, so DST cannot skew it. */
export function daysBetween(from: string, to: string): number {
  const utc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** One scored day, placed on the chart. */
export interface TrendPoint {
  readonly date: string;
  /** Across the window, 0 at its first day and 1 at today. */
  readonly x: number;
  /** Mean clarity that day, 0–100. */
  readonly value: number;
}

/**
 * Places each scored day across the window, so a gap in practice shows as a gap.
 *
 * @param days - The feature's days, oldest first, as returned by the API.
 * @param windowDays - The window's length in days, today included.
 * @param today - Today's local date, `YYYY-MM-DD`.
 * @returns Points for days that have a score and fall inside the window.
 */
export function trendPoints(
  days: readonly DailyProgress[],
  windowDays: number,
  today: string,
): TrendPoint[] {
  const span = windowDays - 1;
  const points: TrendPoint[] = [];
  for (const day of days) {
    if (day.averageAccuracy === null) continue;
    const fromEnd = daysBetween(day.date, today);
    if (fromEnd < 0 || fromEnd > span) continue;
    // A one-day window has nowhere to spread to: centre its only day.
    points.push({ date: day.date, x: span === 0 ? 0.5 : (span - fromEnd) / span, value: day.averageAccuracy });
  }
  return points;
}

/**
 * A sentence describing a feature's trend, used as the chart's accessible name so the
 * line's meaning does not depend on seeing it.
 *
 * @param feature - The feature's progress.
 * @param points - Its points, from {@link trendPoints}.
 * @param windowDays - The window's length in days.
 */
export function describeTrend(
  feature: FeatureProgress,
  points: readonly TrendPoint[],
  windowDays: number,
): string {
  const name = `${feature.label} clarity`;
  if (feature.attempts === 0) return `${name}: not practised in the last ${windowDays} days.`;
  if (points.length === 0) return `${name}: practised, but no attempt produced a score.`;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (points.length === 1) return `${name}: 1 day practised, ${first.value}.`;
  return `${name}: ${points.length} days practised, from ${first.value} to ${last.value}.`;
}
