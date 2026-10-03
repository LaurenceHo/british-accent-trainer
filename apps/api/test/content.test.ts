import { describe, expect, it } from 'vitest';
import { DRILLS } from '../../../content/drills';

/**
 * The drills' target IPA is written by hand, so nothing else checks it is British.
 *
 * These tests stand in for the lexicon spot-checks that were planned and dropped (see the
 * plan's Task 9): an American transcription slipping in would teach the very accent the
 * app trains away from, and would look entirely plausible on screen.
 */

/** IPA vowel symbols used in RP transcription, including ɐ, which some RP references use for STRUT. */
const VOWEL = /[aeiouæɐɑɒɔəɛɜɪʊʌ]/;

/** Stress marks and spaces, skipped when looking for the sound after an /r/. */
const TRANSPARENT = /[ˈˌ. ]/;

/**
 * Every /r/ that is followed, perhaps across a word gap, by something other than a vowel.
 * RP is non-rhotic: /r/ is only pronounced before a vowel, though that includes the
 * linking /r/ of "for a" (/fər ə/).
 */
function nonPrevocalicR(ipa: string): number[] {
  const offenders: number[] = [];
  for (let i = 0; i < ipa.length; i++) {
    if (ipa[i] !== 'r') continue;
    let next = i + 1;
    while (next < ipa.length && TRANSPARENT.test(ipa[next]!)) next++;
    if (!VOWEL.test(ipa[next] ?? '')) offenders.push(i);
  }
  return offenders;
}

describe('drill IPA', () => {
  it.each(DRILLS.map((d) => [d.sentence, d.targetIpa] as const))(
    '%s: /r/ only before a vowel',
    (_, ipa) => {
      expect(nonPrevocalicR(ipa)).toEqual([]);
    },
  );

  it('never uses American r-coloured vowels or the approximant symbol', () => {
    // ɚ and ɝ are rhotic vowels; ɹ is the narrow symbol American dictionaries prefer.
    for (const drill of DRILLS) expect(drill.targetIpa, drill.sentence).not.toMatch(/[ɚɝɹ]/);
  });

  it.each([
    ['car', 'kɑː'],
    ['butter', 'ˈbʌtə'],
  ])('transcribes "%s" without an /r/, as RP does', (sentence, ipa) => {
    expect(DRILLS.find((d) => d.sentence === sentence)?.targetIpa).toBe(ipa);
  });

  it('allows the linking /r/ of RP', () => {
    expect(nonPrevocalicR('fər ə')).toEqual([]);
    expect(nonPrevocalicR('jɔːr əʊn')).toEqual([]);
    expect(nonPrevocalicR('ˈrɑːðə')).toEqual([]);
  });

  it('catches an American transcription', () => {
    // The check would be useless if it passed these.
    expect(nonPrevocalicR('kɑr')).toEqual([2]);
    expect(nonPrevocalicR('ˈwɔtər')).not.toEqual([]);
    expect(nonPrevocalicR('kɑrt')).not.toEqual([]);
  });
});
