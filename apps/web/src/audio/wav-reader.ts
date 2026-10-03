/**
 * Reads the samples out of a 16-bit mono PCM WAV, for drawing waveforms.
 *
 * Both clips the app compares are in this format: the reference is validated by the API's
 * `assertScorableWav` before it is cached, and the take comes from `encodeWav`. Reading the
 * bytes directly avoids `AudioContext.decodeAudioData`, which jsdom lacks and whose output
 * differs subtly between browsers.
 *
 * The chunk walk mirrors `apps/api/src/audio/wav.ts`. It is duplicated rather than shared
 * because the two workspaces deploy separately; see the note in `wav-encoder.ts`.
 */

/** Describes why a WAV could not be read. */
export class WavReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavReadError';
  }
}

/** A clip's samples, normalised to [-1, 1). */
export interface PcmClip {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly durationSeconds: number;
}

/** "RIFF" + size + "WAVE". */
const RIFF_HEADER_BYTES = 12;
const WAVE_FORMAT_PCM = 1;
const BYTES_PER_SAMPLE = 2;

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * Parses a WAV file into normalised samples.
 *
 * Walks the chunk list rather than assuming the canonical 44-byte layout, since encoders
 * may insert `LIST` or `fact` chunks before `data`. Trusts the file length over the
 * declared `data` size, so a truncated file yields the samples actually present.
 *
 * @param wav - The complete WAV file.
 * @returns The samples, sample rate and duration.
 * @throws {WavReadError} When the bytes are not a 16-bit mono PCM WAV.
 */
export function readPcmClip(wav: ArrayBuffer): PcmClip {
  if (wav.byteLength < RIFF_HEADER_BYTES) throw new WavReadError('Too short to be a WAV file');

  const view = new DataView(wav);
  if (fourCC(view, 0) !== 'RIFF' || fourCC(view, 8) !== 'WAVE') {
    throw new WavReadError('Not a WAV file');
  }

  let sampleRate: number | null = null;
  let data: { offset: number; bytes: number } | null = null;

  for (let offset = RIFF_HEADER_BYTES; offset + 8 <= wav.byteLength; ) {
    const id = fourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === 'fmt ') {
      if (size < 16 || body + 16 > wav.byteLength) {
        throw new WavReadError('Format chunk is truncated');
      }
      const format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const bits = view.getUint16(body + 14, true);
      if (format !== WAVE_FORMAT_PCM || channels !== 1 || bits !== 16) {
        throw new WavReadError('Only 16-bit mono PCM can be drawn');
      }
      sampleRate = view.getUint32(body + 4, true);
    } else if (id === 'data') {
      data = { offset: body, bytes: Math.min(size, wav.byteLength - body) };
    }

    if (sampleRate !== null && data) break;
    // Chunks are word-aligned: an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
  }

  if (sampleRate === null || sampleRate <= 0) throw new WavReadError('No usable format chunk');
  if (!data) throw new WavReadError('No data chunk');

  const count = Math.floor(data.bytes / BYTES_PER_SAMPLE);
  const samples = new Float32Array(count);
  // DataView rather than Int16Array: WAV is little-endian whatever the platform, and an
  // Int16Array view would also need the data chunk to start on an even byte.
  for (let i = 0; i < count; i++) {
    samples[i] = view.getInt16(data.offset + i * BYTES_PER_SAMPLE, true) / 32768;
  }

  return { samples, sampleRate, durationSeconds: count / sampleRate };
}
