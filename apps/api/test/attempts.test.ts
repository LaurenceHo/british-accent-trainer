import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import type { Attempt } from '../src/domain';
import fixture from './fixtures/azure-assessment.json';
import { buildWav } from './build-wav';
import { seedDrill, stubAzure } from './route-helpers';

/**
 * End-to-end tests for recording submission: validation, scoring, persistence.
 *
 * `fetch` is stubbed so the whole route runs — validation, the provider, D1 — without
 * calling the live Azure API.
 */

async function countAttempts(): Promise<number | undefined> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM attempts').first<{ n: number }>();
  return row?.n;
}

/** Inserts an attempt row directly, so ordering tests control the timestamps. */
async function insertAttempt(id: string, createdAt: string, wordScores = '[]') {
  await env.DB.prepare(
    `INSERT INTO attempts (id, drill_id, created_at, word_scores, feature_verdicts)
     VALUES (?, 'test-drill', ?, ?, '[]')`,
  )
    .bind(id, createdAt, wordScores)
    .run();
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

  it('reports throttling as retryable, after the provider has retried', async () => {
    // Retry-After: 0 keeps the test fast without fake timers. Asserting the call count
    // matters: without it, a change that dropped retries entirely would still pass.
    const spy = vi.fn(
      async () => new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } }),
    );
    vi.stubGlobal('fetch', spy);

    const res = await submit(buildWav());

    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('throttled');
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('rejects an oversized upload with 413 before scoring', async () => {
    const spy = stubAzure(fixture);

    const res = await submit(new ArrayBuffer(2 * 1024 * 1024 + 1));

    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns 503 when Azure is not configured, and never calls it', async () => {
    // A missing secret is `undefined` at runtime, and a bare regex test accepts it:
    // `/^[a-z0-9-]+$/.test(undefined)` is true. Without an explicit check this would call
    // `undefined.stt.speech.microsoft.com` and report the DNS failure as an upstream fault.
    const spy = stubAzure(fixture);

    for (const missing of ['AZURE_SPEECH_REGION', 'AZURE_SPEECH_KEY'] as const) {
      const res = await app.request(
        '/api/attempts?drillId=test-drill',
        { method: 'POST', body: buildWav() },
        { ...env, [missing]: undefined },
      );
      expect(res.status, missing).toBe(503);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('gives the client a fixed message, not the upstream error text', async () => {
    // The provider's message carries the vendor, upstream status and part of the upstream
    // body. That belongs in the server log, not in the browser.
    stubAzure('Access denied due to invalid subscription key or wrong API endpoint.', {
      status: 401,
    });

    const res = await submit(buildWav());
    const body = (await res.json()) as { error: string; code: string };

    expect(res.status).toBe(502);
    expect(body.code).toBe('unauthorised');
    expect(body.error).not.toMatch(/azure|401|subscription|endpoint/i);
  });

  it('does not persist an attempt when scoring fails', async () => {
    stubAzure({ RecognitionStatus: 'NoMatch' });
    await submit(buildWav());

    expect(await countAttempts()).toBe(0);
  });
});

describe('GET /api/attempts', () => {
  it('lists attempts newest first', async () => {
    // Fixed, distinct timestamps. Two real submissions can land in the same millisecond,
    // and then an ordering assertion passes whatever the order.
    await insertAttempt('older', '2026-01-01T00:00:00.000Z');
    await insertAttempt('newest', '2026-03-01T00:00:00.000Z');
    await insertAttempt('middle', '2026-02-01T00:00:00.000Z');

    const res = await app.request('/api/attempts', {}, env);
    const body = (await res.json()) as { attempts: Attempt[] };

    expect(body.attempts.map((a) => a.id)).toEqual(['newest', 'middle', 'older']);
  });

  it('breaks timestamp ties by id so the order is stable', async () => {
    await insertAttempt('a', '2026-01-01T00:00:00.000Z');
    await insertAttempt('b', '2026-01-01T00:00:00.000Z');

    const res = await app.request('/api/attempts', {}, env);
    const body = (await res.json()) as { attempts: Attempt[] };

    expect(body.attempts.map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('bounds the list, defaulting to 50 and honouring ?limit', async () => {
    for (let i = 0; i < 55; i++) {
      await insertAttempt(`a${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString());
    }

    const all = (await (await app.request('/api/attempts', {}, env)).json()) as {
      attempts: Attempt[];
    };
    const three = (await (await app.request('/api/attempts?limit=3', {}, env)).json()) as {
      attempts: Attempt[];
    };

    expect(all.attempts).toHaveLength(50);
    expect(three.attempts).toHaveLength(3);
  });

  it('rejects an out-of-range limit', async () => {
    for (const bad of ['0', '201', 'abc', '2.5']) {
      expect((await app.request(`/api/attempts?limit=${bad}`, {}, env)).status, bad).toBe(400);
    }
  });

  it('survives an unreadable stored row rather than failing the whole list', async () => {
    await insertAttempt('good', '2026-01-02T00:00:00.000Z');
    await insertAttempt('bad', '2026-01-01T00:00:00.000Z', '{not json');

    const res = await app.request('/api/attempts', {}, env);
    const body = (await res.json()) as { attempts: Attempt[] };

    expect(res.status).toBe(200);
    expect(body.attempts.find((a) => a.id === 'bad')?.wordScores).toEqual([]);
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
