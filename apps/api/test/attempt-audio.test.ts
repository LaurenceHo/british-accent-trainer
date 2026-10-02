import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import type { Attempt } from '../src/domain';
import { buildWav } from './build-wav';
import fixture from './fixtures/azure-assessment.json';
import { seedDrill, stubAzure } from './route-helpers';

/**
 * Attempt audio: stored on successful submission, replayable afterwards.
 *
 * Replay against the reference is the app's core mechanism, so these assert the bytes
 * that come back are exactly the bytes that went in.
 */

async function storedAudioKeys(): Promise<string[]> {
  const listed = await env.AUDIO.list({ prefix: 'attempts/' });
  return listed.objects.map((o) => o.key);
}

function submit(body: ArrayBuffer, bindings: Env = env) {
  return app.request('/api/attempts?drillId=test-drill', { method: 'POST', body }, bindings);
}

/** Submits a recording that scores successfully and returns the saved attempt. */
async function submitScored(wav: ArrayBuffer = buildWav()): Promise<Attempt> {
  stubAzure(fixture);
  const { attempt } = (await (await submit(wav)).json()) as { attempt: Attempt };
  return attempt;
}

function getAudio(attemptId: string) {
  return app.request(`/api/attempts/${attemptId}/audio`, {}, env);
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM attempts').run();
  await env.DB.prepare('DELETE FROM drills').run();
  await seedDrill();
  await Promise.all((await storedAudioKeys()).map((key) => env.AUDIO.delete(key)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('storing attempt audio', () => {
  it('stores the recording and records its key on the attempt', async () => {
    const attempt = await submitScored();

    expect(attempt.audioKey).toBe(`attempts/${attempt.id}.wav`);
    expect(await env.AUDIO.head(attempt.audioKey ?? '')).not.toBeNull();
  });

  it('stores nothing when scoring fails', async () => {
    // A rejected recording should not occupy storage. The status is asserted so the test
    // cannot pass because the request failed earlier for some unrelated reason.
    stubAzure({ RecognitionStatus: 'NoMatch' });

    const res = await submit(buildWav());

    expect(res.status).toBe(400);
    expect(await storedAudioKeys()).toHaveLength(0);
  });

  it('stores nothing for invalid audio', async () => {
    stubAzure(fixture);

    const res = await submit(new ArrayBuffer(100));

    expect(res.status).toBe(400);
    expect(await storedAudioKeys()).toHaveLength(0);
  });

  it('still saves the attempt when the audio write fails, and says so', async () => {
    // The score has already been paid for; losing it to a storage hiccup would be worse
    // than losing replay for one attempt.
    stubAzure(fixture);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failingBucket = {
      put: async () => {
        throw new Error('R2 unavailable');
      },
    } as unknown as R2Bucket;

    const res = await submit(buildWav(), { ...env, AUDIO: failingBucket });
    const { attempt, audioStored } = (await res.json()) as {
      attempt: Attempt;
      audioStored: boolean;
    };

    expect(res.status).toBe(201);
    expect(audioStored, 'the client must be able to warn that replay is unavailable').toBe(
      false,
    );
    expect(logged.mock.calls.flat().join(' ')).toContain(attempt.id);
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
    const wav = buildWav({ dataBytes: 3_200 });
    new Uint8Array(wav).fill(7, 44);

    const attempt = await submitScored(wav);
    const res = await getAudio(attempt.id);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/wav');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(wav));
  });

  it('marks the audio private and immutable', async () => {
    // Private: it is the user's own voice. Immutable: the key is a fresh UUID per attempt.
    const attempt = await submitScored();

    const res = await getAudio(attempt.id);
    await res.arrayBuffer();

    expect(res.headers.get('Cache-Control')).toContain('private');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
  });

  it('returns 404 for an unknown attempt', async () => {
    expect((await getAudio('nope')).status).toBe(404);
  });

  it('returns 404 when the attempt has no stored audio', async () => {
    await env.DB.prepare(
      `INSERT INTO attempts (id, drill_id, created_at, word_scores, feature_verdicts)
       VALUES ('no-audio', 'test-drill', '2026-01-01T00:00:00.000Z', '[]', '[]')`,
    ).run();

    expect((await getAudio('no-audio')).status).toBe(404);
  });

  it('returns 404 when the stored object has gone', async () => {
    const attempt = await submitScored();
    await env.AUDIO.delete(attempt.audioKey ?? '');

    expect((await getAudio(attempt.id)).status).toBe(404);
  });
});

describe('failure modes that must not pass silently', () => {
  it('returns 503 for a missing AUDIO binding, before spending a scoring call', async () => {
    // A missing binding is a deploy error. Swallowed like a transient R2 failure, every
    // submission would return 201 with replay silently dead.
    const spy = stubAzure(fixture);

    const res = await submit(buildWav(), { ...env, AUDIO: undefined as unknown as R2Bucket });

    expect(res.status).toBe(503);
    expect(spy).not.toHaveBeenCalled();
  });

  it('removes the stored audio when the attempt row cannot be saved', async () => {
    // Without a row the audio has no handle: unreachable through the API, and invisible to
    // any future "delete my recordings" feature.
    stubAzure(fixture);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = new Proxy(env.DB, {
      get(target, prop, receiver) {
        if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
        return (sql: string) => {
          if (sql.includes('INSERT INTO attempts')) throw new Error('D1 unavailable');
          return target.prepare(sql);
        };
      },
    });

    const res = await submit(buildWav(), { ...env, DB: db });

    expect(res.status).toBe(500);
    expect(await storedAudioKeys(), 'audio with no row must not be left behind').toHaveLength(0);
  });

  it('serves audio with nosniff, since only the header was validated', async () => {
    const attempt = await submitScored();

    const res = await getAudio(attempt.id);
    await res.arrayBuffer();

    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
