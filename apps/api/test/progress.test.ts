import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { RP_FEATURES } from '../src/domain';
import type { ProgressResponse } from '../src/routes/progress';
import { seedDrill } from './route-helpers';

/**
 * Progress per RP feature: practice volume and clarity over time, never accent.
 * Rows are inserted directly so timestamps — and therefore day boundaries — are exact.
 */

let counter = 0;
async function attempt(drillId: string, createdAt: string, accuracy: number | null = 80) {
  counter += 1;
  await env.DB.prepare(
    `INSERT INTO attempts (id, drill_id, created_at, accuracy_score, fluency_score,
                           word_scores, feature_verdicts)
     VALUES (?, ?, ?, ?, ?, '[]', '[]')`,
  )
    .bind(`a${counter}`, drillId, createdAt, accuracy, accuracy)
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
    const west = feature(await progress('?tzOffsetMinutes=-300'), 'BATH')?.days[0]?.date;

    expect(utc).toBe('2026-06-28');
    expect(local).toBe('2026-06-29');
    expect(west).toBe('2026-06-28');
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
