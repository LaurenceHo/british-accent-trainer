import { useCallback, useRef, useState, type RefObject } from 'react';

/** Which clip the learner is listening to. */
export type Side = 'reference' | 'take';

/** Props to spread onto each side's `<audio>` element. */
export interface AbElementProps {
  readonly ref: RefObject<HTMLAudioElement | null>;
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onEnded: () => void;
  readonly onTimeUpdate: () => void;
}

/** State and controls for A/B playback. */
export interface AbPlayer {
  readonly side: Side;
  readonly playing: boolean;
  /** Seconds into the selected clip — the shared playhead. */
  readonly position: number;
  /** Switches clip, keeping the playhead where it is and carrying on if playing. */
  readonly select: (side: Side) => void;
  /** Plays or pauses the selected clip. */
  readonly toggle: () => void;
  readonly elementProps: (side: Side) => AbElementProps;
}

/** The furthest a clip can be sought to: its duration, once the browser knows it. */
function clampToDuration(seconds: number, element: HTMLAudioElement): number {
  return Number.isFinite(element.duration) ? Math.min(seconds, element.duration) : seconds;
}

/**
 * A/B playback of the reference and the take with one shared playhead.
 *
 * Switching sides is the comparison: the learner hears a phrase in the native voice, flips,
 * and hears the same moment in their own. Only the selected clip ever plays — overlapping
 * speech is harder to compare, not easier.
 *
 * `playing` follows the elements' `play`/`pause` events rather than the calls made here,
 * because `play()` can be refused (autoplay policy, audio not loaded yet) and the button
 * must not claim to be playing when nothing is.
 */
export function useAbPlayer(): AbPlayer {
  const reference = useRef<HTMLAudioElement>(null);
  const take = useRef<HTMLAudioElement>(null);
  const [side, setSide] = useState<Side>('reference');
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);

  // Read synchronously by event handlers: the outgoing element's `pause` event arrives
  // after the switch, and must not be mistaken for the new side pausing.
  const sideRef = useRef<Side>('reference');
  const playingRef = useRef(false);

  const elementFor = useCallback((s: Side) => (s === 'reference' ? reference : take).current, []);

  const play = useCallback((element: HTMLAudioElement) => {
    element.play().catch(() => {
      playingRef.current = false;
      setPlaying(false);
    });
  }, []);

  const select = useCallback(
    (next: Side) => {
      const current = sideRef.current;
      if (next === current) return;

      const from = elementFor(current);
      const to = elementFor(next);
      const wasPlaying = playingRef.current;
      const at = from?.currentTime ?? 0;

      sideRef.current = next;
      setSide(next);
      from?.pause();

      if (!to) return;
      to.currentTime = clampToDuration(at, to);
      setPosition(to.currentTime);
      if (wasPlaying) play(to);
    },
    [elementFor, play],
  );

  const toggle = useCallback(() => {
    const element = elementFor(sideRef.current);
    if (!element) return;
    if (playingRef.current) element.pause();
    else play(element);
  }, [elementFor, play]);

  const elementProps = (s: Side): AbElementProps => {
    const isActive = () => sideRef.current === s;
    const setPlayingIfActive = (value: boolean) => {
      if (!isActive()) return;
      playingRef.current = value;
      setPlaying(value);
    };
    return {
      ref: s === 'reference' ? reference : take,
      onPlay: () => setPlayingIfActive(true),
      onPause: () => setPlayingIfActive(false),
      // Not every browser fires `pause` when a clip plays to its end.
      onEnded: () => setPlayingIfActive(false),
      onTimeUpdate: () => {
        const element = elementFor(s);
        if (isActive() && element) setPosition(element.currentTime);
      },
    };
  };

  return { side, playing, position, select, toggle, elementProps };
}
