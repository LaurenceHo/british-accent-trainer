import { useRef } from 'react';
import { useBlobSource } from '@/audio/use-blob-source';

/** Props for {@link AudioClip}. */
export interface AudioClipProps {
  /** Accessible name for the player, e.g. "Native reference". */
  readonly label: string;
  readonly blob: Blob | null;
  readonly loading?: boolean;
  readonly error?: string | null;
}

/**
 * A labelled audio player for a recording held as a Blob. See {@link useBlobSource} for how
 * the object URL is managed. Native controls are keyboard-accessible and announce
 * their state to screen readers.
 */
export function AudioClip({ label, blob, loading = false, error = null }: AudioClipProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  useBlobSource(audioRef, blob);

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

