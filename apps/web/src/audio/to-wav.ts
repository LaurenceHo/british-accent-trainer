import { encodeWav, TARGET_SAMPLE_RATE } from './wav-encoder';

/**
 * Converts whatever the browser recorded into the WAV the scoring API accepts.
 *
 * Browsers do not agree on what `MediaRecorder` produces — Chrome and Firefox emit
 * WebM/Opus, Safari emits MP4/AAC — and none of them emit 16 kHz PCM. So the container is
 * never trusted: the recording is decoded to raw samples with `AudioContext`, then rendered
 * through an `OfflineAudioContext` at 16 kHz with one channel, which resamples and downmixes
 * stereo to mono in one step. Decoding rather than inspecting the container is also what
 * makes Safari work.
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

  // ceil, not round: rounding down can shave the final partial frame off the recording.
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);

  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE);
}
