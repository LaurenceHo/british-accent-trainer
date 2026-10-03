import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECORD_SECONDS, useRecorder } from '@/audio/use-recorder';

/**
 * The recorder hook against fake browser media APIs.
 *
 * Conversion is mocked here — it has its own tests — so these focus on the state machine
 * and, above all, on the microphone being released. A leaked track keeps the browser's
 * recording indicator lit after the learner has finished, which reads as being listened to.
 */

vi.mock('@/audio/to-wav', () => ({
  toScorableWav: vi.fn(async () => new ArrayBuffer(44)),
}));

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(readonly stream: MediaStream) {
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio']) });
    this.onstop?.();
  }
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

function installMedia(getUserMedia: () => Promise<MediaStream>) {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(getUserMedia) },
    configurable: true,
  });
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
});

describe('useRecorder', () => {
  it('records, then yields a WAV once stopped', async () => {
    const { stream } = fakeStream();
    installMedia(async () => stream);
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    expect(result.current.state.status).toBe('recording');

    act(() => result.current.stop());
    await waitFor(() => expect(result.current.state.status).toBe('done'));
  });

  it('releases the microphone as soon as the take ends', async () => {
    const { stream, track } = fakeStream();
    installMedia(async () => stream);
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    act(() => result.current.stop());

    expect(track.stop).toHaveBeenCalled();
  });

  it('releases the microphone if the screen unmounts mid-recording', async () => {
    const { stream, track } = fakeStream();
    installMedia(async () => stream);
    const { result, unmount } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    unmount();

    expect(track.stop).toHaveBeenCalled();
  });

  it('stops itself before the scoring API duration cap', async () => {
    vi.useFakeTimers();
    const { stream } = fakeStream();
    installMedia(async () => stream);
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    act(() => vi.advanceTimersByTime(MAX_RECORD_SECONDS * 1000 - 1));
    expect(FakeMediaRecorder.instances[0]?.state).toBe('recording');

    act(() => vi.advanceTimersByTime(1));
    expect(FakeMediaRecorder.instances[0]?.state).toBe('inactive');
    expect(MAX_RECORD_SECONDS).toBeLessThan(30);
  });

  it('reports a refused permission as denied', async () => {
    installMedia(async () => {
      throw new DOMException('no', 'NotAllowedError');
    });
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());

    expect(result.current.state).toEqual({ status: 'error', reason: 'denied' });
  });

  it('reports a missing microphone as no-device', async () => {
    installMedia(async () => {
      throw new DOMException('none', 'NotFoundError');
    });
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());

    expect(result.current.state).toEqual({ status: 'error', reason: 'no-device' });
  });

  it('reports an insecure or unsupported context as unsupported', async () => {
    // On plain http:// from another device, navigator.mediaDevices is simply absent.
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());

    expect(result.current.state).toEqual({ status: 'error', reason: 'unsupported' });
  });

  it('does not start a second recording while one is running', async () => {
    const { stream } = fakeStream();
    installMedia(async () => stream);
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    await act(() => result.current.start());

    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it('returns to idle on reset after a take', async () => {
    const { stream } = fakeStream();
    installMedia(async () => stream);
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.state.status).toBe('done'));

    act(() => result.current.reset());
    expect(result.current.state.status).toBe('idle');
  });

  it('does not let an earlier deadline cut a later take short', async () => {
    vi.useFakeTimers();
    const { stream } = fakeStream();
    installMedia(async () => stream);
    const { result } = renderHook(() => useRecorder());

    await act(() => result.current.start());
    act(() => vi.advanceTimersByTime(5_000));
    act(() => result.current.stop());
    await act(() => result.current.start());
    // Past the first take's deadline, short of the second's.
    act(() => vi.advanceTimersByTime(MAX_RECORD_SECONDS * 1000 - 5_000));

    expect(FakeMediaRecorder.instances).toHaveLength(2);
    expect(FakeMediaRecorder.instances[1]?.state).toBe('recording');
  });

  it('releases a microphone granted after the screen has unmounted', async () => {
    const { stream, track } = fakeStream();
    let grant: (stream: MediaStream) => void = () => undefined;
    installMedia(() => new Promise((resolve) => (grant = resolve)));
    const { result, unmount } = renderHook(() => useRecorder());

    let starting: Promise<void> = Promise.resolve();
    act(() => {
      starting = result.current.start();
    });
    unmount();
    grant(stream);
    await starting;

    expect(track.stop).toHaveBeenCalled();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });
});
