import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { referenceAudioKey } from '../src/routes/reference-audio';
import { escapeXml } from '../src/tts/azure';

/**
 * Reference audio: synthesise once, cache in R2, invalidate when the sentence changes.
 * `fetch` is stubbed; R2 is the real Miniflare binding.
 */

const FAKE_WAV = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]).buffer;

function stubTts(init: ResponseInit = { status: 200 }) {
  const spy = vi.fn(async (_input: unknown, _init?: unknown) =>
    init.status === 200 ? new Response(FAKE_WAV, init) : new Response('nope', init),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

async function seedDrill(id = 'd1', sentence = 'Ask the class about the bath') {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO drills
     (id, sentence, target_ipa, feature, difficulty, coaching_note, has_r_context, sort_order)
     VALUES (?, ?, 'x', 'BATH', 4, 'note', 0, 1)`,
  )
    .bind(id, sentence)
    .run();
}

const get = (path: string) => app.request(path, {}, env);

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM drills').run();
  const listed = await env.AUDIO.list({ prefix: 'reference/' });
  await Promise.all(listed.objects.map((o) => env.AUDIO.delete(o.key)));
  await seedDrill();
});

afterEach(() => vi.unstubAllGlobals());

describe('GET /api/drills/:id/reference-audio', () => {
  it('synthesises on first request and stores the result in R2', async () => {
    const spy = stubTts();

    const res = await get('/api/drills/d1/reference-audio');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/wav');
    expect(res.headers.get('X-Reference-Cache')).toBe('MISS');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(FAKE_WAV));
    expect(spy).toHaveBeenCalledTimes(1);

    const key = await referenceAudioKey('d1', 'Ask the class about the bath', 'en-GB-SoniaNeural');
    expect(await env.AUDIO.head(key)).not.toBeNull();
  });

  it('serves from R2 on the second request without calling Azure', async () => {
    const spy = stubTts();
    await (await get('/api/drills/d1/reference-audio')).arrayBuffer();

    const res = await get('/api/drills/d1/reference-audio');

    expect(res.headers.get('X-Reference-Cache')).toBe('HIT');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(FAKE_WAV));
    expect(spy, 'the second request must not spend a synthesis').toHaveBeenCalledTimes(1);
  });

  it('re-synthesises when the drill sentence is edited', async () => {
    // The key embeds a hash of the sentence, so stale audio of old wording is never served.
    const spy = stubTts();
    await (await get('/api/drills/d1/reference-audio')).arrayBuffer();

    await seedDrill('d1', 'Half past, after the dance');
    const res = await get('/api/drills/d1/reference-audio');

    expect(res.headers.get('X-Reference-Cache')).toBe('MISS');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('requests 16 kHz mono PCM so reference and recording share a format', async () => {
    const spy = stubTts();
    await get('/api/drills/d1/reference-audio');

    const init = spy.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers['X-Microsoft-OutputFormat']).toBe('riff-16khz-16bit-mono-pcm');
  });

  it('caches each voice separately', async () => {
    const spy = stubTts();
    await (await get('/api/drills/d1/reference-audio?voice=en-GB-SoniaNeural')).arrayBuffer();
    await (await get('/api/drills/d1/reference-audio?voice=en-GB-RyanNeural')).arrayBuffer();

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('rejects a voice outside the whitelist, without calling Azure', async () => {
    // The voice reaches SSML and the R2 key; a passthrough would allow markup injection
    // and let callers fill the bucket with arbitrary objects.
    const spy = stubTts();

    for (const voice of ['en-US-JennyNeural', "x'/><voice name='y", '../../etc']) {
      const res = await get(`/api/drills/d1/reference-audio?voice=${encodeURIComponent(voice)}`);
      expect(res.status, voice).toBe(400);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown drill without calling Azure', async () => {
    const spy = stubTts();

    expect((await get('/api/drills/nope/reference-audio')).status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns 502 and caches nothing when synthesis fails', async () => {
    stubTts({ status: 500 });

    const res = await get('/api/drills/d1/reference-audio');
    expect(res.status).toBe(502);

    const listed = await env.AUDIO.list({ prefix: 'reference/' });
    expect(listed.objects, 'a failure must not poison the cache').toHaveLength(0);
  });

  it('does not leak the upstream error body or the key to the client', async () => {
    stubTts({ status: 401 });

    const body = await (await get('/api/drills/d1/reference-audio')).text();
    expect(body).not.toContain(env.AZURE_SPEECH_KEY);
    expect(body).not.toContain('nope');
  });
});

describe('escapeXml', () => {
  it('escapes every character that is significant in SSML', () => {
    // Drill text is hand-edited content and could contain any of these.
    expect(escapeXml(`Tom & Jerry's "<tag>"`)).toBe(
      'Tom &amp; Jerry&apos;s &quot;&lt;tag&gt;&quot;',
    );
  });

  it('escapes ampersands first so existing entities are not double-unescaped', () => {
    expect(escapeXml('&lt;')).toBe('&amp;lt;');
  });
});

describe('configuration', () => {
  it('returns 503 on a cache miss when Azure is not configured, without calling it', async () => {
    const spy = stubTts();

    const res = await app.request(
      '/api/drills/d1/reference-audio',
      {},
      { ...env, AZURE_SPEECH_REGION: undefined },
    );

    expect(res.status).toBe(503);
    expect(spy).not.toHaveBeenCalled();
  });

  it('still serves cached audio when credentials are missing', async () => {
    stubTts();
    await (await get('/api/drills/d1/reference-audio')).arrayBuffer();

    const res = await app.request(
      '/api/drills/d1/reference-audio',
      {},
      { ...env, AZURE_SPEECH_KEY: undefined },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Reference-Cache')).toBe('HIT');
  });
});
