/**
 * Azure AI Speech pronunciation assessment, over the short-audio REST endpoint.
 *
 * The Node SDK is not used: it depends on Node APIs and long-lived WebSockets and is not
 * safe on the Workers runtime. The REST path is a plain `fetch()` with the configuration
 * carried as a base64 header.
 *
 * Returns clarity only. The provider cannot discriminate accent — see `spike/FINDINGS.md`.
 */

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
    phonemes: (w.Phonemes ?? []).map(toPhoneme),
  };
}

/** Maps a successful response onto the provider-neutral shape. */
export function toClarityAssessment(res: AzureResponse): ClarityAssessment {
  const best = res.NBest?.[0];

  return {
    provider: 'azure',
    recognisedText: res.DisplayText ?? null,
    accuracy: best?.AccuracyScore ?? null,
    fluency: best?.FluencyScore ?? null,
    completeness: best?.CompletenessScore ?? null,
    overall: best?.PronScore ?? null,
    words: (best?.Words ?? []).map(toWord),
  };
}

/** Credentials and region for the Azure Speech resource. */
export interface AzureConfig {
  readonly key: string;
  readonly region: string;
}

/** Scores a recording against its reference text via the Azure REST assessment endpoint. */
export class AzureScoringProvider implements ScoringProvider {
  readonly name = 'azure';

  constructor(private readonly config: AzureConfig) {}

  async assess(audio: ArrayBuffer, referenceText: string): Promise<ClarityAssessment> {
    const response = await this.requestWithRetry(audio, referenceText);

    // A non-Success status means no speech was recognised. That is categorically
    // different from scoring badly, and callers must be able to tell them apart.
    if (response.RecognitionStatus !== 'Success') {
      throw new ScoringError(
        'not-recognised',
        `No recognisable speech (${response.RecognitionStatus})`,
      );
    }

    return toClarityAssessment(response);
  }

  /** Issues the request, retrying only throttling, with exponential backoff. */
  private async requestWithRetry(
    audio: ArrayBuffer,
    referenceText: string,
  ): Promise<AzureResponse> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(audio, referenceText);
      } catch (error) {
        const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
        const retryable = error instanceof ScoringError && error.retryable;
        if (!retryable || isLastAttempt) throw error;

        await new Promise((resolve) => setTimeout(resolve, BASE_BACKOFF_MS * 2 ** attempt));
      }
    }
  }

  private async request(audio: ArrayBuffer, referenceText: string): Promise<AzureResponse> {
    const config = {
      ReferenceText: referenceText,
      GradingSystem: 'HundredMark',
      Granularity: 'Phoneme',
      Dimension: 'Comprehensive',
    };

    const url =
      `https://${this.config.region}.stt.speech.microsoft.com` +
      `/speech/recognition/conversation/cognitiveservices/v1?language=${LOCALE}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.config.key,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        'Pronunciation-Assessment': btoa(JSON.stringify(config)),
        Accept: 'application/json',
      },
      body: audio,
    });

    if (!response.ok) {
      throw new ScoringError(
        statusToCode(response.status),
        `Azure assessment failed: ${response.status} ${await response.text()}`,
        response.status,
      );
    }

    return response.json<AzureResponse>();
  }
}

/** Classifies an upstream HTTP status so callers need not know Azure's status codes. */
function statusToCode(status: number): ScoringErrorCode {
  if (status === 429) return 'throttled';
  if (status === 401 || status === 403) return 'unauthorised';
  return 'upstream';
}
