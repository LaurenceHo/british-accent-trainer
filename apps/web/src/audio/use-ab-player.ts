import { useRef, useState, type RefObject } from 'react';

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

/**
 * Seeks `element` to `seconds`, clamped to its length.
 *
 * Before metadata has loaded the duration is unknown, and WebKit has been known to drop a
 * seek made that early — iOS Safari, which ignores `preload`, would then start the clip
 * from zero. So the seek is repeated once the metadata arrives.
 */
function seek(element: HTMLAudioElement, seconds: number): void {
  const clamped = () =>
    Number.isFinite(element.duration) ? Math.min(seconds, element.duration) : seconds;
  element.currentTime = clamped();
  if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
    element.addEventListener('loadedmetadata', () => (element.currentTime = clamped()), {
      once: true,
    });
  }
}

/** True once the element sits at its end, where play() would restart it from zero. */
function atEnd(element: HTMLAudioElement): boolean {
  return Number.isFinite(element.duration) && element.currentTime >= element.duration;
}

/**
 * A/B playback of the reference and the take with one shared playhead.
 *
 * Switching sides is the comparison: the learner hears a phrase in the native voice, flips,
 * and hears the same moment in their own. Only the selected clip ever plays — overlapping
 * speech is harder to compare, not easier.
 *
 * `playing` follows the elements' `play`/`pause` events rather than the calls made here,
 * because `play()` can be refused (autoplay policy, undecodable audio) and the button must
 * not claim to be playing when nothing is. Events from the clip that is not selected are
 * ignored: media events are queued, so the outgoing clip can report pausing after a switch.
 */
export function useAbPlayer(): AbPlayer {
  const refs = {
    reference: useRef<HTMLAudioElement>(null),
    take: useRef<HTMLAudioElement>(null),
  };
  const [side, setSide] = useState<Side>('reference');
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);

  // Read synchronously by handlers, which can run before React re-renders.
  const sideRef = useRef<Side>('reference');
  const playingRef = useRef(false);

  const setPlayingNow = (value: boolean) => {
    playingRef.current = value;
    setPlaying(value);
  };

  const play = (s: Side) => {
    refs[s].current?.play().catch(() => {
      // A late rejection from a clip the learner has since switched away from says
      // nothing about the clip now playing.
      if (sideRef.current === s) setPlayingNow(false);
    });
  };

  const select = (next: Side) => {
    const current = sideRef.current;
    if (next === current) return;

    const from = refs[current].current;
    const to = refs[next].current;
    const wasPlaying = playingRef.current;

    sideRef.current = next;
    setSide(next);
    from?.pause();
    if (!to) return;

    seek(to, from?.currentTime ?? 0);
    setPosition(to.currentTime);
    // Past the end of a shorter clip, carrying on would restart it from zero: stop instead.
    if (wasPlaying && !atEnd(to)) play(next);
    else if (wasPlaying) setPlayingNow(false);
  };

  const toggle = () => {
    const element = refs[sideRef.current].current;
    if (!element) return;
    if (playingRef.current) element.pause();
    else play(sideRef.current);
  };

  const elementProps = (s: Side): AbElementProps => {
    const ifSelected = (action: () => void) => () => {
      if (sideRef.current === s) action();
    };
    return {
      ref: refs[s],
      onPlay: ifSelected(() => setPlayingNow(true)),
      onPause: ifSelected(() => setPlayingNow(false)),
      // Not every browser fires `pause` when a clip plays to its end.
      onEnded: ifSelected(() => setPlayingNow(false)),
      onTimeUpdate: ifSelected(() => setPosition(refs[s].current?.currentTime ?? 0)),
    };
  };

  return { side, playing, position, select, toggle, elementProps };
}
