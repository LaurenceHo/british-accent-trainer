import type { WordScore } from '@api/domain';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeWav, TARGET_SAMPLE_RATE } from '@/audio/wav-encoder';
import { TICKS_PER_SECOND } from '@/audio/waveform';
import { ComparePanel, type ComparePanelProps } from '@/components/compare-panel';
import { renderWithClient } from './render';

/** A WAV of the given length, so the shared time axis can be checked with known numbers. */
const wavOf = (seconds: number) =>
  encodeWav(new Float32Array(Math.round(seconds * TARGET_SAMPLE_RATE)).fill(0.1), TARGET_SAMPLE_RATE);

const REFERENCE = wavOf(1);
const TAKE = wavOf(2);

function word(text: string, score: number, startSeconds: number, endSeconds: number): WordScore {
  return {
    word: text,
    score,
    phonemes: [
      {
        score,
        offset: startSeconds * TICKS_PER_SECOND,
        duration: (endSeconds - startSeconds) * TICKS_PER_SECOND,
      },
    ],
  };
}

function renderPanel(props: Partial<ComparePanelProps> = {}) {
  // StrictMode, via the shared helper: it double-mounts the object-URL effects.
  const result = renderWithClient(<ComparePanel reference={REFERENCE} take={TAKE} {...props} />);
  const [reference, take] = Array.from(result.container.querySelectorAll('audio'));
  return { ...result, reference: reference!, take: take! };
}

const waveform = (name: RegExp) => screen.getByRole('img', { name });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

describe('ComparePanel waveforms', () => {
  it('draws both clips to scale on one axis, the length of the longer', () => {
    // A 1 s reference against a 2 s take: the reference spans half the width.
    renderPanel();

    expect(waveform(/Native reference/)).toHaveStyle({ width: '50.00%' });
    expect(waveform(/Your take/)).toHaveStyle({ width: '100.00%' });
  });

  it('names each waveform with its duration', () => {
    renderPanel();

    expect(waveform(/Native reference/)).toHaveAccessibleName(
      'Native reference waveform, 1.0 seconds',
    );
    expect(waveform(/Your take/)).toHaveAccessibleName('Your take waveform, 2.0 seconds');
  });

  it('says the reference is loading until it arrives', () => {
    renderPanel({ reference: null });

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(waveform(/Your take/)).toHaveStyle({ width: '100.00%' });
  });

  it('degrades to a message when a clip cannot be read, and still plays it', async () => {
    // The waveform is an aid; the audio is the point.
    const { reference } = renderPanel({ reference: new Uint8Array([1, 2, 3]).buffer });
    const play = vi.spyOn(reference, 'play');

    expect(screen.getByText('Waveform unavailable for this recording.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(play).toHaveBeenCalled();
  });
});

describe('ComparePanel unclear words', () => {
  const words = [word('ask', 90, 0, 0.5), word('bath', 40, 0.5, 1)];

  it('marks an unclear word where it was spoken in the take', () => {
    // 0.5–1.0 s on a 2 s axis: from 25% across, 25% wide.
    renderPanel({ words });

    const markers = screen.getAllByTestId('unclear-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveStyle({ left: '25.00%', width: '25.00%' });
    // Labelled with the word, so the cue does not depend on colour.
    expect(markers[0]).toHaveTextContent('bath');
  });

  it('marks the take only, never the reference, whose timing is different', () => {
    renderPanel({ words });

    const referenceFigure = waveform(/Native reference/).closest('figure')!;
    expect(within(referenceFigure as HTMLElement).queryByTestId('unclear-marker')).toBeNull();
    expect(waveform(/Your take/)).toHaveAccessibleName(
      'Your take waveform, 2.0 seconds, 1 unclear word marked',
    );
  });

  it('lists the unclear words in text, with where they fall', () => {
    renderPanel({ words });

    expect(screen.getByRole('listitem')).toHaveTextContent('bath at 0.5 s');
  });

  it('lists a word the engine gave no timings for, without placing it', () => {
    renderPanel({ words: [{ word: 'glass', score: 0, phonemes: [] }] });

    expect(screen.getByRole('listitem')).toHaveTextContent(/^glass$/);
    expect(screen.queryByTestId('unclear-marker')).toBeNull();
  });

  it('says so when no word fell below the threshold', () => {
    renderPanel({ words: [word('ask', 90, 0, 0.5)] });

    expect(screen.getByText('No word fell below the clarity threshold.')).toBeInTheDocument();
  });

  it('shows nothing about clarity before the take is scored', () => {
    renderPanel();

    expect(screen.queryByText(/clarity|unclear/i)).not.toBeInTheDocument();
  });

  it('never labels a word as wrong or mispronounced', () => {
    renderPanel({ words });

    expect(screen.queryByText(/wrong|error|mispronounc/i)).not.toBeInTheDocument();
  });
});

describe('ComparePanel A/B playback', () => {
  it('plays the reference first', async () => {
    const { reference, take } = renderPanel();
    const playReference = vi.spyOn(reference, 'play');
    const playTake = vi.spyOn(take, 'play');

    expect(screen.getByRole('radio', { name: 'Native reference' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));

    expect(playReference).toHaveBeenCalledOnce();
    expect(playTake).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('flips to the same moment in the take, and keeps playing', async () => {
    const { reference, take } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    reference.currentTime = 0.6;
    const pauseReference = vi.spyOn(reference, 'pause');
    const playTake = vi.spyOn(take, 'play');

    await userEvent.click(screen.getByRole('radio', { name: 'Your take' }));

    expect(pauseReference).toHaveBeenCalled();
    expect(take.currentTime).toBe(0.6);
    expect(playTake).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('ignores events from the clip that is not selected', async () => {
    // Media events are queued, so the outgoing clip can report pausing, ending or a new
    // time after the switch. None of that describes what the learner is hearing.
    const { reference, take } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Your take' }));
    take.currentTime = 0.5;
    fireEvent.timeUpdate(take);

    reference.currentTime = 0.9;
    fireEvent.timeUpdate(reference);
    fireEvent.pause(reference);
    fireEvent.ended(reference);

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    const takeFigure = waveform(/Your take/).closest('figure') as HTMLElement;
    expect(within(takeFigure).getByTestId('playhead')).toHaveStyle({ left: '25.00%' });
  });

  it('flips without starting playback when paused', async () => {
    const { reference, take } = renderPanel();
    reference.currentTime = 0.4;
    const playTake = vi.spyOn(take, 'play');

    await userEvent.click(screen.getByRole('radio', { name: 'Your take' }));

    expect(take.currentTime).toBe(0.4);
    expect(playTake).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('clamps the playhead to a shorter clip', async () => {
    const { reference, take } = renderPanel();
    await userEvent.click(screen.getByRole('radio', { name: 'Your take' }));
    take.currentTime = 1.8;
    Object.defineProperty(reference, 'duration', { value: 1, configurable: true });

    await userEvent.click(screen.getByRole('radio', { name: 'Native reference' }));

    expect(reference.currentTime).toBe(1);
  });

  it('moves the playhead with the selected clip, on the shared axis', () => {
    const { take } = renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Your take' }));

    take.currentTime = 1;
    fireEvent.timeUpdate(take);

    // 1 s on a 2 s axis.
    const takeFigure = waveform(/Your take/).closest('figure') as HTMLElement;
    expect(within(takeFigure).getByTestId('playhead')).toHaveStyle({ left: '50.00%' });
    const referenceFigure = waveform(/Native reference/).closest('figure') as HTMLElement;
    expect(within(referenceFigure).queryByTestId('playhead')).toBeNull();
  });

  it('pauses the selected clip', async () => {
    const { reference } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    const pause = vi.spyOn(reference, 'pause');

    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));

    expect(pause).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('returns to "Play" when the clip finishes', async () => {
    const { reference } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));

    fireEvent.ended(reference);

    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('does not claim to be playing when the browser refuses to play', async () => {
    // Autoplay policy, or audio not loaded: play() rejects and no play event fires.
    const { reference } = renderPanel();
    vi.spyOn(reference, 'play').mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    });

    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('is operable from the keyboard', async () => {
    const { take } = renderPanel();
    const playTake = vi.spyOn(take, 'play');

    // Radios move with the arrow keys; the button activates with Enter.
    screen.getByRole('radio', { name: 'Native reference' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Your take' })).toBeChecked();

    screen.getByRole('button', { name: 'Play' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(playTake).toHaveBeenCalledOnce();
  });
});

describe('ComparePanel when a clip cannot play yet', () => {
  it('says the reference failed rather than loading forever, and offers the take', async () => {
    const { take } = renderPanel({ reference: null, referenceFailed: true });
    const playTake = vi.spyOn(take, 'play');

    expect(screen.getByText('The reference recording is unavailable right now.')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Your take' }));
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(playTake).toHaveBeenCalledOnce();
  });

  it('will not "play" a reference that has no audio yet', () => {
    // A browser accepts play() on an element with no source and fires `play`, then never
    // sounds: the button would show "Pause" over silence.
    renderPanel({ reference: null });

    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });
});

describe('ComparePanel real-browser timing', () => {
  it('ignores a late refusal from a clip the learner has switched away from', async () => {
    // The take's play() is still pending when the learner flips back to the reference,
    // which plays. When the take's refusal finally arrives it must not reset the button,
    // or the learner could not pause what they are hearing.
    const { take } = renderPanel();
    let refuse: (reason: Error) => void = () => undefined;
    vi.spyOn(take, 'play').mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('play'));
      return new Promise<void>((_, reject) => (refuse = reject));
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Your take' }));
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Native reference' }));

    await act(async () => refuse(new DOMException('undecodable', 'NotSupportedError')));

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('stops at the end of a shorter clip rather than restarting it from zero', async () => {
    // play() on a clip at its end starts it over, which is not the moment being compared.
    const { reference, take } = renderPanel();
    Object.defineProperty(reference, 'duration', { value: 1, configurable: true });
    const playReference = vi.spyOn(reference, 'play');
    await userEvent.click(screen.getByRole('radio', { name: 'Your take' }));
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    take.currentTime = 1.8;

    await userEvent.click(screen.getByRole('radio', { name: 'Native reference' }));

    expect(playReference).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('repeats the seek once metadata loads, in case an early one was dropped', async () => {
    // iOS Safari ignores preload, so a clip never played has no metadata, and WebKit has
    // dropped seeks made that early.
    const { reference, take } = renderPanel();
    reference.currentTime = 0.6;
    await userEvent.click(screen.getByRole('radio', { name: 'Your take' }));

    take.currentTime = 0; // the dropped seek
    fireEvent.loadedMetadata(take);

    expect(take.currentTime).toBe(0.6);
  });
});
