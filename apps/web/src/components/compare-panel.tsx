import type { WordScore } from '@api/domain';
import { useId, useMemo } from 'react';
import { useAbPlayer, type Side } from '@/audio/use-ab-player';
import { readPcmClip, type PcmClip } from '@/audio/wav-reader';
import { axisFraction, computePeaks, unclearWords, type UnclearWord } from '@/audio/waveform';
import { useBlobSource } from '@/components/audio-clip';
import { Button } from '@/components/ui/button';

/** Horizontal resolution of a full-width waveform. Shorter clips get proportionally fewer. */
const FULL_WIDTH_BARS = 300;

/** Props for {@link ComparePanel}. */
export interface ComparePanelProps {
  /** The native reference WAV; null while it loads or when it is unavailable. */
  readonly reference: ArrayBuffer | null;
  /** The learner's take, as recorded. */
  readonly take: ArrayBuffer;
  /** Per-word clarity scores once the take is scored; undefined before. */
  readonly words?: readonly WordScore[];
}

/** Parses a clip for drawing, or null when it cannot be: the audio may still play. */
function readClip(wav: ArrayBuffer | null): PcmClip | null {
  if (!wav) return null;
  try {
    return readPcmClip(wav);
  } catch {
    return null;
  }
}

const toBlob = (wav: ArrayBuffer | null) => (wav ? new Blob([wav], { type: 'audio/wav' }) : null);

const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;

const SIDE_LABELS: Record<Side, string> = { reference: 'Native reference', take: 'Your take' };

/**
 * The reference and the take, one above the other on a shared time axis, with A/B playback.
 *
 * The learner's ear does the judging — no available engine can tell RP from General
 * American (`spike/FINDINGS.md`). This makes the comparison quick to repeat: hear a moment
 * in the native voice, flip to your own, hear the same moment again.
 */
export function ComparePanel({ reference, take, words }: ComparePanelProps) {
  const referenceClip = useMemo(() => readClip(reference), [reference]);
  const takeClip = useMemo(() => readClip(take), [take]);
  const referenceBlob = useMemo(() => toBlob(reference), [reference]);
  const takeBlob = useMemo(() => toBlob(take), [take]);
  const unclear = useMemo(() => unclearWords(words), [words]);

  const player = useAbPlayer();
  const referenceProps = player.elementProps('reference');
  const takeProps = player.elementProps('take');
  useBlobSource(referenceProps.ref, referenceBlob);
  useBlobSource(takeProps.ref, takeBlob);

  const axisSeconds = Math.max(referenceClip?.durationSeconds ?? 0, takeClip?.durationSeconds ?? 0);
  const playhead = axisFraction(player.position, axisSeconds);
  const groupName = useId();

  return (
    <section className="space-y-4" aria-labelledby="compare-heading">
      <h3 id="compare-heading" className="text-sm font-medium">
        Compare
      </h3>

      <Waveform
        label={SIDE_LABELS.reference}
        clip={referenceClip}
        unavailable={reference ? 'Waveform unavailable for this recording.' : 'Loading…'}
        axisSeconds={axisSeconds}
        playhead={player.side === 'reference' ? playhead : null}
      />
      <Waveform
        label={SIDE_LABELS.take}
        clip={takeClip}
        unavailable="Waveform unavailable for this recording."
        axisSeconds={axisSeconds}
        playhead={player.side === 'take' ? playhead : null}
        markers={unclear}
      />

      <div className="flex flex-wrap items-center gap-4">
        <fieldset className="flex flex-wrap items-center gap-3">
          <legend className="sr-only">Listen to</legend>
          {(['reference', 'take'] as const).map((side) => (
            <label key={side} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name={groupName}
                value={side}
                checked={player.side === side}
                onChange={() => player.select(side)}
              />
              {SIDE_LABELS[side]}
            </label>
          ))}
        </fieldset>
        <Button variant="secondary" onClick={player.toggle}>
          {player.playing ? 'Pause' : 'Play'}
        </Button>
      </div>

      {/* Driven by the controls above; hidden so there is one set of controls, not three. */}
      <audio {...referenceProps} hidden />
      <audio {...takeProps} hidden />

      {words && <UnclearList unclear={unclear} />}
    </section>
  );
}

interface WaveformProps {
  readonly label: string;
  readonly clip: PcmClip | null;
  readonly unavailable: string;
  readonly axisSeconds: number;
  /** Playhead position as a fraction of the axis; null when this clip is not selected. */
  readonly playhead: number | null;
  readonly markers?: readonly UnclearWord[];
}

/**
 * One clip's waveform, drawn to scale on the shared axis.
 *
 * SVG rather than canvas, so it carries an accessible name and can be tested. Markers and
 * the playhead are HTML overlays positioned by percentage, because text inside a
 * non-uniformly scaled SVG would be stretched.
 */
function Waveform({ label, clip, unavailable, axisSeconds, playhead, markers = [] }: WaveformProps) {
  const width = clip ? axisFraction(clip.durationSeconds, axisSeconds) : 0;
  const peaks = useMemo(
    () => (clip ? computePeaks(clip.samples, Math.max(1, Math.round(FULL_WIDTH_BARS * width))) : []),
    [clip, width],
  );
  const placed = markers.filter((m) => m.span);

  return (
    <figure className="space-y-1">
      <figcaption className="text-sm font-medium">{label}</figcaption>
      {clip ? (
        <div className="bg-muted/40 relative h-16 w-full rounded-md">
          <svg
            role="img"
            aria-label={describe(label, clip, placed.length)}
            className="text-foreground/70 h-full"
            style={{ width: percent(width) }}
            viewBox={`0 0 ${peaks.length} 2`}
            preserveAspectRatio="none"
          >
            <path
              d={peaks.map((p, i) => `M${i + 0.5} ${1 - p.max}V${1 - p.min}`).join('')}
              stroke="currentColor"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {placed.map((m, i) => (
            <Marker key={i} marker={m} axisSeconds={axisSeconds} />
          ))}
          {playhead !== null && (
            <div
              aria-hidden="true"
              data-testid="playhead"
              className="bg-primary absolute inset-y-0 w-0.5"
              style={{ left: percent(playhead) }}
            />
          )}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{unavailable}</p>
      )}
    </figure>
  );
}

function describe(label: string, clip: PcmClip, unclearCount: number): string {
  const base = `${label} waveform, ${clip.durationSeconds.toFixed(1)} seconds`;
  if (unclearCount === 0) return base;
  return `${base}, ${unclearCount} unclear ${unclearCount === 1 ? 'word' : 'words'} marked`;
}

/**
 * An unclear word's span on the take. Hatched and labelled with the word, so it does not
 * rely on colour; hidden from assistive technology, which gets the list below instead.
 */
function Marker({ marker, axisSeconds }: { marker: UnclearWord; axisSeconds: number }) {
  const { start, end } = marker.span!;
  const left = axisFraction(start, axisSeconds);
  const right = axisFraction(end, axisSeconds);
  return (
    <div
      aria-hidden="true"
      data-testid="unclear-marker"
      className="border-foreground/60 absolute inset-y-0 border-x border-dashed bg-[repeating-linear-gradient(45deg,transparent_0_4px,color-mix(in_oklab,currentColor_25%,transparent)_4px_6px)]"
      style={{ left: percent(left), width: percent(right - left) }}
    >
      <span className="bg-background/80 absolute top-0 left-0 rounded-sm px-1 text-xs">
        {marker.word}
      </span>
    </div>
  );
}

/** The unclear words in plain text: the marker cue, without needing to see the waveform. */
function UnclearList({ unclear }: { unclear: readonly UnclearWord[] }) {
  if (unclear.length === 0) {
    return <p className="text-sm">No word fell below the clarity threshold.</p>;
  }
  return (
    <div className="space-y-1 text-sm">
      <p>Words that came through unclearly — listen to these in the reference:</p>
      <ul className="list-inside list-disc">
        {unclear.map((w, i) => (
          <li key={i}>
            {w.word}
            {w.span && <span className="text-muted-foreground"> at {w.span.start.toFixed(1)} s</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
