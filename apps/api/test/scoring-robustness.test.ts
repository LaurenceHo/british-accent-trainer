import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AzureScoringProvider } from '../src/scoring/azure';
import { ScoringError } from '../src/scoring/provider';
import fixture from './fixtures/azure-assessment.json';

/**
 * Error paths, retry timing and secret handling.
 *
 * Every case here was a real defect found in review: text silently mis-encoded, upstream
 * faults misreported as the learner's silence, unclassified crashes escaping the declared
 * error contract, and a backoff test that proved nothing.
 */

const CONFIG = { key: 'test-key-SECRET', region: 'testregion' };
const WAV = new ArrayBuffer(1024);

/** Stubs `fetch` with a fixed response. Parameters are declared so `mock.calls` is typed. */
function stubFetch(body: unknown, init: ResponseInit = { status: 200 }) {
  const spy = vi.fn(async (_input: unknown, _init?: unknown) =>
    typeof body === 'string'
      ? new Response(body, init)
      : new Response(JSON.stringify(body), init),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Runs an operation expected to reject, draining retry timers, and returns the error.
 *
 * Fails loudly if it resolves instead — otherwise a test asserting on `error.message`
 * would pass vacuously the day the operation stops failing.
 */
async function rejection(start: () => Promise<unknown>): Promise<Error> {
  const settled = start().then(
    () => {
      throw new Error('expected a rejection but the call resolved');
    },
    (error: unknown) => error as Error,
  );
  await vi.runAllTimersAsync();
  return settled;
}

describe('reference text encoding', () => {
  it('base64-encodes as UTF-8, not Latin-1', async () => {
    // btoa() operates on Latin-1 code units. Used directly, "café" is sent as byte 233
    // where Azure expects UTF-8 [195,169] — so the learner is scored against text they
    // were never shown, with no error raised. A curly apostrophe throws outright.
    const curly = '’';
    const text = `a café, don${curly}t stop`;

    const spy = stubFetch(fixture);
    await new AzureScoringProvider(CONFIG).assess(WAV, text);

    const init = spy.mock.calls[0]?.[1] as { headers: Record<string, string> };
    const header = init.headers['Pronunciation-Assessment'] ?? '';
    const bytes = Uint8Array.from(atob(header), (c) => c.charCodeAt(0));

    expect(JSON.parse(new TextDecoder().decode(bytes)).ReferenceText).toBe(text);
  });
});

describe('retry behaviour', () => {
  it('sends the audio intact on every attempt', async () => {
    // The retry path reuses one ArrayBuffer. A BufferSource body is copied rather than
    // transferred, so this is safe — but a later switch to a stream would break the
    // second attempt silently, and nothing else would catch it.
    const sizes: number[] = [];
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: unknown) => {
        sizes.push((init as { body: ArrayBuffer }).body.byteLength);
        calls += 1;
        return calls < 2
          ? new Response('rate limited', { status: 429 })
          : new Response(JSON.stringify(fixture), { status: 200 });
      }),
    );

    const assess = new AzureScoringProvider(CONFIG).assess(new ArrayBuffer(2048), 'hello');
    await vi.runAllTimersAsync();
    await assess;

    expect(sizes).toEqual([2048, 2048]);
  });

  it('waits the documented backoff rather than retrying immediately', async () => {
    // runAllTimersAsync() drains every timer regardless of duration, so it proves the
    // retry count but not the delay — it would pass with no backoff at all. Stepping the
    // clock pins the actual ladder.
    const spy = stubFetch('rate limited', { status: 429 });
    const assess = new AzureScoringProvider(CONFIG).assess(WAV, 'hello');
    const assertion = expect(assess).rejects.toMatchObject({ code: 'throttled' });

    await vi.advanceTimersByTimeAsync(499);
    expect(spy, 'must not retry before 500ms').toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(spy, 'first retry at 500ms').toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(spy, 'must not retry again before another 1000ms').toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(spy, 'second retry after 1000ms more').toHaveBeenCalledTimes(3);

    await vi.runAllTimersAsync();
    await assertion;
  });

  it('honours Retry-After in preference to the default ladder', async () => {
    let calls = 0;
    const spy = vi.fn(async () => {
      calls += 1;
      return calls < 2
        ? new Response('slow down', { status: 429, headers: { 'Retry-After': '3' } })
        : new Response(JSON.stringify(fixture), { status: 200 });
    });
    vi.stubGlobal('fetch', spy);

    const assess = new AzureScoringProvider(CONFIG).assess(WAV, 'hello');
    await vi.advanceTimersByTimeAsync(2999);
    expect(spy, 'Retry-After: 3 means wait 3s, not the default 500ms').toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(2);
    await assess;
  });
});

describe('failures stay inside the ScoringError contract', () => {
  it('classifies a non-JSON 200 body instead of throwing SyntaxError', async () => {
    // A proxy or WAF returning an HTML error page with status 200 lands here.
    stubFetch('<html>proxy error</html>', { status: 200 });

    await expect(new AzureScoringProvider(CONFIG).assess(WAV, 'hi')).rejects.toBeInstanceOf(
      ScoringError,
    );
  });

  it('survives a response whose Words is not an array', async () => {
    // `?? []` only guards null/undefined; a non-array survives it and dies on .map.
    stubFetch({ RecognitionStatus: 'Success', NBest: [{ Words: {} }] });

    expect((await new AzureScoringProvider(CONFIG).assess(WAV, 'hi')).words).toEqual([]);
  });

  it('classifies a transport failure instead of leaking a TypeError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Network connection lost.');
      }),
    );

    // A transport failure is retried (transient on Workers, and the caller cannot replay
    // the upload), so the clock must be advanced for the loop to exhaust.
    const pending = new AzureScoringProvider(CONFIG)
      .assess(WAV, 'hi')
      .catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const error = await pending;

    expect(error).toBeInstanceOf(ScoringError);
    expect((error as ScoringError).cause).toBeInstanceOf(TypeError);
  });
});

describe('recognition status classification', () => {
  it('treats RecognitionStatus Error as a retryable upstream fault, not silence', async () => {
    // Microsoft documents `Error` as the service's own internal fault, with "try again if
    // possible". Reporting it as not-recognised sends the learner off to re-record a
    // 30-second clip against a problem that is not theirs.
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return calls < 2
          ? new Response(JSON.stringify({ RecognitionStatus: 'Error' }), { status: 200 })
          : new Response(JSON.stringify(fixture), { status: 200 });
      }),
    );

    const assess = new AzureScoringProvider(CONFIG).assess(WAV, 'hi');
    await vi.runAllTimersAsync();

    expect((await assess).accuracy).toBe(100);
    expect(calls, 'should have retried rather than reported silence').toBe(2);
  });

  it('still reports genuine silence as not-recognised', async () => {
    for (const status of ['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout']) {
      stubFetch({ RecognitionStatus: status });
      await expect(
        new AzureScoringProvider(CONFIG).assess(WAV, 'hi'),
      ).rejects.toMatchObject({ code: 'not-recognised' });
    }
  });
});

describe('secret handling', () => {
  it('never puts the subscription key into an error message', async () => {
    for (const init of [{ status: 401 }, { status: 500 }, { status: 429 }]) {
      stubFetch(`upstream failure mentioning ${CONFIG.key}`, init);

      const error = await rejection(() => new AzureScoringProvider(CONFIG).assess(WAV, 'hi'));

      expect(error.message, `status ${init.status}`).not.toContain(CONFIG.key);
    }
  });

  it('keeps the key off enumerable properties so logging cannot leak it', () => {
    // `private` is a TypeScript-only modifier; the property would still be enumerable and
    // a stray console.log(provider) would print the key. An ES private field cannot be.
    const provider = new AzureScoringProvider(CONFIG);

    expect(JSON.stringify(provider)).not.toContain(CONFIG.key);
    expect(Object.values(provider)).not.toContain(CONFIG.key);
  });

  it('rejects a region that would send the key to another host', () => {
    // The region is interpolated into the request hostname, and the request carries the
    // subscription key.
    for (const region of ['evil.com/', 'a.b', 'UK South', '../x', '']) {
      expect(() => new AzureScoringProvider({ ...CONFIG, region })).toThrow(ScoringError);
    }
    expect(() => new AzureScoringProvider({ ...CONFIG, region: 'uksouth' })).not.toThrow();
  });

  it('truncates an unbounded upstream error body', async () => {
    stubFetch('x'.repeat(5000), { status: 500 });

    const error = await rejection(() => new AzureScoringProvider(CONFIG).assess(WAV, 'hi'));

    expect(error.message.length).toBeLessThan(400);
  });
});
