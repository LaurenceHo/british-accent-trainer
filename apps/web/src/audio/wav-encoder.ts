/**
 * WAV encoding for recordings sent to the scoring API.
 *
 * Mirrors the format the API validates in `apps/api/src/audio/wav.ts`: 16 kHz, 16-bit,
 * mono PCM. The constants are duplicated rather than shared because the two workspaces
 * deploy separately; if one changes, the other must too, and the API's validation will
 * reject the mismatch loudly rather than let it pass.
 */

/** Sample rate the scoring API requires. */
export const TARGET_SAMPLE_RATE = 16_000;

/** The scoring API rejects longer audio. */
export const MAX_DURATION_SECONDS = 30;

const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;
const HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * Encodes mono floating-point samples as a 16-bit PCM WAV file.
 *
 * @param samples - Mono samples, nominally in [-1, 1]. Out-of-range values are clipped
 *   rather than wrapped: wrapping turns a loud peak into a sign-flipped crack.
 * @param sampleRate - Rate the samples were captured or resampled at.
 * @returns A canonical 44-byte-header WAV file.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * CHANNELS * bytesPerSample, true); // byte rate
  view.setUint16(32, CHANNELS * bytesPerSample, true); // block align
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = HEADER_BYTES;
  for (const sample of samples) {
    const clipped = Math.max(-1, Math.min(1, sample));
    // Asymmetric scaling: 16-bit signed PCM spans -32768..32767.
    view.setInt16(offset, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return buffer;
}
