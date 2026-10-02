import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AzureScoringProvider, toClarityAssessment } from '../src/scoring/azure';
import { ScoringError } from '../src/scoring/provider';
import fixture from './fixtures/azure-assessment.json';

/**
 * Mocked at the HTTP boundary, against a response genuinely captured from the live API
 * (`spike/results/raw.json`). The suite must never call Azure: it costs money and the free
 * tier allows one concurrent request, which would make tests flaky.
 */

const CONFIG = { key: 'test-key', region: 'testregion' };
const WAV = new ArrayBuffer(1024);

/** Stubs `fetch` with a fixed response. Returns the spy so calls can be asserted. */
function stubFetch(body: unknown, init: ResponseInit = { status: 200 }) {
  // Parameters are declared so `mock.calls` is a typed 2-tuple rather than empty.
  const spy = vi.fn(
    async (_input: unknown, _init?: unknown) => new Response(JSON.stringify(body), init),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('toClarityAssessment', () => {
  it('maps a real captured response onto the neutral shape', () => {
    const result = toClarityAssessment(fixture);

    expect(result.provider).toBe('azure');
    expect(result.recognisedText).toBe('Pass me a glass of water.');
    expect(result.accuracy).toBe(100);
    expect(result.fluency).toBe(100);
    expect(result.completeness).toBe(100);
    expect(result.overall).toBe(100);
    expect(result.words).toHaveLength(6);
  });

  it('reads scores from the flat REST shape, not the SDK-documented nesting', () => {
    // Regression guard: the SDK docs describe scores nested under a
    // `PronunciationAssessment` property. The REST API puts them flat on each object.
    // Reading the documented shape silently yields null for every score.
    const result = toClarityAssessment(fixture);
    expect(result.accuracy).not.toBeNull();
    expect(result.words[0]?.score).toBeGreaterThan(0);
  });

  it('carries phoneme timings so audio regions can be located', () => {
    const word = toClarityAssessment(fixture).words[0];

    expect(word?.phonemes.length).toBeGreaterThan(0);
    for (const phoneme of word?.phonemes ?? []) {
      expect(phoneme.offset).toBeGreaterThan(0);
      expect(phoneme.duration).toBeGreaterThan(0);
    }
  });

  it('defaults an unrecognised error type rather than widening the union', () => {
    const odd = {
      RecognitionStatus: 'Success',
      NBest: [
        {
          AccuracyScore: 90,
          FluencyScore: 90,
          CompletenessScore: 90,
          PronScore: 90,
          Words: [{ Word: 'x', Offset: 1, Duration: 1, AccuracyScore: 90, ErrorType: 'Weird' }],
        },
      ],
    };

    expect(toClarityAssessment(odd).words[0]?.errorType).toBe('Unknown');
  });

  it('survives a response with no NBest rather than throwing', () => {
    const empty = { RecognitionStatus: 'Success' };
    const result = toClarityAssessment(empty);

    expect(result.accuracy).toBeNull();
    expect(result.words).toEqual([]);
  });
});

describe('AzureScoringProvider.assess', () => {
  it('sends the reference text as a base64 Pronunciation-Assessment header', async () => {
    const spy = stubFetch(fixture);
    await new AzureScoringProvider(CONFIG).assess(WAV, 'Pass me a glass of water');

    const init = spy.mock.calls[0]?.[1] as { headers: Record<string, string> };
    const decoded = JSON.parse(atob(init.headers['Pronunciation-Assessment'] ?? ''));

    expect(decoded.ReferenceText).toBe('Pass me a glass of water');
    expect(decoded.Granularity).toBe('Phoneme');
  });

  it('requests the en-GB locale from the speech host, not the portal host', async () => {
    const spy = stubFetch(fixture);
    await new AzureScoringProvider(CONFIG).assess(WAV, 'hello');

    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain('testregion.stt.speech.microsoft.com');
    expect(url).toContain('language=en-GB');
    // The portal shows api.cognitive.microsoft.com, which 404s for this endpoint.
    expect(url).not.toContain('api.cognitive.microsoft.com');
  });

  it('treats unrecognised speech as its own failure, not a low score', async () => {
    stubFetch({ RecognitionStatus: 'NoMatch' });

    await expect(new AzureScoringProvider(CONFIG).assess(WAV, 'hello')).rejects.toMatchObject({
      code: 'not-recognised',
    });
  });

  it('classifies 401 as unauthorised and does not retry it', async () => {
    const spy = stubFetch({ error: 'nope' }, { status: 401 });
    const assess = new AzureScoringProvider(CONFIG).assess(WAV, 'hello');

    await expect(assess).rejects.toMatchObject({ code: 'unauthorised' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries throttling with backoff, then succeeds', async () => {
    let calls = 0;
    const spy = vi.fn(async () => {
      calls++;
      return calls < 3
        ? new Response('rate limited', { status: 429 })
        : new Response(JSON.stringify(fixture), { status: 200 });
    });
    vi.stubGlobal('fetch', spy);

    const assess = new AzureScoringProvider(CONFIG).assess(WAV, 'hello');
    await vi.runAllTimersAsync();

    expect((await assess).accuracy).toBe(100);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('gives up on persistent throttling rather than retrying forever', async () => {
    const spy = stubFetch('rate limited', { status: 429 });

    const assess = new AzureScoringProvider(CONFIG).assess(WAV, 'hello');
    const assertion = expect(assess).rejects.toMatchObject({ code: 'throttled' });
    await vi.runAllTimersAsync();
    await assertion;

    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('exposes retryability so callers need not know provider status codes', () => {
    expect(new ScoringError('throttled', 'x').retryable).toBe(true);
    expect(new ScoringError('unauthorised', 'x').retryable).toBe(false);
    expect(new ScoringError('not-recognised', 'x').retryable).toBe(false);
  });
});
