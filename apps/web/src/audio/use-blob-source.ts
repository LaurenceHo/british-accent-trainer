import { useEffect, useMemo, type RefObject } from 'react';

/**
 * Plays `blob` through the referenced media element.
 *
 * The object URL is created and revoked inside one effect run and assigned straight to the
 * element, with no React state. Two simpler-looking patterns are both wrong:
 * - setting a state URL inside the effect re-renders needlessly (and the react-hooks lint
 *   rule forbids it);
 * - creating the URL in `useMemo` and revoking it in an effect breaks under StrictMode,
 *   whose mount → unmount → mount revokes the memoised URL while it is still in use.
 *
 * Revoking matters: an object URL pins its Blob in memory, recordings are about a megabyte,
 * and a session can play dozens.
 *
 * @param ref - The element to play through; it may mount after the blob arrives.
 * @param blob - The recording, or null for none.
 */
export function useBlobSource(ref: RefObject<HTMLMediaElement | null>, blob: Blob | null): void {
  useEffect(() => {
    const element = ref.current;
    if (!blob || !element) return;

    const url = URL.createObjectURL(blob);
    element.src = url;
    return () => {
      element.removeAttribute('src');
      // Removing src alone leaves the element holding the old resource; load() releases it.
      element.load();
      URL.revokeObjectURL(url);
    };
  }, [ref, blob]);
}

/**
 * Wraps WAV bytes in a playable Blob, once per set of bytes.
 *
 * @param wav - The WAV file, or null for none.
 * @returns A Blob of type `audio/wav`, or null.
 */
export function useWavBlob(wav: ArrayBuffer | null): Blob | null {
  return useMemo(() => (wav ? new Blob([wav], { type: 'audio/wav' }) : null), [wav]);
}
