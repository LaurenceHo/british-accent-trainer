/**
 * Domain types shared across routes, scoring, the seed script — and the web app.
 *
 * **This file is bundled into the browser** (`apps/web` imports it through the
 * `@api/domain` alias), so it must contain only types and plain constants and must not
 * import anything. Lint enforces that.
 *
 * Feature names follow J.C. Wells' standard lexical sets where one applies. Wells defined
 * those sets using RP and General American as the two reference accents, which is exactly
 * the contrast this app trains — so they are the natural vocabulary, and they line up with
 * any phonetics reference the user might consult.
 */

/** An RP feature a drill can train. */
export const RP_FEATURES = [
  /** Post-vocalic /r/ is not pronounced: *car* /kɑː/, not /kɑr/. */
  'NON_RHOTIC_R',
  /** TRAP–BATH split: *bath*, *class*, *ask* take /ɑː/, not /æ/. */
  'BATH',
  /** LOT vowel is rounded /ɒ/: *Tom*, *got*, not American /ɑ/. */
  'LOT',
  /** THOUGHT vowel /ɔː/ stays distinct from LOT — *caught* ≠ *cot*. */
  'THOUGHT',
  /** Intervocalic /t/ is a true /t/, not an American flap: *better*, not "bedder". */
  'T_NOT_FLAPPED',
  /** GOAT diphthong /əʊ/, not American /oʊ/. */
  'GOAT',
  /** Yod retained after alveolars: *tune* /tjuːn/, not /tuːn/. */
  'YOD',
] as const;

export type RpFeature = (typeof RP_FEATURES)[number];

/** Human-readable labels for display. */
export const RP_FEATURE_LABELS: Record<RpFeature, string> = {
  NON_RHOTIC_R: 'Non-rhotic /r/',
  BATH: 'TRAP–BATH split',
  LOT: 'LOT vowel /ɒ/',
  THOUGHT: 'THOUGHT vowel /ɔː/',
  T_NOT_FLAPPED: 'Unflapped /t/',
  GOAT: 'GOAT diphthong /əʊ/',
  YOD: 'Retained yod',
};

/**
 * Difficulty, mirroring how elocution practice actually progresses: isolate the sound,
 * contrast it against its neighbour, then build up to flowing speech.
 *
 * Also tracks how much the app can honestly say. Isolated words give the engine the most
 * acoustic evidence per sound; in connected speech it has the least. So the lower levels
 * are both easier to practise *and* the ones where any feedback is most trustworthy.
 */
export const DIFFICULTY = {
  /** A single word — "bath". */
  WORD: 1,
  /** The contrast against its twin — "bath, bat". */
  MINIMAL_PAIR: 2,
  /** A short phrase — "a glass of water". */
  PHRASE: 3,
  /** A full sentence — "Ask the class about the bath". */
  SENTENCE: 4,
  /** Longer, with linking and reduction across clauses. */
  CONNECTED: 5,
} as const;

export type Difficulty = (typeof DIFFICULTY)[keyof typeof DIFFICULTY];

/** Human-readable labels for display. */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  1: 'Single word',
  2: 'Minimal pair',
  3: 'Short phrase',
  4: 'Full sentence',
  5: 'Connected speech',
};

/** Narrows an arbitrary number to a {@link Difficulty}, falling back to SENTENCE. */
export function toDifficulty(value: number): Difficulty {
  return value >= 1 && value <= 5 ? (value as Difficulty) : DIFFICULTY.SENTENCE;
}

/** One practice item: the text to read, and the RP feature it trains. */
export interface Drill {
  readonly id: string;
  /** The text the user reads aloud. A word, a pair, a phrase, or a sentence. */
  readonly sentence: string;
  /** Target RP pronunciation in IPA. Sourced from the British lexicon, never from the API. */
  readonly targetIpa: string;
  readonly feature: RpFeature;
  readonly difficulty: Difficulty;
  /** What to listen for, in plain language. */
  readonly coachingNote: string;
  /** Contains a post-vocalic r position, so the rhoticity detector has something to judge. */
  readonly hasRContext: boolean;
  readonly sortOrder: number;
}

/**
 * Verdict for one feature on one attempt.
 *
 * `unknown` is load-bearing: the detector cannot judge every context, and a non-detection
 * must never be presented to the user as a failure. See the Boundaries section of the spec.
 */
export type FeatureVerdict = 'correct' | 'incorrect' | 'unknown';

/** Per-feature detection result attached to an attempt. */
export interface FeatureFinding {
  readonly feature: RpFeature;
  readonly verdict: FeatureVerdict;
  /** Plain-language explanation shown to the user. */
  readonly detail: string;
}

/** One word's scores, with phoneme timings for time-aligned feedback. */
export interface WordScore {
  readonly word: string;
  readonly score: number;
  /** Offsets and durations are in 100-nanosecond units, as returned by the API. */
  readonly phonemes: readonly { readonly score: number; readonly offset: number; readonly duration: number }[];
}

/** A recorded attempt at a drill. */
export interface Attempt {
  readonly id: string;
  readonly drillId: string;
  readonly createdAt: string;
  /**
   * General intelligibility scores from the en-GB assessment.
   *
   * These do NOT measure RP-ness — the engine scores British and American readings
   * identically. Never label them as an accent score in the UI. See spike/FINDINGS.md.
   */
  readonly accuracyScore: number | null;
  readonly fluencyScore: number | null;
  readonly completenessScore: number | null;
  readonly pronScore: number | null;
  readonly wordScores: readonly WordScore[];
  /** Categorical per-feature verdicts — the only output that speaks to RP. */
  readonly featureFindings: readonly FeatureFinding[];
  readonly audioKey: string | null;
}

/** One day's practice on one feature. */
export interface DailyProgress {
  /** Calendar date in the requested timezone, `YYYY-MM-DD`. */
  readonly date: string;
  readonly attempts: number;
  /** Mean clarity accuracy, 0-100, or null if no attempt that day produced a score. */
  readonly averageAccuracy: number | null;
  readonly averageFluency: number | null;
}

/** Progress on one RP feature. */
export interface FeatureProgress {
  readonly feature: RpFeature;
  readonly label: string;
  /** Total attempts in the window. Zero means the feature has not been practised. */
  readonly attempts: number;
  /** Oldest first, one entry per day with at least one attempt. */
  readonly days: readonly DailyProgress[];
}

/** Response of `GET /api/progress`. */
export interface ProgressResponse {
  /** Always `clarity`: the averages measure intelligibility, never accent. */
  readonly measures: 'clarity';
  /** Whole local days covered, today included. */
  readonly windowDays: number;
  /**
   * The window's last day, `YYYY-MM-DD`, by the server's clock at the requested offset.
   * Clients place days relative to this rather than their own clock, so a device clock a
   * few minutes out cannot push the newest day off the chart.
   */
  readonly today: string;
  /** Every RP feature, including unpractised ones, in a fixed order. */
  readonly features: readonly FeatureProgress[];
}
