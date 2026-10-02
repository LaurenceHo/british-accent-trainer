/**
 * WAV header parsing and validation.
 *
 * The scoring API is told the audio is 16 kHz / 16-bit / mono PCM by a `Content-Type`
 * header. Nothing upstream verifies that claim, so sending a 44.1 kHz file or a WebM blob
 * produces an opaque 400 from the provider rather than a useful message. Parsing the
 * header here turns an upstream mystery into a precise local error.
 *
 * The project's testing rule is "assert bytes, not vibes" — this is the code that makes
 * that possible.
 */

/** Exactly what the scoring provider requires. */
export const REQUIRED_SAMPLE_RATE = 16_000;
export const REQUIRED_BITS_PER_SAMPLE = 16;
export const REQUIRED_CHANNELS = 1;

/** The REST assessment path rejects audio longer than this. */
export const MAX_DURATION_SECONDS = 30;

/** Smallest possible WAV: 44-byte canonical header with no samples. */
const MIN_WAV_BYTES = 44;

/** PCM. Anything else (IEEE float, A-law, compressed) is not what the provider expects. */
const WAVE_FORMAT_PCM = 1;

/** Describes why audio was rejected, in terms that can be shown to a caller. */
export class InvalidAudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAudioError';
  }
}

/** The parts of a WAV header this application cares about. */
export interface WavFormat {
  readonly sampleRate: number;
  readonly bitsPerSample: number;
  readonly channels: number;
  /** Length of the `data` chunk in bytes. */
  readonly dataBytes: number;
  readonly durationSeconds: number;
}

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * Parses a WAV header.
 *
 * Walks the chunk list rather than assuming the canonical 44-byte layout: encoders
 * legitimately insert `LIST`, `fact` or other chunks before `data`, and assuming fixed
 * offsets would reject valid files.
 *
 * @param audio - The complete WAV file.
 * @returns The format fields needed to validate the file.
 * @throws {InvalidAudioError} When the bytes are not a parseable WAV.
 */
export function parseWavHeader(audio: ArrayBuffer): WavFormat {
  if (audio.byteLength < MIN_WAV_BYTES) {
    throw new InvalidAudioError('Audio is too short to be a WAV file');
  }

  const view = new DataView(audio);

  if (readFourCC(view, 0) !== 'RIFF' || readFourCC(view, 8) !== 'WAVE') {
    throw new InvalidAudioError('Audio is not a WAV file (missing RIFF/WAVE header)');
  }

  let format: Omit<WavFormat, 'dataBytes' | 'durationSeconds'> | null = null;
  let dataBytes: number | null = null;

  // Chunks start after "RIFF" + size + "WAVE".
  let offset = 12;
  while (offset + 8 <= audio.byteLength) {
    const chunkId = readFourCC(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (chunkId === 'fmt ') {
      // A PCM format chunk is at least 16 bytes. A smaller declared size would make the
      // reads below run into the next chunk and misparse a crafted file.
      if (chunkSize < 16 || body + 16 > audio.byteLength) {
        throw new InvalidAudioError('WAV format chunk is truncated');
      }
      if (view.getUint16(body, true) !== WAVE_FORMAT_PCM) {
        throw new InvalidAudioError('WAV audio must be uncompressed PCM');
      }
      format = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (chunkId === 'data') {
      // Trust the file length over the declared size: a truncated upload would otherwise
      // report a duration longer than the bytes actually present.
      dataBytes = Math.min(chunkSize, audio.byteLength - body);
    }

    if (format && dataBytes !== null) break;

    // Chunks are word-aligned, so an odd size is followed by a pad byte.
    offset = body + chunkSize + (chunkSize % 2);
  }

  if (!format) throw new InvalidAudioError('WAV file has no format chunk');
  if (dataBytes === null) throw new InvalidAudioError('WAV file has no data chunk');

  const bytesPerSecond = format.sampleRate * format.channels * (format.bitsPerSample / 8);
  if (bytesPerSecond <= 0) {
    throw new InvalidAudioError('WAV header declares an impossible format');
  }

  return { ...format, dataBytes, durationSeconds: dataBytes / bytesPerSecond };
}

/**
 * Validates that audio is exactly what the scoring provider accepts.
 *
 * @param audio - The complete WAV file.
 * @returns The parsed format, for logging or storage.
 * @throws {InvalidAudioError} When the format or duration is unacceptable.
 */
export function assertScorableWav(audio: ArrayBuffer): WavFormat {
  const format = parseWavHeader(audio);

  if (format.sampleRate !== REQUIRED_SAMPLE_RATE) {
    throw new InvalidAudioError(
      `Audio must be ${REQUIRED_SAMPLE_RATE} Hz, got ${format.sampleRate} Hz`,
    );
  }
  if (format.channels !== REQUIRED_CHANNELS) {
    throw new InvalidAudioError(`Audio must be mono, got ${format.channels} channels`);
  }
  if (format.bitsPerSample !== REQUIRED_BITS_PER_SAMPLE) {
    throw new InvalidAudioError(
      `Audio must be ${REQUIRED_BITS_PER_SAMPLE}-bit, got ${format.bitsPerSample}-bit`,
    );
  }
  if (format.dataBytes === 0) {
    throw new InvalidAudioError('Audio contains no samples');
  }
  if (format.durationSeconds > MAX_DURATION_SECONDS) {
    throw new InvalidAudioError(
      `Audio must be under ${MAX_DURATION_SECONDS} seconds, got ` +
        `${format.durationSeconds.toFixed(1)} seconds`,
    );
  }

  return format;
}
