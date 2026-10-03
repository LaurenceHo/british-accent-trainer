import { useEffect, useRef } from 'react';

/** Props for {@link AudioClip}. */
export interface AudioClipProps {
  /** Accessible name for the player, e.g. "Native reference". */
  readonly label: string;
  readonly blob: Blob | null;
  readonly loading?: boolean;
  readonly error?: string | null;
}

/**
 * A labelled audio player for a recording held as a Blob.
 *
 * The object URL is created and revoked inside one effect run and assigned straight to the
 * element, with no React state. Two simpler-looking patterns are both wrong:
 * - setting a state URL inside the effect re-renders needlessly (and the react-hooks lint
 *   rule forbids it);
 * - creating the URL in `useMemo` and revoking it in an effect breaks under StrictMode,
 *   whose mount → unmount → mount revokes the memoised URL while it is still in use.
 *
 * Revoking matters: an object URL pins its Blob in memory, recordings are about a megabyte,
 * and a session can play dozens. Native controls are keyboard-accessible and announce
 * their state to screen readers.
 */
export function AudioClip({ label, blob, loading = false, error = null }: AudioClipProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = audioRef.current;
    if (!blob || !element) return;

    const url = URL.createObjectURL(blob);
    element.src = url;
    return () => {
      element.removeAttribute('src');
      // Removing src alone leaves the element holding the old resource; load() releases it.
      element.load();
      URL.revokeObjectURL(url);
    };
  }, [blob]);

  return (
    <figure className="space-y-1">
      <figcaption className="text-sm font-medium">{label}</figcaption>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : blob ? (
        <audio ref={audioRef} controls aria-label={label} className="w-full" />
      ) : (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {loading ? 'Loading…' : 'Not available.'}
        </p>
      )}
    </figure>
  );
}
