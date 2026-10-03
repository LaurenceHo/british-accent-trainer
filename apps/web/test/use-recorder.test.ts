import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ToWav from '@/audio/to-wav';
import { RecordingTooShortError } from '@/audio/to-wav';
import { MAX_RECORD_SECONDS, useRecorder } from '@/audio/use-recorder';
import { MAX_DURATION_SECONDS } from '@/audio/wav-encoder';

/**
 * The recorder hook against fake browser media APIs.
 *
 * The overriding requirement is that the microphone is always released: a leaked track
 * keeps the browser's recording indicator lit, which reads as being listened to.
 *
 * Two properties of the fakes matter. The recorder dispatches `stop` **asynchronously**, as
 * browsers do — a synchronous fake would let cleanup bugs hide behind `onstop`. And
 * conversion is a promise each test resolves by hand, so it can act mid-conversion.
 */

let conversion: {
  resolve: (wav: ArrayBuffer) => void;
  reject: (error: unknown) => void;
} | null = null;
const toScorableWav = vi.fn(
  () =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      conversion = { resolve, reject };
    }),
);

vi.mock('@/audio/to-wav', async (importOriginal) => ({
  ...(await importOriginal<typeof ToWav>()),
  toScorableWav: () => toScorableWav(),
}));

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static throwOnConstruct = false;

  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  emitsData = true;

  constructor(readonly stream: MediaStream) {
    if (FakeMediaRecorder.throwOnConstruct) {
      throw new DOMException('unsupported', 'NotSupportedError');
    }
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    // Browsers queue these as tasks; they never fire inside stop().
    queueMicrotask(() => {
      if (this.emitsData) this.ondataavailable?.({ data: new Blob(['audio']) });
      this.onstop?.();
    });
  }
  /** Simulates a fatal recorder error, which per spec is followed by `stop`. */
  fail() {
    this.onerror?.();
    this.stop();
  }
}

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
}

function fakeStream(): { stream: MediaStream; track: FakeTrack } {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

/** Installs a getUserMedia that resolves with a fresh stream per call. */
function installMedia() {
  const tracks: FakeTrack[] = [];
  const getUserMedia = vi.fn(async () => {
    const { stream, track } = fakeStream();
    tracks.push(track);
    return stream;
  });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  return { getUserMedia, tracks };
}

/** Installs a getUserMedia whose promise each test resolves by hand. */
function installPendingMedia() {
  let grant: (stream: MediaStream) => void = () => undefined;
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn(
        () =>
          new Promise<MediaStream>((resolve) => {
            grant = resolve;
          }),
      ),
    },
    configurable: true,
  });
  return { grant: (stream: MediaStream) => grant(stream) };
}

function installFailingMedia(name: string) {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(async () => Promise.reject(new DOMException('x', name))) },
    configurable: true,
  });
}

const flush = () => act(async () => undefined);

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.throwOnConstruct = false;
  conversion = null;
  toScorableWav.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
});

describe('a normal take', () => {
  it('records, converts, then yields the WAV', async () => {
    installMedia();
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    expect(result.current.state.status).toBe('recording');

    act(() => result.current.stop());
    await waitFor(() => expect(result.current.state.status).toBe('processing'));

    const wav = new ArrayBuffer(44);
    await act(async () => conversion?.resolve(wav));
    expect(result.current.state).toEqual({ status: 'done', wav });
  });

  it('releases the microphone when the take ends', async () => {
    const { tracks } = installMedia();
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    act(() => result.current.stop());
    await flush();

    expect(tracks[0]?.stop).toHaveBeenCalled();
  });

  it('can record again after a finished take', async () => {
    installMedia();
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    act(() => result.current.stop());
    await flush();
    await act(async () => conversion?.resolve(new ArrayBuffer(44)));

    await act(() => result.current.start());
    expect(result.current.state.status).toBe('recording');
    expect(FakeMediaRecorder.instances).toHaveLength(2);
  });

  it('returns to idle on reset after a take', async () => {
    installMedia();
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    act(() => result.current.stop());
    await flush();
    await act(async () => conversion?.resolve(new ArrayBuffer(44)));

    act(() => result.current.reset());
    expect(result.current.state.status).toBe('idle');
  });
});

describe('releasing the microphone on unmount', () => {
  it('releases it synchronously, before the recorder dispatches stop', async () => {
    // Browsers fire `stop` later; waiting for onstop would leave the mic live after the
    // screen had gone. No flush here — the release must already have happened.
    const { tracks } = installMedia();
    const { result, unmount } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    unmount();

    expect(tracks[0]?.stop).toHaveBeenCalled();
  });

  it('releases a microphone granted after the screen has unmounted', async () => {
    const media = installPendingMedia();
    const { result, unmount } = renderHook(() => useRecorder());

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.start();
    });
    unmount();
    const { stream, track } = fakeStream();
    await act(async () => {
      media.grant(stream);
      await pending;
    });

    expect(track.stop).toHaveBeenCalled();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('does not convert a take after the screen has gone', async () => {
    installMedia();
    const { result, unmount } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    unmount();
    await flush();

    expect(toScorableWav).not.toHaveBeenCalled();
  });
});

describe('races', () => {
  it('starts only one recorder when start is clicked twice during the permission prompt', async () => {
    // The guard must not wait for the prompt: React state lags a render, so a guard reading
    // it lets both clicks through and orphans the first recorder with its mic still live.
    const media = installPendingMedia();
    const { result } = renderHook(() => useRecorder());

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.start();
      second = result.current.start();
    });
    await act(async () => {
      media.grant(fakeStream().stream);
      await Promise.all([first, second]);
    });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it('ignores start while the previous take is converting', async () => {
    // Otherwise the old take's conversion lands as "done" while a new one is recording.
    installMedia();
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    act(() => result.current.stop());
    await flush();
    expect(result.current.state.status).toBe('processing');

    await act(() => result.current.start());

    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(result.current.state.status).toBe('processing');
  });

  it('ignores reset while the previous take is converting', async () => {
    installMedia();
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    act(() => result.current.stop());
    await flush();

    act(() => result.current.reset());
    const wav = new ArrayBuffer(44);
    await act(async () => conversion?.resolve(wav));

    expect(result.current.state).toEqual({ status: 'done', wav });
  });

  it('cancels a take when stop is pressed during the permission prompt', async () => {
    const media = installPendingMedia();
    const { result } = renderHook(() => useRecorder());

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.start();
    });
    act(() => result.current.stop());
    const { stream, track } = fakeStream();
    await act(async () => {
      media.grant(stream);
      await pending;
    });

    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(track.stop).toHaveBeenCalled();
    expect(result.current.state.status).toBe('idle');
  });
});

describe('the auto-stop timer', () => {
  it('stops the take before the scoring API duration cap', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    installMedia();
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    act(() => vi.advanceTimersByTime(MAX_RECORD_SECONDS * 1000 - 1));
    expect(FakeMediaRecorder.instances[0]?.state).toBe('recording');

    act(() => vi.advanceTimersByTime(1));
    expect(FakeMediaRecorder.instances[0]?.state).toBe('inactive');
    expect(MAX_RECORD_SECONDS).toBeLessThan(MAX_DURATION_SECONDS);
  });

  it('does not let an earlier take’s deadline cut a later take short', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    installMedia();
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    act(() => vi.advanceTimersByTime(5_000));
    act(() => result.current.stop());
    await flush();
    await act(async () => conversion?.resolve(new ArrayBuffer(44)));

    await act(() => result.current.start());
    // Past the first take's deadline, short of the second's.
    act(() => vi.advanceTimersByTime(MAX_RECORD_SECONDS * 1000 - 1_000));

    expect(FakeMediaRecorder.instances[1]?.state).toBe('recording');
  });
});

describe('failures', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-device'],
    ['AbortError', 'failed'],
  ] as const)('maps a %s from getUserMedia to %s', async (name, reason) => {
    installFailingMedia(name);
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());

    expect(result.current.state).toEqual({ status: 'error', reason });
  });

  it('reports an insecure or unsupported context as unsupported', async () => {
    // On plain http:// from another device, navigator.mediaDevices is simply absent.
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());

    expect(result.current.state).toEqual({ status: 'error', reason: 'unsupported' });
  });

  it('releases the stream and recovers when the recorder cannot be constructed', async () => {
    FakeMediaRecorder.throwOnConstruct = true;
    const { tracks } = installMedia();
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());

    expect(result.current.state).toEqual({ status: 'error', reason: 'failed' });
    expect(tracks[0]?.stop).toHaveBeenCalled();

    FakeMediaRecorder.throwOnConstruct = false;
    await act(() => result.current.start());
    expect(result.current.state.status).toBe('recording');
  });

  it('reports a recorder error as failed, not as a finished take', async () => {
    const { tracks } = installMedia();
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    act(() => FakeMediaRecorder.instances[0]?.fail());
    await flush();

    expect(result.current.state).toEqual({ status: 'error', reason: 'failed' });
    expect(tracks[0]?.stop).toHaveBeenCalled();
    expect(toScorableWav).not.toHaveBeenCalled();
  });

  it('reports a take with no audio as too short, without converting it', async () => {
    installMedia();
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    const recorder = FakeMediaRecorder.instances[0];
    if (recorder) recorder.emitsData = false;
    act(() => result.current.stop());
    await flush();

    expect(result.current.state).toEqual({ status: 'error', reason: 'too-short' });
    expect(toScorableWav).not.toHaveBeenCalled();
  });

  it('reports a take that decodes too short as too short', async () => {
    installMedia();
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    act(() => result.current.stop());
    await flush();
    await act(async () => conversion?.reject(new RecordingTooShortError(0.1)));

    expect(result.current.state).toEqual({ status: 'error', reason: 'too-short' });
  });
});
