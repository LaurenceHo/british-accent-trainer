import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { referenceAudioKey } from '../src/routes/reference-audio';
import { escapeXml } from '../src/tts/azure';
import { buildWav } from './build-wav';

/**
 * Reference audio: synthesise once, cache in R2, invalidate when the sentence changes.
 * `fetch` is stubbed; R2 is the real Miniflare binding.
 */

/** A genuine 16 kHz mono WAV: synthesis output is now validated before it is cached. */
const FAKE_WAV = buildWav({ dataBytes: 3_200 });

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

  it('treats existing entities as literal text', () => {
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

describe('validating synthesis output before caching', () => {
  // A 2xx says nothing about the body. Anything cached here is served for as long as the
  // sentence stays the same, so bad output must never reach R2.
  const cases: [string, () => Response][] = [
    ['an empty 200', () => new Response(new ArrayBuffer(0), { status: 200 })],
    [
      'a JSON error delivered with status 200',
      () =>
        new Response('{"error":"quota"}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ],
    ['a header-only WAV with no samples', () => new Response(buildWav({ dataBytes: 0 }))],
    ['audio at the wrong sample rate', () => new Response(buildWav({ sampleRate: 44_100 }))],
  ];

  for (const [name, respond] of cases) {
    it(`refuses ${name}: 502, and nothing cached`, async () => {
      vi.stubGlobal('fetch', vi.fn(async () => respond()));

      const res = await get('/api/drills/d1/reference-audio');

      expect(res.status).toBe(502);
      expect((await env.AUDIO.list({ prefix: 'reference/' })).objects).toHaveLength(0);
    });
  }

  it('turns a transport failure into a 502, not a 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Network connection lost.');
      }),
    );

    expect((await get('/api/drills/d1/reference-audio')).status).toBe(502);
  });

  it('turns a failure while reading the body into a 502, not a 500', async () => {
    const broken = new ReadableStream({
      pull(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(broken, { status: 200 })));

    expect((await get('/api/drills/d1/reference-audio')).status).toBe(502);
  });
});

describe('the request sent to Azure', () => {
  it('escapes drill text, routes the chosen voice, and targets the speech host', async () => {
    // escapeXml is unit-tested separately; this proves it is actually applied on the way
    // out. Deleting the call would otherwise leave every other test passing.
    await seedDrill('d1', `Tom & "Jerry" <b> it's`);
    const spy = stubTts();

    await get('/api/drills/d1/reference-audio?voice=en-GB-RyanNeural');

    const url = String(spy.mock.calls[0]?.[0]);
    const body = String((spy.mock.calls[0]?.[1] as { body: string }).body);

    expect(url).toBe('https://testregion.tts.speech.microsoft.com/cognitiveservices/v1');
    expect(body).toContain("name='en-GB-RyanNeural'");
    expect(body).toContain('Tom &amp; &quot;Jerry&quot; &lt;b&gt; it&apos;s');
    expect(body).not.toContain('<b>');
  });
});

describe('browser caching', () => {
  it('sends a revalidating ETag rather than a fixed max-age', async () => {
    // The URL is stable while the sentence can change; max-age would keep old wording.
    stubTts();
    const res = await get('/api/drills/d1/reference-audio');
    await res.arrayBuffer();

    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('ETag')).toMatch(/^".+"$/);
  });

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const spy = stubTts();
    const first = await get('/api/drills/d1/reference-audio');
    await first.arrayBuffer();

    const res = await app.request(
      '/api/drills/d1/reference-audio',
      { headers: { 'If-None-Match': first.headers.get('ETag') ?? '' } },
      env,
    );

    expect(res.status).toBe(304);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('changes the ETag when the sentence is edited, so the browser refetches', async () => {
    stubTts();
    const before = await get('/api/drills/d1/reference-audio');
    await before.arrayBuffer();

    await seedDrill('d1', 'Half past, after the dance');
    const res = await app.request(
      '/api/drills/d1/reference-audio',
      { headers: { 'If-None-Match': before.headers.get('ETag') ?? '' } },
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).not.toBe(before.headers.get('ETag'));
    await res.arrayBuffer();
  });

  it('still serves fresh audio when the cache write fails', async () => {
    stubTts();
    const failingBucket = {
      get: async () => null,
      put: async () => {
        throw new Error('R2 unavailable');
      },
    } as unknown as R2Bucket;

    const res = await app.request('/api/drills/d1/reference-audio', {}, { ...env, AUDIO: failingBucket });

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(FAKE_WAV));
  });
});
