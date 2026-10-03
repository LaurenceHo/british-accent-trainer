import type { WordScore } from '@api/domain';

/**
 * The maths behind the comparison screen: waveform peaks, the shared time axis, and where
 * each unclear word sits in the take. Pure functions, so the alignment can be tested with
 * known numbers rather than by looking at a picture.
 */

/** The loudest excursions either side of zero within one horizontal slice of a clip. */
export interface Peak {
  readonly min: number;
  readonly max: number;
}

/**
 * Reduces a clip to one min/max pair per bucket, for drawing.
 *
 * Min/max rather than an average: speech is centred on zero, so averaging cancels out and
 * flattens the waveform, hiding exactly the bursts a learner compares.
 *
 * @param samples - Normalised samples.
 * @param buckets - How many slices to draw. Capped at the sample count.
 * @returns One peak per slice; empty for an empty clip or no buckets.
 */
export function computePeaks(samples: Float32Array, buckets: number): Peak[] {
  const count = Math.min(Math.floor(buckets), samples.length);
  if (count <= 0) return [];

  const size = samples.length / count;
  const peaks: Peak[] = [];
  for (let b = 0; b < count; b++) {
    const start = Math.floor(b * size);
    const end = Math.max(start + 1, Math.floor((b + 1) * size));
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i++) {
      const s = samples[i]!;
      if (s < min) min = s;
      if (s > max) max = s;
    }
    peaks.push({ min, max });
  }
  return peaks;
}

/**
 * Where a moment falls on the shared time axis, as a fraction of its width.
 *
 * Both waveforms share one axis, the length of the longer clip, so a slower take is drawn
 * visibly longer than the reference instead of being stretched to match it.
 *
 * @param seconds - The moment.
 * @param axisSeconds - The axis length — the longer clip's duration.
 * @returns A fraction in [0, 1]; 0 when the axis has no length.
 */
export function axisFraction(seconds: number, axisSeconds: number): number {
  if (!(axisSeconds > 0) || !Number.isFinite(seconds)) return 0;
  return Math.min(1, Math.max(0, seconds / axisSeconds));
}

/** Azure reports offsets and durations in 100-nanosecond ticks. */
export const TICKS_PER_SECOND = 10_000_000;

/**
 * Word accuracy below which a word is marked unclear.
 *
 * The boundary Azure itself uses when flagging a word as mispronounced. It is a clarity
 * cue — the engine cannot judge accent — and the UI labels it "unclear", nothing stronger.
 */
export const UNCLEAR_BELOW = 60;

/** A word the engine heard poorly, and where it sits in the take, when known. */
export interface UnclearWord {
  readonly word: string;
  readonly score: number;
  /** Seconds into the take; null when the engine returned no timings for the word. */
  readonly span: { readonly start: number; readonly end: number } | null;
}

/**
 * Picks out the words that came through unclearly, located in the take.
 *
 * A word's span runs from its first phoneme's start to its last phoneme's end. Phonemes
 * are only used for timing; their symbols follow the engine's American inventory and are
 * never shown. Words without timings (for example, ones the engine reports as omitted)
 * are kept but not placed — drawing them at zero would point at the wrong sound.
 *
 * @param words - Per-word scores from the attempt; undefined before scoring.
 * @returns The unclear words, in spoken order.
 */
export function unclearWords(words: readonly WordScore[] | undefined): UnclearWord[] {
  if (!words) return [];
  return words
    .filter((w) => w.score < UNCLEAR_BELOW)
    .map((w) => ({ word: w.word, score: w.score, span: wordSpan(w) }));
}

function wordSpan(word: WordScore): UnclearWord['span'] {
  const timed = (word.phonemes ?? []).filter((p) => p.duration > 0);
  if (timed.length === 0) return null;
  const start = Math.min(...timed.map((p) => p.offset));
  const end = Math.max(...timed.map((p) => p.offset + p.duration));
  return { start: start / TICKS_PER_SECOND, end: end / TICKS_PER_SECOND };
}
