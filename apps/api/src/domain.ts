/**
 * Domain types shared across routes, scoring, and the seed script.
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

/** One practice item: a sentence to read, and the RP feature it trains. */
export interface Drill {
  readonly id: string;
  readonly sentence: string;
  /** Target RP pronunciation in IPA. Sourced from the British lexicon, never from the API. */
  readonly targetIpa: string;
  readonly feature: RpFeature;
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
