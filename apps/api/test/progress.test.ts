import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { RP_FEATURES, type ProgressResponse } from '../src/domain';
import { windowStart } from '../src/routes/progress';
import { seedDrill } from './route-helpers';

/**
 * Progress per RP feature: practice volume and clarity over time, never accent.
 * Rows are inserted directly so timestamps — and therefore day boundaries — are exact.
 */

let counter = 0;
async function attempt(
  drillId: string,
  createdAt: string,
  accuracy: number | null = 80,
  fluency: number | null = accuracy,
) {
  counter += 1;
  await env.DB.prepare(
    `INSERT INTO attempts (id, drill_id, created_at, accuracy_score, fluency_score,
                           word_scores, feature_verdicts)
     VALUES (?, ?, ?, ?, ?, '[]', '[]')`,
  )
    .bind(`a${counter}`, drillId, createdAt, accuracy, fluency)
    .run();
}

async function progress(query = ''): Promise<ProgressResponse> {
  const res = await app.request(`/api/progress${query}`, {}, env);
  expect(res.status).toBe(200);
  return (await res.json()) as ProgressResponse;
}

const feature = (body: ProgressResponse, name: string) =>
  body.features.find((f) => f.feature === name);

beforeEach(async () => {
  // A fixed "now" keeps the window boundaries deterministic.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-30T12:00:00.000Z'));

  await env.DB.prepare('DELETE FROM attempts').run();
  await env.DB.prepare('DELETE FROM drills').run();
  await seedDrill('bath-1', 'sentence', 'BATH');
  await seedDrill('bath-2', 'sentence', 'BATH');
  await seedDrill('lot-1', 'sentence', 'LOT');
});

afterEach(() => vi.useRealTimers());

describe('GET /api/progress', () => {
  it('labels what it measures, so nobody reads clarity as accent', async () => {
    expect((await progress()).measures).toBe('clarity');
  });

  it('lists every RP feature, including ones never practised', async () => {
    // "YOD has never been practised" is itself useful — an absent row would hide it.
    const body = await progress();

    expect(body.features.map((f) => f.feature)).toEqual([...RP_FEATURES]);
    expect(feature(body, 'YOD')).toMatchObject({ attempts: 0, days: [] });
  });

  it('groups attempts across every drill of the same feature', async () => {
    await attempt('bath-1', '2026-06-29T09:00:00.000Z', 70);
    await attempt('bath-2', '2026-06-29T10:00:00.000Z', 90);
    await attempt('lot-1', '2026-06-29T11:00:00.000Z', 50);

    const body = await progress();

    expect(feature(body, 'BATH')).toMatchObject({
      attempts: 2,
      days: [{ date: '2026-06-29', attempts: 2, averageAccuracy: 80 }],
    });
    expect(feature(body, 'LOT')?.attempts).toBe(1);
  });

  it('orders days oldest first, one entry per day', async () => {
    await attempt('bath-1', '2026-06-28T09:00:00.000Z', 60);
    await attempt('bath-1', '2026-06-26T09:00:00.000Z', 40);
    await attempt('bath-1', '2026-06-28T18:00:00.000Z', 80);

    const days = feature(await progress(), 'BATH')?.days ?? [];

    expect(days.map((d) => [d.date, d.attempts, d.averageAccuracy])).toEqual([
      ['2026-06-26', 1, 40],
      ['2026-06-28', 2, 70],
    ]);
  });

  it('breaks days at the client local midnight when given an offset', async () => {
    // 23:30 UTC on the 28th is 09:30 on the 29th at UTC+10. Bucketing in UTC would put an
    // evening session east of Greenwich on the wrong day.
    await attempt('bath-1', '2026-06-28T23:30:00.000Z');

    const utc = feature(await progress(), 'BATH')?.days[0]?.date;
    const local = feature(await progress('?tzOffsetMinutes=600'), 'BATH')?.days[0]?.date;
    expect(utc).toBe('2026-06-28');
    expect(local).toBe('2026-06-29');
  });

  it('moves an early-morning UTC session back a day for a client west of UTC', async () => {
    // 02:00 UTC on the 29th is 21:00 on the 28th at UTC-5. (A late-evening UTC time would
    // stay on the same date either way and prove nothing about the offset.)
    await attempt('bath-1', '2026-06-29T02:00:00.000Z');

    expect(feature(await progress(), 'BATH')?.days[0]?.date).toBe('2026-06-29');
    expect(feature(await progress('?tzOffsetMinutes=-300'), 'BATH')?.days[0]?.date).toBe(
      '2026-06-28',
    );
  });

  it('handles non-hour offsets', async () => {
    // UTC+5:45 (Nepal). 18:30 UTC on the 28th is 00:15 on the 29th.
    await attempt('bath-1', '2026-06-28T18:30:00.000Z');

    expect(feature(await progress('?tzOffsetMinutes=345'), 'BATH')?.days[0]?.date).toBe(
      '2026-06-29',
    );
  });

  it('excludes attempts outside the window', async () => {
    await attempt('bath-1', '2026-06-29T09:00:00.000Z');
    await attempt('bath-1', '2026-01-01T09:00:00.000Z');

    expect(feature(await progress(), 'BATH')?.attempts).toBe(1);
    expect(feature(await progress('?days=365'), 'BATH')?.attempts).toBe(2);
    expect((await progress('?days=7')).windowDays).toBe(7);
  });

  it('counts unscored attempts as practice without dragging the average to zero', async () => {
    // AVG ignores NULL, so a missing score is excluded rather than treated as 0.
    await attempt('bath-1', '2026-06-29T09:00:00.000Z', 80);
    await attempt('bath-1', '2026-06-29T10:00:00.000Z', null);

    const day = feature(await progress(), 'BATH')?.days[0];

    expect(day?.attempts).toBe(2);
    expect(day?.averageAccuracy).toBe(80);
  });

  it('rounds averages to one decimal place', async () => {
    await attempt('bath-1', '2026-06-29T09:00:00.000Z', 70);
    await attempt('bath-1', '2026-06-29T10:00:00.000Z', 71);
    await attempt('bath-1', '2026-06-29T11:00:00.000Z', 71);

    expect(feature(await progress(), 'BATH')?.days[0]?.averageAccuracy).toBe(70.7);
  });

  it('rejects out-of-range parameters', async () => {
    const bad = [
      '?days=0',
      '?days=366',
      '?days=abc',
      '?tzOffsetMinutes=900',
      '?tzOffsetMinutes=-800',
      '?tzOffsetMinutes=1.5',
    ];
    for (const query of bad) {
      expect((await app.request(`/api/progress${query}`, {}, env)).status, query).toBe(400);
    }
  });
});

describe('window of whole local days', () => {
  // "Now" in these tests is 2026-06-30T12:00Z.

  it('starts at local midnight, not at the current time of day minus N days', () => {
    // days=7 is today and the six days before it, each complete.
    expect(windowStart(Date.parse('2026-06-30T12:00:00.000Z'), 7, 0)).toBe(
      '2026-06-24T00:00:00.000Z',
    );
    // At UTC+10 local midnight on the 24th is 14:00 UTC on the 23rd.
    expect(windowStart(Date.parse('2026-06-30T12:00:00.000Z'), 7, 600)).toBe(
      '2026-06-23T14:00:00.000Z',
    );
  });

  it('includes the whole oldest day, so it does not read as a fall in practice', async () => {
    // Both on the oldest day of a 7-day window. Subtracting 7×24h from now would have
    // started at 12:00 on the 23rd and admitted only part of a different day.
    await attempt('bath-1', '2026-06-24T00:30:00.000Z');
    await attempt('bath-1', '2026-06-24T09:00:00.000Z');

    const days = feature(await progress('?days=7'), 'BATH')?.days ?? [];

    expect(days).toEqual([expect.objectContaining({ date: '2026-06-24', attempts: 2 })]);
  });

  it('excludes an attempt one millisecond before the window', async () => {
    await attempt('bath-1', '2026-06-23T23:59:59.999Z');
    await attempt('bath-1', '2026-06-24T00:00:00.000Z');

    expect(feature(await progress('?days=7'), 'BATH')?.attempts).toBe(1);
  });

  it('never returns more dates than the window has days', async () => {
    for (let d = 20; d <= 30; d++) {
      await attempt('bath-1', `2026-06-${d}T12:00:00.000Z`);
    }

    expect(feature(await progress('?days=7'), 'BATH')?.days).toHaveLength(7);
  });

  it('accepts the limits of days', async () => {
    expect((await progress('?days=1')).windowDays).toBe(1);
    expect((await progress('?days=365')).windowDays).toBe(365);
  });
});

describe('averages', () => {
  it('reports accuracy and fluency from their own columns', async () => {
    // Distinct values, so swapped columns would fail.
    await attempt('bath-1', '2026-06-29T09:00:00.000Z', 60, 90);

    expect(feature(await progress(), 'BATH')?.days[0]).toMatchObject({
      averageAccuracy: 60,
      averageFluency: 90,
    });
  });

  it('reports a null average for a day where nothing was scored', async () => {
    await attempt('bath-1', '2026-06-29T09:00:00.000Z', null);

    expect(feature(await progress(), 'BATH')?.days[0]).toMatchObject({
      attempts: 1,
      averageAccuracy: null,
    });
  });
});

describe('strict parameters', () => {
  it('rejects values that Number() would quietly accept', async () => {
    for (const query of ['?days=', '?days=1e2', '?days=0x10', '?tzOffsetMinutes=']) {
      expect((await app.request(`/api/progress${query}`, {}, env)).status, query).toBe(400);
    }
  });

  it('explains the offset sign in the error, since it is the opposite of JavaScript', async () => {
    const res = await app.request('/api/progress?tzOffsetMinutes=-840', {}, env);
    const { error } = (await res.json()) as { error: string };

    expect(error).toMatch(/east of UTC/);
    expect(error).toMatch(/getTimezoneOffset/);
  });
});

describe('unknown features', () => {
  it('logs attempts on a feature outside RP_FEATURES rather than dropping them silently', async () => {
    // Only reachable by a manual database edit: seed content is typed.
    await env.DB.prepare(
      `INSERT INTO drills
       (id, sentence, target_ipa, feature, difficulty, coaching_note, has_r_context, sort_order)
       VALUES ('odd', 's', 'x', 'STRUT', 4, 'n', 0, 1)`,
    ).run();
    await attempt('odd', '2026-06-29T09:00:00.000Z');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await progress();

    expect(logged.mock.calls.flat().join(' ')).toContain('STRUT');
    logged.mockRestore();
  });
});
