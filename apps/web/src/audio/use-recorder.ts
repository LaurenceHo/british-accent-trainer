import { useCallback, useEffect, useRef, useState } from 'react';
import { toScorableWav } from './to-wav';
import { MAX_DURATION_SECONDS } from './wav-encoder';

/**
 * Recording stops itself a second short of the API's cap, leaving margin for the encoder's
 * rounding so a full-length take is never rejected as too long.
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
  /** Anything else — the recording or its conversion failed. */
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
  /** Requests the microphone and starts recording. Ignored unless idle, done or errored. */
  readonly start: () => Promise<void>;
  /** Stops recording and converts the take to a scorable WAV. */
  readonly stop: () => void;
  /** Discards any take or error and returns to idle. */
  readonly reset: () => void;
}

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

/** Stops every track, which is what turns off the browser's recording indicator. */
function releaseMicrophone(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

/**
 * Records one take from the microphone and yields it as a 16 kHz mono WAV.
 *
 * Releases the microphone as soon as a take ends — and on unmount — so the browser's
 * recording indicator never stays lit after the learner has finished.
 */
export function useRecorder(): Recorder {
  const [state, setState] = useState<RecorderState>({ status: 'idle' });

  // The take in progress, if any. Its stream and auto-stop timer live in start()'s closure.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mountedRef = useRef(true);

  /** Sets state only while mounted: conversion can finish after the screen has gone. */
  const safeSetState = useCallback((next: RecorderState) => {
    if (mountedRef.current) setState(next);
  }, []);

  useEffect(() => {
    // Set here, not only in useRef: StrictMode runs cleanup and then this effect again.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const recorder = recorderRef.current;
      if (!recorder) return;
      recorderRef.current = null;
      if (recorder.state === 'recording') recorder.stop();
      // onstop also releases, but browsers fire it asynchronously; release now so the
      // indicator goes out with the screen.
      releaseMicrophone(recorder.stream);
    };
  }, []);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;

    if (!canRecord()) {
      safeSetState({ status: 'error', reason: 'unsupported' });
      return;
    }

    safeSetState({ status: 'requesting' });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      safeSetState({ status: 'error', reason: reasonFor(error) });
      return;
    }
    if (!mountedRef.current) {
      releaseMicrophone(stream);
      return;
    }

    // No mimeType: each browser picks a container it can produce, and conversion decodes
    // whatever arrives. Naming one would break Safari, which cannot produce WebM.
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.onstop = () => {
      clearTimeout(autoStop);
      releaseMicrophone(stream);
      recorderRef.current = null;
      safeSetState({ status: 'processing' });
      toScorableWav(new Blob(chunks, { type: recorder.mimeType }))
        .then((wav) => safeSetState({ status: 'done', wav }))
        .catch(() => safeSetState({ status: 'error', reason: 'failed' }));
    };

    recorder.start();
    // Stops this recorder, never a later one: the timer is cleared when this take ends.
    const autoStop = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, MAX_RECORD_SECONDS * 1000);
    safeSetState({ status: 'recording' });
  }, [safeSetState]);

  const reset = useCallback(() => {
    if (recorderRef.current) return;
    setState({ status: 'idle' });
  }, []);

  return { state, start, stop, reset };
}
