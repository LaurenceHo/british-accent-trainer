import { Hono } from 'hono';
import { RP_FEATURE_LABELS, RP_FEATURES } from '../domain';
import type { DailyProgress, Env, ProgressResponse } from '../types';

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
 *
 * Known limitation: one fixed UTC offset is applied across the whole window, so on days
 * observed under the other daylight-saving offset, attempts in the hour around midnight
 * can land on the neighbouring date. Bucketing by IANA zone would fix it; at one hour of
 * a practice day it has not been worth the cost.
 */

const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Real-world UTC offsets span -12:00 to +14:00. */
const MIN_TZ_OFFSET_MINUTES = -12 * 60;
const MAX_TZ_OFFSET_MINUTES = 14 * 60;

interface DayRow {
  readonly feature: string;
  readonly day: string;
  readonly attempts: number;
  readonly accuracy: number | null;
  readonly fluency: number | null;
}

/**
 * Parses an optional integer query parameter within inclusive bounds.
 *
 * Strict digits only: `Number()` alone would accept `''` as 0 and `1e2` as 100.
 */
function intParam(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (raw === undefined) return fallback;
  if (!/^-?\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

/** Rounds to one decimal place, keeping null as null. */
function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

/**
 * The UTC instant at which a window of `days` whole local days begins.
 *
 * "Last 7 days" means today plus the six before it, each complete. Subtracting 7 × 24h
 * from now would instead start part-way through a day: the oldest bucket would hold only
 * the hours after the current time of day, reading as a fall in practice, and seven days
 * would span eight dates.
 *
 * @param now - Current time, in milliseconds since the epoch.
 * @param days - Window length in whole local days, today included.
 * @param offsetMinutes - Minutes east of UTC.
 */
export function windowStart(now: number, days: number, offsetMinutes: number): string {
  const offsetMs = offsetMinutes * 60 * 1000;
  const localMidnightToday = Math.floor((now + offsetMs) / DAY_MS) * DAY_MS;
  const localStart = localMidnightToday - (days - 1) * DAY_MS;
  return new Date(localStart - offsetMs).toISOString();
}

const progress = new Hono<{ Bindings: Env }>();

/**
 * Returns practice progress per RP feature.
 *
 * Query parameters:
 * - `days` — whole local days to cover, today included. 1 to 365, default 90.
 * - `tzOffsetMinutes` — the client's offset in **minutes east of UTC**, so days break at
 *   local midnight. UTC+10 is `600`, UTC-5 is `-300`. Note this is the **negation** of
 *   JavaScript's `Date.prototype.getTimezoneOffset()`, which counts minutes west. Default 0.
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
    return c.json(
      {
        error:
          `tzOffsetMinutes must be minutes east of UTC, an integer from ` +
          `${MIN_TZ_OFFSET_MINUTES} to ${MAX_TZ_OFFSET_MINUTES} ` +
          `(the negation of Date.prototype.getTimezoneOffset())`,
      },
      400,
    );
  }

  const since = windowStart(Date.now(), windowDays, tzOffset);
  const shift = `${tzOffset} minutes`;

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
      ORDER BY day, d.feature`,
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

  // Content cannot introduce an unknown feature — `Drill.feature` is typed, so seed data
  // fails to compile first — but a manual database edit can. Those attempts would vanish
  // from every total, so say so rather than drop them silently.
  const known = new Set<string>(RP_FEATURES);
  const unknown = [...byFeature.keys()].filter((f) => !known.has(f));
  if (unknown.length > 0) {
    console.error(`progress: attempts on unknown features omitted: ${unknown.join(', ')}`);
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
