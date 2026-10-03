/**
 * The scoring boundary.
 *
 * Deliberately narrow: one operation, returning a **clarity** measure. It answers "was
 * this said clearly and completely?", never "did this sound British?" — no tested API can
 * answer the latter, and presenting a clarity score as an accent score would mislead the
 * learner. See `spike/FINDINGS.md`.
 *
 * The interface exists so the vendor can be swapped without touching anything downstream.
 * That has already paid for itself once: the original Azure assumption was disproven and
 * only this layer would need replacing.
 */

/** One phoneme's score and position within the audio. */
export interface PhonemeTiming {
  readonly score: number;
  /** Offset from the start of the audio, in 100-nanosecond units, as the API reports it. */
  readonly offset: number;
  /** Duration in 100-nanosecond units. */
  readonly duration: number;
}

/** How a word deviated from the reference text, when it did. */
export type WordErrorType = 'None' | 'Omission' | 'Insertion' | 'Mispronunciation' | 'Unknown';

/** One word's clarity score and position, with per-phoneme timings beneath it. */
export interface WordClarity {
  readonly word: string;
  readonly score: number;
  readonly errorType: WordErrorType;
  readonly offset: number;
  readonly duration: number;
  /**
   * Phoneme scores in utterance order.
   *
   * These carry no phoneme *names* — the provider does not supply them for `en-GB`, and
   * its phone counts follow an American inventory, so they cannot be index-aligned to a
   * British transcription. Use the timings to locate a region in the audio, nothing more.
   */
  readonly phonemes: readonly PhonemeTiming[];
}

/**
 * A clarity assessment of one recording against its reference text.
 *
 * Every score here measures intelligibility. None of them measures accent.
 */
export interface ClarityAssessment {
  /** Which provider produced this, for display and for interpreting stored attempts. */
  readonly provider: string;
  /** What the recogniser heard — useful for catching a misread drill. */
  readonly recognisedText: string | null;
  /** How precisely the sounds were produced, 0-100. */
  readonly accuracy: number | null;
  /** Smoothness and pacing, 0-100. */
  readonly fluency: number | null;
  /** How much of the reference text was spoken, 0-100. */
  readonly completeness: number | null;
  /** The provider's combined score, 0-100. */
  readonly overall: number | null;
  readonly words: readonly WordClarity[];
}

/** Why a scoring attempt failed, in terms a caller can act on. */
export type ScoringErrorCode =
  /** Rate limited. Retrying after a delay may succeed. */
  | 'throttled'
  /** Credentials rejected. Retrying will not help. */
  | 'unauthorised'
  /** Audio contained no recognisable speech — distinct from scoring badly. */
  | 'not-recognised'
  /** Anything else from upstream. */
  | 'upstream';

/** Optional detail attached to a {@link ScoringError}. */
export interface ScoringErrorOptions {
  /** Upstream HTTP status, when the failure came from a response. */
  readonly status?: number;
  /**
   * Overrides the default retryability for the code.
   *
   * Needed because some upstream faults are retryable despite not being rate limits —
   * a provider reporting its own internal error, for instance.
   */
  readonly retryable?: boolean;
  /** How long upstream asked us to wait, when it said. */
  readonly retryAfterMs?: number;
  /** The underlying error, preserved so the original is still diagnosable. */
  readonly cause?: unknown;
}

/** A scoring failure carrying enough detail for the caller to choose a response. */
export class ScoringError extends Error {
  readonly status: number | undefined;
  /** How long upstream asked us to wait, when it said so. */
  readonly retryAfterMs: number | undefined;
  readonly #retryable: boolean;

  constructor(
    readonly code: ScoringErrorCode,
    message: string,
    options: ScoringErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ScoringError';
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.#retryable = options.retryable ?? code === 'throttled';
  }

  /** Whether retrying the identical request could plausibly succeed. */
  get retryable(): boolean {
    return this.#retryable;
  }
}

/** A pronunciation-scoring backend. */
export interface ScoringProvider {
  /** Stable identifier recorded against each attempt, e.g. `azure`. */
  readonly name: string;

  /**
   * Scores a recording against the text it was supposed to say.
   *
   * @param audio - 16 kHz, 16-bit, mono PCM WAV. Other formats are rejected upstream.
   * @param referenceText - What the speaker was asked to read. Scoring is relative to this.
   * @returns A clarity assessment.
   * @throws {ScoringError} When the audio cannot be scored.
   */
  assess(audio: ArrayBuffer, referenceText: string): Promise<ClarityAssessment>;
}
