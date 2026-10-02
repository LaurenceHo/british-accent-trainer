import type { AzureAssessmentResponse } from './azure-types';

/**
 * Rhoticity detection by inverting an `en-US` assessment.
 *
 * Azure at `en-GB` cannot discriminate rhoticity — verified in `spike/FINDINGS.md`, with
 * both synthetic and real speech scoring identically whether the /r/ is produced or not.
 *
 * At `en-US`, however, the API returns phoneme **names** and `NBestPhonemes` — the phones
 * it actually heard, ranked. The reference for *car* is /k ɑɹ/, so a speaker producing
 * correct non-rhotic RP omits that r and Azure reports hearing bare `ɑ` instead of `ɑɹ`.
 *
 * We therefore use the American model purely as a **feature detector** and invert its
 * verdict: hearing the non-rhotic variant means the speaker got RP right. The user is
 * never scored against General American — only measured on one specific contrast.
 *
 * Known limit: this works where the rhotic and non-rhotic variants are acoustically far
 * apart (`ɑɹ` vs `ɑ` in *car*). It fails on weak contrasts such as `ɚ` vs `ə` in *water*,
 * where Azure reports `ɚ` for both. Treat a non-detection as "unknown", not as "rhotic".
 */

/** Phones that carry American r-colouring. */
const RHOTIC = /[ɹɻ]|ɚ|ɝ/u;

export type RhoticVerdict = 'r-dropped' | 'r-produced' | 'inconclusive';

export interface RhoticFinding {
  /** The r-bearing phone the American model expected, e.g. `ɑɹ`. */
  readonly expectedPhoneme: string;
  /** The phone actually heard, per `NBestPhonemes`. */
  readonly heardPhoneme: string | null;
  readonly heardScore: number | null;
  readonly expectedScore: number;
  readonly verdict: RhoticVerdict;
}

export interface RhoticAnalysis {
  readonly findings: readonly RhoticFinding[];
  /** True when every r-context was produced non-rhotically — i.e. correct RP. */
  readonly soundsBritish: boolean | null;
  readonly summary: string;
}

/**
 * Extracts a rhoticity verdict from an `en-US` assessment response.
 *
 * @param res - Response from assessing at `en-US` with `NBestPhonemeCount` set.
 * @returns Per-r-context findings and an overall verdict, or `soundsBritish: null` when
 *          the utterance contained no r-context to judge.
 */
export function analyseRhoticity(res: AzureAssessmentResponse): RhoticAnalysis {
  const words = res.NBest?.[0]?.Words ?? [];
  const findings: RhoticFinding[] = [];

  for (const word of words) {
    for (const phoneme of word.Phonemes ?? []) {
      if (!RHOTIC.test(phoneme.Phoneme)) continue;

      // `NBestPhonemes` is only present at locales that support spoken phonemes.
      const nBest = (phoneme as { NBestPhonemes?: { Phoneme: string; Score: number }[] })
        .NBestPhonemes;
      const top = nBest?.[0] ?? null;

      let verdict: RhoticVerdict = 'inconclusive';
      if (top) {
        verdict = RHOTIC.test(top.Phoneme) ? 'r-produced' : 'r-dropped';
      }

      findings.push({
        expectedPhoneme: phoneme.Phoneme,
        heardPhoneme: top?.Phoneme ?? null,
        heardScore: top?.Score ?? null,
        expectedScore: phoneme.AccuracyScore,
        verdict,
      });
    }
  }

  if (findings.length === 0) {
    return { findings, soundsBritish: null, summary: 'No r-context in this utterance.' };
  }

  const dropped = findings.filter((f) => f.verdict === 'r-dropped').length;

  // ASYMMETRIC RELIABILITY — measured over 24 probes across 12 r-contexts
  // (`spike/results/r-contexts.json`):
  //
  //   "r-dropped"  →  2 true,  0 false   — no false positive ever observed
  //   "r-produced" → 12 true, 10 false   — 55% precision, near a coin flip
  //
  // The detector only reliably recognises a dropped r in a couple of contexts (START in
  // *car*, NURSE in *nurse*). Elsewhere it reports "r produced" for correct RP too, so
  // that verdict cannot distinguish "you pronounced the r" from "I could not tell".
  //
  // We therefore report ONLY the positive confirmation and downgrade everything else to
  // unknown. Telling a learner they produced an r when they did not would actively teach
  // the wrong thing — and the spec's Boundaries require non-detection to read as unknown,
  // never as a failure.
  if (dropped === findings.length) {
    return {
      findings,
      soundsBritish: true,
      summary: `Non-rhotic in all ${dropped} r-position(s) — this is correct RP.`,
    };
  }

  return {
    findings,
    soundsBritish: null,
    summary:
      'Could not confirm the r was dropped here. This detector only recognises certain ' +
      'r-contexts reliably, so treat it as no result — not as a mistake.',
  };
}
