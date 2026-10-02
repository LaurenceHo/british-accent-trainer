/**
 * Response shape of the Azure speech-to-text REST endpoint with pronunciation assessment.
 *
 * IMPORTANT: this differs from the SDK-documented shape. The REST API returns scores
 * **flat on each object** (`NBest[0].AccuracyScore`, `Words[i].AccuracyScore`), not nested
 * under a `PronunciationAssessment` property. Verified against live responses captured in
 * `spike/results/raw.json`.
 */

/** One phoneme. At `en-GB` the `Phoneme` name is always `""`; timings are populated. */
export interface AzurePhoneme {
  readonly Phoneme: string;
  readonly Offset: number;
  readonly Duration: number;
  readonly AccuracyScore: number;
}

/** One syllable. At `en-GB` the `Syllable` name is always `""`. */
export interface AzureSyllable {
  readonly Syllable: string;
  readonly Offset: number;
  readonly Duration: number;
  readonly AccuracyScore: number;
}

export interface AzureWord {
  readonly Word: string;
  readonly Offset: number;
  readonly Duration: number;
  readonly AccuracyScore: number;
  readonly ErrorType: string;
  readonly Syllables?: readonly AzureSyllable[];
  readonly Phonemes?: readonly AzurePhoneme[];
}

export interface AzureNBest {
  readonly Display: string;
  readonly AccuracyScore: number;
  readonly FluencyScore: number;
  readonly CompletenessScore: number;
  readonly PronScore: number;
  readonly Words?: readonly AzureWord[];
}

export interface AzureAssessmentResponse {
  readonly RecognitionStatus: string;
  readonly DisplayText?: string;
  readonly NBest?: readonly AzureNBest[];
}

/** Flattened view of one assessment — the shape the gate decision is read from. */
export interface AssessmentSummary {
  readonly recognitionStatus: string;
  readonly accuracyScore: number | null;
  readonly pronScore: number | null;
  readonly fluencyScore: number | null;
  readonly phonemeCount: number;
  /** Any phoneme NAMES returned? Expected false at `en-GB`. */
  readonly anyPhonemeNames: boolean;
  /** All phoneme entries carry non-zero timings? Rung 3 depends on this. */
  readonly allTimingsPresent: boolean;
  readonly perWord: readonly {
    readonly word: string;
    readonly score: number;
    readonly phonemeScores: readonly number[];
  }[];
}

/** Reduces a raw Azure response to the comparable summary above. */
export function summarise(res: AzureAssessmentResponse): AssessmentSummary {
  const best = res.NBest?.[0];
  const words = best?.Words ?? [];
  const phonemes = words.flatMap((w) => w.Phonemes ?? []);

  return {
    recognitionStatus: res.RecognitionStatus,
    accuracyScore: best?.AccuracyScore ?? null,
    pronScore: best?.PronScore ?? null,
    fluencyScore: best?.FluencyScore ?? null,
    phonemeCount: phonemes.length,
    anyPhonemeNames: phonemes.some((p) => p.Phoneme !== ''),
    allTimingsPresent:
      phonemes.length > 0 && phonemes.every((p) => p.Offset > 0 && p.Duration > 0),
    perWord: words.map((w) => ({
      word: w.Word,
      score: w.AccuracyScore,
      phonemeScores: (w.Phonemes ?? []).map((p) => p.AccuracyScore),
    })),
  };
}
