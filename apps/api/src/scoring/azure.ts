/**
 * Azure AI Speech pronunciation assessment, over the short-audio REST endpoint.
 *
 * The Node SDK is not used: it depends on Node APIs and long-lived WebSockets and is not
 * safe on the Workers runtime. The REST path is a plain `fetch()` with the configuration
 * carried as a base64 header.
 *
 * Returns clarity only. The provider cannot discriminate accent — see `spike/FINDINGS.md`.
 */

import { isValidRegion, type AzureConfig } from '../azure-config';
import {
  ScoringError,
  type ClarityAssessment,
  type PhonemeTiming,
  type ScoringErrorCode,
  type ScoringProvider,
  type WordClarity,
  type WordErrorType,
} from './provider';

/** The locale assessed against. British English, even though it does not detect RP. */
const LOCALE = 'en-GB';

/** The free tier permits a single concurrent transcription; these absorb the contention. */
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 500;
/** Ceiling on a server-supplied `Retry-After`, so upstream cannot stall us indefinitely. */
const MAX_BACKOFF_MS = 10_000;

/**
 * Per-attempt deadline.
 *
 * A stalled connection would otherwise hang the Worker until the platform kills it, with
 * the caller receiving nothing. Timeouts are deliberately **not** retried: the audio cap
 * is 30 seconds, so compounding four stalled attempts would leave someone waiting a
 * minute for a failure. Fail fast and let them re-record.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** Upstream error bodies are echoed into messages; cap them so logs stay readable. */
const MAX_ERROR_BODY_CHARS = 200;

/** Response shape of the REST endpoint. Scores sit flat on each object, not nested. */
interface AzurePhoneme {
  readonly Phoneme: string;
  readonly Offset: number;
  readonly Duration: number;
  readonly AccuracyScore: number;
}

interface AzureWord {
  readonly Word: string;
  readonly Offset: number;
  readonly Duration: number;
  readonly AccuracyScore: number;
  readonly ErrorType?: string;
  readonly Phonemes?: readonly AzurePhoneme[];
}

interface AzureNBest {
  readonly AccuracyScore: number;
  readonly FluencyScore: number;
  readonly CompletenessScore: number;
  readonly PronScore: number;
  readonly Words?: readonly AzureWord[];
}

interface AzureResponse {
  readonly RecognitionStatus: string;
  readonly DisplayText?: string;
  readonly NBest?: readonly AzureNBest[];
}

const WORD_ERROR_TYPES: readonly WordErrorType[] = [
  'None',
  'Omission',
  'Insertion',
  'Mispronunciation',
];

/**
 * Recognition statuses meaning no speech was found.
 *
 * `Error` is deliberately absent: Microsoft documents it as the service's own internal
 * fault with "try again if possible", so reporting it as "we couldn't hear you" would
 * send the learner off to re-record against a problem that is not theirs.
 */
const NO_SPEECH_STATUSES = new Set(['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout']);

/** Narrows the provider's error string to a known value, defaulting to `Unknown`. */
function toWordErrorType(value: string | undefined): WordErrorType {
  return WORD_ERROR_TYPES.find((t) => t === value) ?? 'Unknown';
}

function toPhoneme(p: AzurePhoneme): PhonemeTiming {
  return { score: p.AccuracyScore, offset: p.Offset, duration: p.Duration };
}

function toWord(w: AzureWord): WordClarity {
  return {
    word: w.Word,
    score: w.AccuracyScore,
    errorType: toWordErrorType(w.ErrorType),
    offset: w.Offset,
    duration: w.Duration,
    // `Array.isArray` rather than `?? []`: a non-array value survives `??` and then
    // throws on `.map`. The response is unvalidated upstream data, not a trusted shape.
    phonemes: Array.isArray(w.Phonemes) ? w.Phonemes.map(toPhoneme) : [],
  };
}

/**
 * Base64-encodes a string as UTF-8.
 *
 * `btoa` operates on Latin-1 code units, so `btoa(JSON.stringify(...))` silently
 * mis-encodes anything above U+007F and throws above U+00FF. Azure expects base64 of
 * **UTF-8 bytes** — the two agree only for pure ASCII. Getting this wrong scores the
 * learner against text they were never shown, with no error raised.
 */
function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Maps a successful response onto the provider-neutral shape. */
export function toClarityAssessment(res: AzureResponse): ClarityAssessment {
  const best = res.NBest?.[0];
  const words = best?.Words;

  return {
    provider: 'azure',
    recognisedText: res.DisplayText ?? null,
    accuracy: best?.AccuracyScore ?? null,
    fluency: best?.FluencyScore ?? null,
    completeness: best?.CompletenessScore ?? null,
    overall: best?.PronScore ?? null,
    words: Array.isArray(words) ? words.map(toWord) : [],
  };
}

/** Scores a recording against its reference text via the Azure REST assessment endpoint. */
export class AzureScoringProvider implements ScoringProvider {
  readonly name = 'azure';

  /** ES private, not just `private`: a TypeScript-only modifier still leaves the key on an
   * enumerable own property, so any `console.log(provider)` would print it. */
  readonly #config: AzureConfig;

  constructor(config: AzureConfig) {
    // The region is interpolated into the hostname that receives the key, so a value such
    // as `evil.com/` would send it elsewhere. isValidRegion checks the type first: a bare
    // regex test would accept `undefined`, coercing it to the string "undefined".
    if (!isValidRegion(config.region)) {
      throw new ScoringError('upstream', `Invalid Azure region: ${config.region}`);
    }
    this.#config = config;
  }

  async assess(audio: ArrayBuffer, referenceText: string): Promise<ClarityAssessment> {
    return toClarityAssessment(await this.requestWithRetry(audio, referenceText));
  }

  /** Issues the request, retrying only retryable failures, with exponential backoff. */
  private async requestWithRetry(
    audio: ArrayBuffer,
    referenceText: string,
  ): Promise<AzureResponse> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await this.request(audio, referenceText);
      } catch (error) {
        const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
        const retryable = error instanceof ScoringError && error.retryable;
        if (!retryable || isLastAttempt) throw error;

        const suggested = error.status === 429 ? error.retryAfterMs : undefined;
        const backoff = suggested ?? BASE_BACKOFF_MS * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, Math.min(backoff, MAX_BACKOFF_MS)));
      }
    }

    // Unreachable: the final attempt either returns or throws.
    throw new ScoringError('upstream', 'Retry loop exhausted without a result');
  }

  private async request(audio: ArrayBuffer, referenceText: string): Promise<AzureResponse> {
    const config = {
      ReferenceText: referenceText,
      GradingSystem: 'HundredMark',
      Granularity: 'Phoneme',
      Dimension: 'Comprehensive',
    };

    const url =
      `https://${this.#config.region}.stt.speech.microsoft.com` +
      `/speech/recognition/conversation/cognitiveservices/v1?language=${LOCALE}`;

    const response = await this.send(url, config, audio);

    if (!response.ok) {
      throw new ScoringError(
        statusToCode(response.status),
        `Azure assessment failed: ${response.status} ${this.safeBody(await response.text())}`,
        { status: response.status, retryAfterMs: retryAfterMs(response) },
      );
    }

    const parsed = await this.parse(response);

    if (NO_SPEECH_STATUSES.has(parsed.RecognitionStatus)) {
      throw new ScoringError(
        'not-recognised',
        `No recognisable speech (${parsed.RecognitionStatus})`,
      );
    }

    if (parsed.RecognitionStatus !== 'Success') {
      // Includes the documented `Error` status: an upstream fault, worth retrying, and
      // categorically not the learner's problem.
      throw new ScoringError(
        'upstream',
        `Azure recognition failed (${parsed.RecognitionStatus})`,
        { retryable: true },
      );
    }

    return parsed;
  }

  /** Performs the fetch, converting transport failures into typed errors. */
  private async send(url: string, config: object, audio: ArrayBuffer): Promise<Response> {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.#config.key,
          'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
          'Pronunciation-Assessment': base64Utf8(JSON.stringify(config)),
          Accept: 'application/json',
        },
        body: audio,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
      throw new ScoringError(
        'upstream',
        timedOut ? `Azure did not respond within ${REQUEST_TIMEOUT_MS}ms` : 'Could not reach Azure',
        { cause, retryable: !timedOut },
      );
    }
  }

  /**
   * Prepares an upstream body for inclusion in an error message.
   *
   * Truncates it, because an HTML error page from a proxy would otherwise become a
   * multi-kilobyte log line — and redacts the subscription key, because the body is
   * upstream-controlled text that we cannot assume never echoes what we sent. Cheap
   * insurance on a secret whose exposure would be unrecoverable.
   */
  private safeBody(body: string): string {
    return body.slice(0, MAX_ERROR_BODY_CHARS).replaceAll(this.#config.key, '[redacted]');
  }

  /** Parses the body, converting a non-JSON response into a typed error. */
  private async parse(response: Response): Promise<AzureResponse> {
    try {
      return await response.json<AzureResponse>();
    } catch (cause) {
      // A proxy or WAF returning an HTML error page with status 200 lands here.
      throw new ScoringError('upstream', 'Azure returned a non-JSON response', { cause });
    }
  }
}

/** Reads `Retry-After` (seconds) when upstream supplies one. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('Retry-After');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/** Classifies an upstream HTTP status so callers need not know Azure's status codes. */
function statusToCode(status: number): ScoringErrorCode {
  if (status === 429) return 'throttled';
  if (status === 401 || status === 403) return 'unauthorised';
  return 'upstream';
}
