import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordingTooShortError, toScorableWav } from '@/audio/to-wav';

/**
 * jsdom has no Web Audio, so these substitute minimal fakes. What they verify is the
 * wiring most likely to be wrong — frame count, channel count, sample rate, and that the
 * AudioContext is always closed. Decoding real codecs is browser behaviour, verified by
 * hand in Chrome, Firefox and Safari.
 */

interface OfflineCall {
  channels: number;
  frames: number;
  sampleRate: number;
}

function installFakeAudio(options: { duration: number; decodeFails?: boolean }) {
  const offlineCalls: OfflineCall[] = [];
  const close = vi.fn(async () => undefined);

  class FakeAudioContext {
    close = close;
    async decodeAudioData(): Promise<AudioBuffer> {
      if (options.decodeFails) throw new DOMException('bad data', 'EncodingError');
      return { duration: options.duration } as AudioBuffer;
    }
  }

  class FakeOfflineAudioContext {
    readonly destination = {};
    constructor(
      readonly channels: number,
      readonly frames: number,
      readonly sampleRate: number,
    ) {
      offlineCalls.push({ channels, frames, sampleRate });
    }
    createBufferSource() {
      return { buffer: null, connect: () => undefined, start: () => undefined };
    }
    async startRendering() {
      return { getChannelData: () => new Float32Array(this.frames) };
    }
  }

  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
  return { offlineCalls, close };
}

afterEach(() => vi.unstubAllGlobals());

describe('toScorableWav', () => {
  it('renders to one channel at 16 kHz, whatever the browser recorded', async () => {
    const { offlineCalls } = installFakeAudio({ duration: 1.5 });

    await toScorableWav(new Blob(['x']));

    expect(offlineCalls).toEqual([{ channels: 1, frames: 24_000, sampleRate: 16_000 }]);
  });

  it('rounds the frame count up so the final partial frame is kept', async () => {
    const { offlineCalls } = installFakeAudio({ duration: 1.00001 });

    await toScorableWav(new Blob(['x']));

    expect(offlineCalls[0]?.frames).toBe(16_001);
  });

  it('returns a WAV sized to the rendered samples', async () => {
    installFakeAudio({ duration: 0.5 });

    const wav = await toScorableWav(new Blob(['x']));
    const view = new DataView(wav);

    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(8_000 * 2);
  });

  it('closes the AudioContext even when decoding fails', async () => {
    // Browsers cap the number of live AudioContexts; a leak eventually breaks recording.
    const { close } = installFakeAudio({ duration: 1, decodeFails: true });

    await expect(toScorableWav(new Blob(['x']))).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('length limits', () => {
  it('rejects a take too short to be an attempt', async () => {
    // Sent on, a near-empty file fails at the scoring API with a far less useful message.
    installFakeAudio({ duration: 0.1 });

    await expect(toScorableWav(new Blob(['x']))).rejects.toBeInstanceOf(RecordingTooShortError);
  });

  it('truncates to inside the API cap, however late the auto-stop fired', async () => {
    // Background tabs clamp and delay timers, so the recorder can overrun its deadline.
    const { offlineCalls } = installFakeAudio({ duration: 45 });

    const wav = await toScorableWav(new Blob(['x']));
    const seconds = new DataView(wav).getUint32(40, true) / 2 / 16_000;

    expect(offlineCalls[0]?.frames).toBe(30 * 16_000 - 1);
    expect(seconds).toBeLessThan(30);
  });
});
