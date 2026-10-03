import { encodeWav, MAX_DURATION_SECONDS, TARGET_SAMPLE_RATE } from './wav-encoder';

/**
 * Shorter than this is a mis-click rather than an attempt. Sent on, it would reach the
 * scoring API as a near-empty file and fail there with a far less helpful message.
 */
export const MIN_DURATION_SECONDS = 0.3;

/** Thrown when a take is too short to be worth scoring. */
export class RecordingTooShortError extends Error {
  constructor(readonly durationSeconds: number) {
    super(`Recording is too short (${durationSeconds.toFixed(2)}s)`);
    this.name = 'RecordingTooShortError';
  }
}

/** The longest output allowed: one frame inside the API's cap. */
const MAX_FRAMES = MAX_DURATION_SECONDS * TARGET_SAMPLE_RATE - 1;

/**
 * Converts whatever the browser recorded into the WAV the scoring API accepts.
 *
 * Browsers do not agree on what `MediaRecorder` produces — Chrome and Firefox emit
 * WebM/Opus, Safari emits MP4/AAC — and none of them emit 16 kHz PCM. So the container is
 * never trusted: the recording is decoded to raw samples with `AudioContext`, then rendered
 * through an `OfflineAudioContext` at 16 kHz with one channel, which resamples and downmixes
 * stereo to mono in one step. Decoding rather than inspecting the container is also what
 * makes Safari work.
 *
 * @throws {RecordingTooShortError} When the take is under {@link MIN_DURATION_SECONDS}.
 */
export async function toScorableWav(recording: Blob): Promise<ArrayBuffer> {
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await recording.arrayBuffer());
  } finally {
    // An open AudioContext holds audio hardware; browsers cap how many can exist.
    await context.close();
  }

  if (decoded.duration < MIN_DURATION_SECONDS) {
    throw new RecordingTooShortError(decoded.duration);
  }

  // ceil, not round: rounding down can shave the final partial frame off the recording.
  // Truncating at MAX_FRAMES guarantees the API's cap however late the auto-stop fired —
  // background tabs clamp and delay timers, sometimes by many seconds.
  const frames = Math.min(Math.ceil(decoded.duration * TARGET_SAMPLE_RATE), MAX_FRAMES);
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);

  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE);
}
