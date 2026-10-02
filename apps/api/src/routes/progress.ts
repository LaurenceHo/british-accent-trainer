import { Hono } from 'hono';
import { RP_FEATURE_LABELS, RP_FEATURES, type RpFeature } from '../domain';
import type { Env } from '../types';

/**
 * Practice progress, grouped by RP feature.
 *
 * What this measures, precisely: **how much each feature has been practised**, and the
 * **clarity** of those attempts over time. It does not measure how British anything
 * sounds — no available scoring API can, see `spike/FINDINGS.md`. The response carries
 * `measures: 'clarity'` so a client cannot mistake the averages for an accent score.
 *
 * Grouping by feature rather than one global average is deliberate: "LOT is getting
 * practised, YOD never is" is actionable, and a single number is not.
 */

const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 365;

/** Real-world UTC offsets span -12:00 to +14:00. */
const MIN_TZ_OFFSET_MINUTES = -12 * 60;
const MAX_TZ_OFFSET_MINUTES = 14 * 60;

/** One day's practice on one feature. */
export interface DailyProgress {
  /** Calendar date in the requested timezone, `YYYY-MM-DD`. */
  readonly date: string;
  readonly attempts: number;
  /** Mean clarity accuracy, 0-100, or null if no attempt that day produced a score. */
  readonly averageAccuracy: number | null;
  readonly averageFluency: number | null;
}

/** Progress on one RP feature. */
export interface FeatureProgress {
  readonly feature: RpFeature;
  readonly label: string;
  /** Total attempts in the window. Zero means the feature has not been practised. */
  readonly attempts: number;
  /** Oldest first, one entry per day with at least one attempt. */
  readonly days: readonly DailyProgress[];
}

export interface ProgressResponse {
  /** Always `clarity`: the averages measure intelligibility, never accent. */
  readonly measures: 'clarity';
  readonly windowDays: number;
  /** Every RP feature, including unpractised ones, in a fixed order. */
  readonly features: readonly FeatureProgress[];
}

interface DayRow {
  readonly feature: string;
  readonly day: string;
  readonly attempts: number;
  readonly accuracy: number | null;
  readonly fluency: number | null;
}

/** Parses an optional integer query parameter within inclusive bounds. */
function intParam(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** Rounds to one decimal place, keeping null as null. */
function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

const progress = new Hono<{ Bindings: Env }>();

/**
 * Returns practice progress per RP feature.
 *
 * Query parameters:
 * - `days` — window size, 1 to 365, default 90.
 * - `tzOffsetMinutes` — the client's UTC offset, so days break at local midnight. Without
 *   it, an evening practice session east of UTC splits across two "days". Default 0.
 */
progress.get('/', async (c) => {
  const windowDays = intParam(c.req.query('days'), DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS);
  if (windowDays === null) {
    return c.json({ error: `days must be an integer from 1 to ${MAX_WINDOW_DAYS}` }, 400);
  }

  const tzOffset = intParam(
    c.req.query('tzOffsetMinutes'),
    0,
    MIN_TZ_OFFSET_MINUTES,
    MAX_TZ_OFFSET_MINUTES,
  );
  if (tzOffset === null) {
    return c.json({ error: 'tzOffsetMinutes must be an integer from -720 to 840' }, 400);
  }

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const shift = `${tzOffset >= 0 ? '+' : ''}${tzOffset} minutes`;

  // `shift` is built from a validated integer, but it is still bound, never interpolated.
  const { results } = await c.env.DB.prepare(
    `SELECT d.feature                       AS feature,
            date(a.created_at, ?)           AS day,
            COUNT(*)                        AS attempts,
            AVG(a.accuracy_score)           AS accuracy,
            AVG(a.fluency_score)            AS fluency
       FROM attempts a
       JOIN drills d ON d.id = a.drill_id
      WHERE a.created_at >= ?
      GROUP BY d.feature, day
      ORDER BY day`,
  )
    .bind(shift, since)
    .all<DayRow>();

  const byFeature = new Map<string, DailyProgress[]>();
  for (const row of results) {
    const days = byFeature.get(row.feature) ?? [];
    days.push({
      date: row.day,
      attempts: row.attempts,
      averageAccuracy: round1(row.accuracy),
      averageFluency: round1(row.fluency),
    });
    byFeature.set(row.feature, days);
  }

  const body: ProgressResponse = {
    measures: 'clarity',
    windowDays,
    features: RP_FEATURES.map((feature) => {
      const days = byFeature.get(feature) ?? [];
      return {
        feature,
        label: RP_FEATURE_LABELS[feature],
        attempts: days.reduce((sum, d) => sum + d.attempts, 0),
        days,
      };
    }),
  };

  return c.json(body);
});

export default progress;
