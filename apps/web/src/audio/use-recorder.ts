import { useCallback, useEffect, useRef, useState } from 'react';
import { RecordingTooShortError, toScorableWav } from './to-wav';
import { MAX_DURATION_SECONDS } from './wav-encoder';

/**
 * Recording stops itself a second short of the API's cap. `toScorableWav` also truncates
 * to the cap, so a timer delayed in a background tab still cannot produce a rejected file.
 */
export const MAX_RECORD_SECONDS = MAX_DURATION_SECONDS - 1;

/** Why recording could not happen, in terms the UI can explain to the learner. */
export type RecorderErrorReason =
  /** The learner, or the browser on their behalf, refused microphone access. */
  | 'denied'
  /** No microphone is connected. */
  | 'no-device'
  /**
   * The browser cannot record here. Includes plain `http://` on another device: browsers
   * expose the microphone only on secure origins (HTTPS or localhost).
   */
  | 'unsupported'
  /** Stopped before anything usable was captured. */
  | 'too-short'
  /** Anything else — the recorder failed, or the take could not be converted. */
  | 'failed';

export type RecorderState =
  | { readonly status: 'idle' }
  | { readonly status: 'requesting' }
  | { readonly status: 'recording' }
  | { readonly status: 'processing' }
  | { readonly status: 'done'; readonly wav: ArrayBuffer }
  | { readonly status: 'error'; readonly reason: RecorderErrorReason };

export interface Recorder {
  readonly state: RecorderState;
  /**
   * Requests the microphone and starts recording. Ignored while a take is already being
   * requested, recorded or processed.
   */
  readonly start: () => Promise<void>;
  /**
   * Stops recording and converts the take. While the permission prompt is still open, it
   * cancels instead: the take never starts, even if permission is then granted.
   */
  readonly stop: () => void;
  /** Discards a finished take or error and returns to idle. Ignored mid-take. */
  readonly reset: () => void;
}

/** Where a take is. Unlike React state this is updated synchronously — see `phaseRef`. */
type Phase = 'idle' | 'requesting' | 'recording' | 'processing';

function reasonFor(error: unknown): RecorderErrorReason {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'denied';
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      return 'no-device';
    }
  }
  return 'failed';
}

function canRecord(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

/** Stops every track, which turns off the browser's recording indicator. */
function releaseMicrophone(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

/**
 * Records one take from the microphone and yields it as a 16 kHz mono WAV.
 *
 * The overriding requirement is that the microphone is released whenever a take ends, is
 * cancelled, fails, or the screen goes away. A leaked track keeps the recording indicator
 * lit, which reads as being listened to. Two mechanisms make that hold under races:
 *
 * - **`phaseRef`** is the true phase, set synchronously. React state lags a render behind,
 *   so two clicks in one frame would both see "idle" and start two recorders, orphaning
 *   the first with its microphone still live. Every guard reads the ref.
 * - **`takeRef`** is a generation counter, bumped by each new take and by unmount. Async
 *   work — the permission prompt, conversion — remembers the generation it started in and
 *   discards its result if that is no longer current, rather than overwriting newer state.
 */
export function useRecorder(): Recorder {
  const [state, setState] = useState<RecorderState>({ status: 'idle' });

  const phaseRef = useRef<Phase>('idle');
  const takeRef = useRef(0);
  const cancelledRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /** Ends a take — but only if it is still the current one. */
  const settle = useCallback((take: number, next: RecorderState) => {
    if (take !== takeRef.current) return;
    phaseRef.current = 'idle';
    setState(next);
  }, []);

  useEffect(() => {
    return () => {
      // Invalidate everything in flight, so nothing sets state or converts after unmount.
      takeRef.current += 1;
      phaseRef.current = 'idle';

      const recorder = recorderRef.current;
      const stream = streamRef.current;
      recorderRef.current = null;
      streamRef.current = null;

      if (recorder?.state === 'recording') recorder.stop();
      // Released here, synchronously. Browsers dispatch the recorder's `stop` event later,
      // so waiting for `onstop` would leave the microphone live after the screen has gone.
      if (stream) releaseMicrophone(stream);
    };
  }, []);

  const stop = useCallback(() => {
    if (phaseRef.current === 'requesting') {
      cancelledRef.current = true;
      return;
    }
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle') return;

    if (!canRecord()) {
      setState({ status: 'error', reason: 'unsupported' });
      return;
    }

    const take = ++takeRef.current;
    phaseRef.current = 'requesting';
    cancelledRef.current = false;
    setState({ status: 'requesting' });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      settle(take, { status: 'error', reason: reasonFor(error) });
      return;
    }

    // Unmounted, or Stop pressed, while the permission prompt was open.
    if (take !== takeRef.current || cancelledRef.current) {
      releaseMicrophone(stream);
      settle(take, { status: 'idle' });
      return;
    }

    const chunks: Blob[] = [];
    let failed = false;
    // Assigned once recording starts; read by onstop, which is defined before then.
    const autoStop: { timer?: ReturnType<typeof setTimeout> } = {};
    let recorder: MediaRecorder;

    try {
      // No mimeType: each browser picks a container it can produce, and conversion decodes
      // whatever arrives. Naming one would break Safari, which cannot produce WebM.
      recorder = new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      // A fatal recorder error is followed by `stop`, so cleanup still happens there. The
      // flag just ensures a truncated take is reported as a failure, not as finished.
      recorder.onerror = () => {
        failed = true;
      };
      recorder.onstop = () => {
        clearTimeout(autoStop.timer);
        releaseMicrophone(stream);
        if (recorderRef.current === recorder) {
          recorderRef.current = null;
          streamRef.current = null;
        }

        // A stale take — the screen has gone — is not worth decoding.
        if (take !== takeRef.current) return;
        if (failed) return settle(take, { status: 'error', reason: 'failed' });
        if (chunks.length === 0) return settle(take, { status: 'error', reason: 'too-short' });

        phaseRef.current = 'processing';
        setState({ status: 'processing' });
        toScorableWav(new Blob(chunks, { type: recorder.mimeType }))
          .then((wav) => settle(take, { status: 'done', wav }))
          .catch((error: unknown) =>
            settle(take, {
              status: 'error',
              reason: error instanceof RecordingTooShortError ? 'too-short' : 'failed',
            }),
          );
      };

      recorder.start();
    } catch {
      // Both the constructor and start() throw in practice — NotSupportedError, or
      // InvalidStateError when a track has already ended.
      releaseMicrophone(stream);
      settle(take, { status: 'error', reason: 'failed' });
      return;
    }

    recorderRef.current = recorder;
    streamRef.current = stream;
    phaseRef.current = 'recording';
    // Bound to this recorder, not to whatever is current: an earlier take's timer can never
    // stop a later take.
    autoStop.timer = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, MAX_RECORD_SECONDS * 1000);
    setState({ status: 'recording' });
  }, [settle]);

  const reset = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    setState({ status: 'idle' });
  }, []);

  return { state, start, stop, reset };
}
