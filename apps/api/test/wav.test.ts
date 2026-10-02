import { describe, expect, it } from 'vitest';
import {
  assertScorableWav,
  InvalidAudioError,
  parseWavHeader,
  MAX_DURATION_SECONDS,
} from '../src/audio/wav';

/**
 * Byte-level WAV tests.
 *
 * The project rule is "assert bytes, not vibes": the scoring provider is *told* the audio
 * is 16 kHz mono PCM by a header, and nothing upstream checks. These build real headers
 * and assert the parser reads them correctly.
 */

interface WavOptions {
  readonly sampleRate?: number;
  readonly channels?: number;
  readonly bitsPerSample?: number;
  readonly dataBytes?: number;
  readonly audioFormat?: number;
  /** Inserts an extra chunk before `data`, as real encoders do. */
  readonly extraChunk?: string;
}

/** Builds a syntactically valid WAV file with the given format. */
function buildWav(options: WavOptions = {}): ArrayBuffer {
  const {
    sampleRate = 16_000,
    channels = 1,
    bitsPerSample = 16,
    dataBytes = 32_000,
    audioFormat = 1,
    extraChunk,
  } = options;

  const extraSize = extraChunk ? 8 + 4 : 0;
  const total = 12 + 24 + extraSize + 8 + dataBytes;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, total - 8, true);
  ascii(8, 'WAVE');

  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * channels * bitsPerSample) / 8, true);
  view.setUint16(32, (channels * bitsPerSample) / 8, true);
  view.setUint16(34, bitsPerSample, true);

  let offset = 36;
  if (extraChunk) {
    ascii(offset, extraChunk);
    view.setUint32(offset + 4, 4, true);
    offset += 12;
  }

  ascii(offset, 'data');
  view.setUint32(offset + 4, dataBytes, true);

  return buffer;
}

describe('parseWavHeader', () => {
  it('reads sample rate, channels and bit depth from the header bytes', () => {
    const format = parseWavHeader(buildWav({ sampleRate: 44_100, channels: 2, bitsPerSample: 24 }));

    expect(format.sampleRate).toBe(44_100);
    expect(format.channels).toBe(2);
    expect(format.bitsPerSample).toBe(24);
  });

  it('computes duration from the data size and format', () => {
    // 32000 bytes at 16kHz mono 16-bit = 32000 bytes/sec = exactly 1 second.
    expect(parseWavHeader(buildWav({ dataBytes: 32_000 })).durationSeconds).toBe(1);
    expect(parseWavHeader(buildWav({ dataBytes: 16_000 })).durationSeconds).toBe(0.5);
  });

  it('walks the chunk list rather than assuming a 44-byte header', () => {
    // Real encoders insert LIST or fact chunks before data. Assuming fixed offsets would
    // reject a valid file.
    const format = parseWavHeader(buildWav({ extraChunk: 'LIST', dataBytes: 32_000 }));

    expect(format.durationSeconds).toBe(1);
  });

  it('trusts the file length over a declared size that overruns it', () => {
    // A truncated upload would otherwise report a longer duration than it contains.
    const wav = buildWav({ dataBytes: 1_000 });
    new DataView(wav).setUint32(40, 999_999, true);

    expect(parseWavHeader(wav).dataBytes).toBe(1_000);
  });

  it('rejects anything that is not a WAV', () => {
    const notWav = new ArrayBuffer(100);
    expect(() => parseWavHeader(notWav)).toThrow(InvalidAudioError);
  });

  it('rejects a file too short to hold a header', () => {
    expect(() => parseWavHeader(new ArrayBuffer(10))).toThrow(/too short/i);
  });

  it('rejects compressed formats', () => {
    expect(() => parseWavHeader(buildWav({ audioFormat: 3 }))).toThrow(/PCM/i);
  });
});

describe('assertScorableWav', () => {
  it('accepts exactly what the provider requires', () => {
    const format = assertScorableWav(buildWav());

    expect(format.sampleRate).toBe(16_000);
    expect(format.channels).toBe(1);
    expect(format.bitsPerSample).toBe(16);
  });

  it('rejects the wrong sample rate', () => {
    // The request header claims 16000 Hz regardless, so without this the provider is
    // silently lied to and returns an opaque failure.
    expect(() => assertScorableWav(buildWav({ sampleRate: 44_100 }))).toThrow(/16000 Hz/);
  });

  it('rejects stereo', () => {
    expect(() => assertScorableWav(buildWav({ channels: 2 }))).toThrow(/mono/i);
  });

  it('rejects the wrong bit depth', () => {
    expect(() => assertScorableWav(buildWav({ bitsPerSample: 8 }))).toThrow(/16-bit/);
  });

  it('rejects an empty recording', () => {
    expect(() => assertScorableWav(buildWav({ dataBytes: 0 }))).toThrow(/no samples/i);
  });

  it('enforces the provider 30-second cap', () => {
    const justUnder = 32_000 * MAX_DURATION_SECONDS - 32_000;
    const justOver = 32_000 * MAX_DURATION_SECONDS + 32_000;

    expect(() => assertScorableWav(buildWav({ dataBytes: justUnder }))).not.toThrow();
    expect(() => assertScorableWav(buildWav({ dataBytes: justOver }))).toThrow(/30 seconds/);
  });
});
