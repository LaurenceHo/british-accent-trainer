import { describe, expect, it } from 'vitest';
import { encodeWav, TARGET_SAMPLE_RATE } from '@/audio/wav-encoder';
import { readPcmClip, WavReadError } from '@/audio/wav-reader';

/** Builds a WAV from raw chunks, so layouts the encoder never writes can be tested. */
function wavFromChunks(chunks: { id: string; body: Uint8Array }[]): ArrayBuffer {
  const sizes = chunks.map((c) => 8 + c.body.length + (c.body.length % 2));
  const buffer = new ArrayBuffer(12 + sizes.reduce((a, b) => a + b, 0));
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  ascii(8, 'WAVE');
  let offset = 12;
  chunks.forEach((c, i) => {
    ascii(offset, c.id);
    view.setUint32(offset + 4, c.body.length, true);
    bytes.set(c.body, offset + 8);
    offset += sizes[i]!;
  });
  return buffer;
}

function fmt({ format = 1, channels = 1, rate = 16_000, bits = 16 } = {}): Uint8Array {
  const body = new Uint8Array(16);
  const view = new DataView(body.buffer);
  view.setUint16(0, format, true);
  view.setUint16(2, channels, true);
  view.setUint32(4, rate, true);
  view.setUint32(8, rate * channels * (bits / 8), true);
  view.setUint16(12, channels * (bits / 8), true);
  view.setUint16(14, bits, true);
  return body;
}

function pcm(values: number[]): Uint8Array {
  const body = new Uint8Array(values.length * 2);
  const view = new DataView(body.buffer);
  values.forEach((v, i) => view.setInt16(i * 2, v, true));
  return body;
}

const mono = (values: number[], format = {}) =>
  wavFromChunks([
    { id: 'fmt ', body: fmt(format) },
    { id: 'data', body: pcm(values) },
  ]);

describe('readPcmClip', () => {
  it('reads back what the encoder wrote: rate, sample count and duration', () => {
    const samples = new Float32Array(TARGET_SAMPLE_RATE / 2).fill(0.25);
    const clip = readPcmClip(encodeWav(samples, TARGET_SAMPLE_RATE));

    expect(clip.sampleRate).toBe(16_000);
    expect(clip.samples).toHaveLength(8_000);
    expect(clip.durationSeconds).toBe(0.5);
    expect(clip.samples[0]).toBeCloseTo(0.25, 3);
  });

  it('normalises the full 16-bit range to [-1, 1)', () => {
    const clip = readPcmClip(mono([-32768, 0, 32767]));

    expect(clip.samples[0]).toBe(-1);
    expect(clip.samples[1]).toBe(0);
    expect(clip.samples[2]).toBeCloseTo(1, 4);
  });

  it('skips chunks before the data, including an odd-sized one and its pad byte', () => {
    const clip = readPcmClip(
      wavFromChunks([
        { id: 'fmt ', body: fmt() },
        { id: 'LIST', body: new Uint8Array(3) },
        { id: 'data', body: pcm([1000, -1000]) },
      ]),
    );

    expect(clip.samples).toHaveLength(2);
    expect(clip.samples[0]).toBeCloseTo(1000 / 32768, 6);
    expect(clip.samples[1]).toBeCloseTo(-1000 / 32768, 6);
  });

  it('uses the declared sample rate for the duration', () => {
    const clip = readPcmClip(mono(new Array<number>(4_000).fill(0), { rate: 8_000 }));

    expect(clip.durationSeconds).toBe(0.5);
  });

  it('reads only the samples present when the data chunk overstates its size', () => {
    const wav = mono([1, 2, 3, 4]);
    const truncated = wav.slice(0, wav.byteLength - 3);

    expect(readPcmClip(truncated).samples).toHaveLength(2);
  });

  it.each([
    ['too few bytes', () => new Uint8Array([1, 2, 3]).buffer],
    ['not RIFF/WAVE', () => new TextEncoder().encode('{"error":"not audio"}').buffer],
    ['no data chunk', () => wavFromChunks([{ id: 'fmt ', body: fmt() }])],
    ['no format chunk', () => wavFromChunks([{ id: 'data', body: pcm([0]) }])],
    ['stereo', () => mono([0, 0], { channels: 2 })],
    ['8-bit', () => mono([0], { bits: 8 })],
    ['IEEE float', () => mono([0], { format: 3 })],
  ])('rejects %s with a WavReadError', (_, wav) => {
    expect(() => readPcmClip(wav() as ArrayBuffer)).toThrow(WavReadError);
  });
});
