import type { WordScore } from '@api/domain';
import { describe, expect, it } from 'vitest';
import {
  axisFraction,
  computePeaks,
  TICKS_PER_SECOND,
  unclearWords,
  UNCLEAR_BELOW,
} from '@/audio/waveform';

describe('computePeaks', () => {
  it('keeps the extremes of each slice rather than averaging them away', () => {
    // Averaging would report ~0 for both slices; speech is centred on zero.
    const peaks = computePeaks(new Float32Array([0.5, -0.5, 0.2, -0.9]), 2);

    // Float32 samples: 0.2 and -0.9 are not exactly representable, so compare closely.
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toEqual({ min: -0.5, max: 0.5 });
    expect(peaks[1]!.min).toBeCloseTo(-0.9, 5);
    expect(peaks[1]!.max).toBeCloseTo(0.2, 5);
  });

  it('covers every sample when the length does not divide evenly', () => {
    const samples = new Float32Array(10);
    samples[9] = 1;

    const peaks = computePeaks(samples, 3);

    expect(peaks).toHaveLength(3);
    expect(peaks[2]!.max).toBe(1);
  });

  it('never makes more slices than there are samples', () => {
    expect(computePeaks(new Float32Array([0.1, 0.2]), 100)).toHaveLength(2);
  });

  it('returns nothing for an empty clip or no buckets', () => {
    expect(computePeaks(new Float32Array(), 50)).toEqual([]);
    expect(computePeaks(new Float32Array([1]), 0)).toEqual([]);
  });
});

describe('axisFraction', () => {
  it('places moments on an axis as long as the longer clip', () => {
    // A 2 s reference and a 4 s take share a 4 s axis: the reference ends halfway.
    expect(axisFraction(2, 4)).toBe(0.5);
    expect(axisFraction(1, 4)).toBe(0.25);
  });

  it('clamps to the axis', () => {
    expect(axisFraction(5, 4)).toBe(1);
    expect(axisFraction(-1, 4)).toBe(0);
  });

  it('is 0 for an axis with no length or an unknown time', () => {
    expect(axisFraction(1, 0)).toBe(0);
    expect(axisFraction(Number.NaN, 4)).toBe(0);
  });
});

const ticks = (seconds: number) => Math.round(seconds * TICKS_PER_SECOND);

function word(text: string, score: number, phones: [start: number, length: number][]): WordScore {
  return {
    word: text,
    score,
    phonemes: phones.map(([start, length]) => ({
      score,
      offset: ticks(start),
      duration: ticks(length),
    })),
  };
}

describe('unclearWords', () => {
  it('converts 100 ns ticks to seconds, spanning first phoneme start to last phoneme end', () => {
    // 0.5 s = 5,000,000 ticks. Dividing by 10^4 instead would put this word at 500 s.
    const [bath] = unclearWords([word('bath', 40, [[0.5, 0.1], [0.6, 0.2], [0.8, 0.15]])]);

    expect(bath!.span!.start).toBeCloseTo(0.5, 6);
    expect(bath!.span!.end).toBeCloseTo(0.95, 6);
  });

  it(`keeps only words scoring below ${UNCLEAR_BELOW}, in spoken order`, () => {
    const result = unclearWords([
      word('ask', 30, [[0, 0.2]]),
      word('the', UNCLEAR_BELOW, [[0.2, 0.1]]),
      word('class', 59, [[0.3, 0.3]]),
    ]);

    expect(result.map((w) => w.word)).toEqual(['ask', 'class']);
  });

  it('keeps a word with no timings but does not place it', () => {
    // An omitted word has no phonemes. Placing it at 0 s would point at the wrong sound.
    const [omitted] = unclearWords([
      { word: 'glass', score: 0, phonemes: [] },
    ]);

    expect(omitted).toEqual({ word: 'glass', score: 0, span: null });
  });

  it('ignores zero-length phonemes when locating a word', () => {
    const [w] = unclearWords([word('car', 20, [[0, 0], [1, 0.25]])]);

    expect(w!.span!.start).toBeCloseTo(1, 6);
  });

  it('returns nothing before the take is scored', () => {
    expect(unclearWords(undefined)).toEqual([]);
  });
});
