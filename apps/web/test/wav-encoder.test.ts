import { describe, expect, it } from 'vitest';
import { encodeWav, TARGET_SAMPLE_RATE } from '@/audio/wav-encoder';

/**
 * Byte-level checks. The API validates exactly these fields and rejects anything else, so
 * "it sounds fine" is not evidence — every header field is asserted directly.
 */

function ascii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(
    ...Array.from({ length }, (_, i) => view.getUint8(offset + i)),
  );
}

describe('encodeWav', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const view = new DataView(encodeWav(samples, TARGET_SAMPLE_RATE));

  it('writes the RIFF/WAVE container and chunk ids', () => {
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(ascii(view, 36, 4)).toBe('data');
  });

  it('declares 16 kHz, 16-bit, mono PCM — exactly what the API accepts', () => {
    expect(view.getUint16(20, true), 'format: PCM').toBe(1);
    expect(view.getUint16(22, true), 'channels').toBe(1);
    expect(view.getUint32(24, true), 'sample rate').toBe(16_000);
    expect(view.getUint32(28, true), 'byte rate').toBe(32_000);
    expect(view.getUint16(32, true), 'block align').toBe(2);
    expect(view.getUint16(34, true), 'bits per sample').toBe(16);
  });

  it('sizes the chunks consistently with the sample count', () => {
    expect(view.getUint32(40, true), 'data bytes').toBe(samples.length * 2);
    expect(view.getUint32(4, true), 'RIFF size').toBe(36 + samples.length * 2);
    expect(view.byteLength).toBe(44 + samples.length * 2);
  });

  it('scales samples to the full signed 16-bit range', () => {
    const at = (i: number) => view.getInt16(44 + i * 2, true);

    expect(at(0)).toBe(0);
    expect(at(1)).toBe(Math.trunc(0.5 * 0x7fff));
    expect(at(2)).toBe(-0x4000);
    expect(at(3)).toBe(32_767);
    expect(at(4)).toBe(-32_768);
  });

  it('clips out-of-range samples instead of wrapping them', () => {
    // Wrapping would turn a loud peak into a sign-flipped crack.
    const loud = new DataView(encodeWav(new Float32Array([1.7, -3]), TARGET_SAMPLE_RATE));

    expect(loud.getInt16(44, true)).toBe(32_767);
    expect(loud.getInt16(46, true)).toBe(-32_768);
  });

  it('produces a valid header-only file for no samples', () => {
    const empty = new DataView(encodeWav(new Float32Array(0), TARGET_SAMPLE_RATE));

    expect(empty.byteLength).toBe(44);
    expect(empty.getUint32(40, true)).toBe(0);
  });
});
