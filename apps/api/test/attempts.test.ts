import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import type { Attempt } from '../src/domain';
import fixture from './fixtures/azure-assessment.json';
import { buildWav } from './build-wav';

/**
 * End-to-end tests for recording submission: validation, scoring, persistence.
 *
 * `fetch` is stubbed so the whole route runs — validation, the provider, D1 — without
 * calling the live Azure API.
 */

function stubAzure(body: unknown, init: ResponseInit = { status: 200 }) {
  const spy = vi.fn(async (_input: unknown, _init?: unknown) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), init),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

async function seedDrill(id = 'test-drill', sentence = 'Pass me a glass of water') {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO drills
     (id, sentence, target_ipa, feature, difficulty, coaching_note, has_r_context, sort_order)
     VALUES (?, ?, 'x', 'BATH', 4, 'note', 0, 1)`,
  )
    .bind(id, sentence)
    .run();
}

async function countAttempts(): Promise<number | undefined> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM attempts').first<{ n: number }>();
  return row?.n;
}

function submit(body: ArrayBuffer, drillId = 'test-drill') {
  const query = drillId ? `?drillId=${drillId}` : '';
  return app.request(`/api/attempts${query}`, { method: 'POST', body }, env);
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM attempts').run();
  await env.DB.prepare('DELETE FROM drills').run();
  await seedDrill();
});

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/attempts', () => {
  it('scores a recording and persists the attempt', async () => {
    stubAzure(fixture);

    const res = await submit(buildWav());
    expect(res.status).toBe(201);

    const body = (await res.json()) as { attempt: Attempt; recognisedText: string };
    expect(body.attempt.accuracyScore).toBe(100);
    expect(body.attempt.drillId).toBe('test-drill');
    expect(body.attempt.wordScores.length).toBeGreaterThan(0);
    expect(body.recognisedText).toBe('Pass me a glass of water.');

    expect(await countAttempts()).toBe(1);
  });

  it('scores against the drill sentence, never client-supplied text', async () => {
    // Otherwise a caller could score themselves against whatever they liked.
    await seedDrill('other', 'The nurse heard the first word');
    const spy = stubAzure(fixture);

    await submit(buildWav(), 'other');

    const init = spy.mock.calls[0]?.[1] as { headers: Record<string, string> };
    const header = init.headers['Pronunciation-Assessment'] ?? '';
    const decoded = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(header), (ch) => ch.charCodeAt(0))),
    );

    expect(decoded.ReferenceText).toBe('The nurse heard the first word');
  });

  it('requires a drillId', async () => {
    const res = await submit(buildWav(), '');
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown drill, without calling the provider', async () => {
    const spy = stubAzure(fixture);

    expect((await submit(buildWav(), 'nope')).status).toBe(404);
    expect(spy, 'should not spend an API call on a drill that does not exist').not.toHaveBeenCalled();
  });

  it('rejects audio that is not a scorable WAV, without calling the provider', async () => {
    const spy = stubAzure(fixture);

    const res = await submit(new ArrayBuffer(500));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/WAV/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it('enforces the 30-second cap locally rather than upstream', async () => {
    const spy = stubAzure(fixture);

    const res = await submit(buildWav({ dataBytes: 32_000 * 31 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/30 seconds/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports unrecognised speech as a client error, not a server fault', async () => {
    stubAzure({ RecognitionStatus: 'NoMatch' });

    const res = await submit(buildWav());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('not-recognised');
  });

  it('reports throttling as retryable', async () => {
    stubAzure('rate limited', { status: 429 });

    // The provider retries internally; real timers keep this honest but brief.
    const res = await submit(buildWav());
    expect(res.status).toBe(503);
  }, 15_000);

  it('does not persist an attempt when scoring fails', async () => {
    stubAzure({ RecognitionStatus: 'NoMatch' });
    await submit(buildWav());

    expect(await countAttempts()).toBe(0);
  });
});

describe('GET /api/attempts', () => {
  it('lists attempts newest first', async () => {
    stubAzure(fixture);
    await submit(buildWav());
    await submit(buildWav());

    const res = await app.request('/api/attempts', {}, env);
    const body = (await res.json()) as { attempts: Attempt[] };

    expect(body.attempts).toHaveLength(2);
    const timestamps = body.attempts.map((a) => a.createdAt);
    expect(timestamps).toEqual([...timestamps].sort().reverse());
  });

  it('filters by drill', async () => {
    await seedDrill('other', 'Tom got a job in the shop');
    stubAzure(fixture);
    await submit(buildWav(), 'test-drill');
    await submit(buildWav(), 'other');

    const res = await app.request('/api/attempts?drillId=other', {}, env);
    const body = (await res.json()) as { attempts: Attempt[] };

    expect(body.attempts).toHaveLength(1);
    expect(body.attempts[0]?.drillId).toBe('other');
  });

  it('round-trips word scores through JSON storage', async () => {
    stubAzure(fixture);
    const created = (await (await submit(buildWav())).json()) as { attempt: Attempt };

    const res = await app.request(`/api/attempts/${created.attempt.id}`, {}, env);
    const fetched = (await res.json()) as Attempt;

    expect(fetched.wordScores).toEqual(created.attempt.wordScores);
    expect(fetched.wordScores[0]?.phonemes.length).toBeGreaterThan(0);
  });

  it('returns 404 for an unknown attempt', async () => {
    expect((await app.request('/api/attempts/nope', {}, env)).status).toBe(404);
  });
});
