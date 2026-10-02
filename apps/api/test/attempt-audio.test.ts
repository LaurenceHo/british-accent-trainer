import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import type { Attempt } from '../src/domain';
import { buildWav } from './build-wav';
import fixture from './fixtures/azure-assessment.json';

/**
 * Attempt audio: stored on successful submission, replayable afterwards.
 *
 * Replay against the reference is the app's core mechanism, so these assert the bytes
 * that come back are exactly the bytes that went in.
 */

function stubAzure(body: unknown, init: ResponseInit = { status: 200 }) {
  const spy = vi.fn(
    async (_input: unknown, _init?: unknown) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), init),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

async function clearAudio() {
  const listed = await env.AUDIO.list({ prefix: 'attempts/' });
  await Promise.all(listed.objects.map((o) => env.AUDIO.delete(o.key)));
}

function submit(body: ArrayBuffer, bindings: Env = env) {
  return app.request('/api/attempts?drillId=d1', { method: 'POST', body }, bindings);
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM attempts').run();
  await env.DB.prepare('DELETE FROM drills').run();
  await env.DB.prepare(
    `INSERT INTO drills
     (id, sentence, target_ipa, feature, difficulty, coaching_note, has_r_context, sort_order)
     VALUES ('d1', 'Pass me a glass of water', 'x', 'BATH', 4, 'note', 0, 1)`,
  ).run();
  await clearAudio();
});

afterEach(() => vi.unstubAllGlobals());

describe('storing attempt audio', () => {
  it('stores the recording and records its key on the attempt', async () => {
    stubAzure(fixture);

    const res = await submit(buildWav());
    const { attempt } = (await res.json()) as { attempt: Attempt };

    expect(attempt.audioKey).toBe(`attempts/${attempt.id}.wav`);
    expect(await env.AUDIO.head(attempt.audioKey ?? '')).not.toBeNull();
  });

  it('stores nothing when scoring fails', async () => {
    // A rejected recording should not occupy storage.
    stubAzure({ RecognitionStatus: 'NoMatch' });

    await submit(buildWav());

    expect((await env.AUDIO.list({ prefix: 'attempts/' })).objects).toHaveLength(0);
  });

  it('stores nothing for invalid audio', async () => {
    stubAzure(fixture);

    await submit(new ArrayBuffer(100));

    expect((await env.AUDIO.list({ prefix: 'attempts/' })).objects).toHaveLength(0);
  });

  it('still saves the attempt when the audio write fails', async () => {
    // The score has already been paid for; losing it to a storage hiccup would be worse
    // than losing replay for one attempt.
    stubAzure(fixture);
    const failingBucket = {
      put: async () => {
        throw new Error('R2 unavailable');
      },
    } as unknown as R2Bucket;

    const res = await submit(buildWav(), { ...env, AUDIO: failingBucket });
    const { attempt } = (await res.json()) as { attempt: Attempt };

    expect(res.status).toBe(201);
    expect(attempt.audioKey).toBeNull();
    const row = await env.DB.prepare('SELECT audio_key FROM attempts WHERE id = ?')
      .bind(attempt.id)
      .first<{ audio_key: string | null }>();
    expect(row).not.toBeNull();
    expect(row?.audio_key).toBeNull();
  });
});

describe('GET /api/attempts/:id/audio', () => {
  it('returns exactly the bytes that were submitted', async () => {
    stubAzure(fixture);
    const wav = buildWav({ dataBytes: 3_200 });
    new Uint8Array(wav).fill(7, 44);

    const { attempt } = (await (await submit(wav)).json()) as { attempt: Attempt };
    const res = await app.request(`/api/attempts/${attempt.id}/audio`, {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/wav');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(wav));
  });

  it('marks the audio private and immutable', async () => {
    // Private: it is the user's own voice. Immutable: the key is a fresh UUID per attempt.
    stubAzure(fixture);
    const { attempt } = (await (await submit(buildWav())).json()) as { attempt: Attempt };

    const res = await app.request(`/api/attempts/${attempt.id}/audio`, {}, env);
    await res.arrayBuffer();

    expect(res.headers.get('Cache-Control')).toContain('private');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
  });

  it('returns 404 for an unknown attempt', async () => {
    expect((await app.request('/api/attempts/nope/audio', {}, env)).status).toBe(404);
  });

  it('returns 404 when the attempt has no stored audio', async () => {
    await env.DB.prepare(
      `INSERT INTO attempts (id, drill_id, created_at, word_scores, feature_verdicts)
       VALUES ('no-audio', 'd1', '2026-01-01T00:00:00.000Z', '[]', '[]')`,
    ).run();

    expect((await app.request('/api/attempts/no-audio/audio', {}, env)).status).toBe(404);
  });

  it('returns 404 when the stored object has gone', async () => {
    stubAzure(fixture);
    const { attempt } = (await (await submit(buildWav())).json()) as { attempt: Attempt };
    await env.AUDIO.delete(attempt.audioKey ?? '');

    expect((await app.request(`/api/attempts/${attempt.id}/audio`, {}, env)).status).toBe(404);
  });
});
