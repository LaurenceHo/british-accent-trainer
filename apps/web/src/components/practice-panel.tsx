import { DIFFICULTY_LABELS, RP_FEATURE_LABELS, type Drill } from '@api/domain';
import { useEffect, useMemo, useRef } from 'react';
import { ApiError, referenceAudioUrl, type SubmittedAttempt } from '@/api/client';
import { useAudioBlob, useSubmitAttempt } from '@/api/hooks';
import {
  useRecorder,
  type RecorderErrorReason,
  type RecorderState,
} from '@/audio/use-recorder';
import { AudioClip } from '@/components/audio-clip';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** What to tell the learner for each way recording can fail. */
const RECORDER_ERRORS: Record<RecorderErrorReason, string> = {
  denied: 'Microphone access was refused. Allow it in your browser’s site settings, then try again.',
  'no-device': 'No microphone was found. Connect one and try again.',
  unsupported:
    'This browser cannot record here. Recording needs HTTPS, or localhost on this computer.',
  'too-short': 'That was too short to check. Read the whole sentence, then press stop.',
  failed: 'The recording could not be processed. Please try again.',
};

/** Progress messages for the recorder's transient states; the others need none. */
const RECORDER_PROGRESS: Partial<Record<RecorderState['status'], string>> = {
  requesting: 'Waiting for microphone permission…',
  recording: 'Recording — read the sentence, then press stop.',
  processing: 'Preparing your recording…',
};

/** Props for {@link PracticePanel}. */
export interface PracticePanelProps {
  readonly drill: Drill;
}

/**
 * One drill, end to end: read it, hear the native model, record yourself, compare.
 *
 * Remount this component per drill (key it on the drill id) so a take never carries over.
 */
export function PracticePanel({ drill }: PracticePanelProps) {
  const reference = useAudioBlob(referenceAudioUrl(drill.id));
  const recorder = useRecorder();
  const submit = useSubmitAttempt();

  const { state } = recorder;
  const take = state.status === 'done' ? state.wav : null;
  const takeBlob = useMemo(
    () => (take ? new Blob([take], { type: 'audio/wav' }) : null),
    [take],
  );

  const busy = state.status === 'requesting' || state.status === 'processing' || submit.isPending;

  // Resubmitting audio the recogniser could not hear spends another transcription on a
  // result already known. Offer a new take instead.
  const unheard = submit.error instanceof ApiError && submit.error.code === 'not-recognised';
  const canSubmit = take !== null && !submit.data && !unheard;

  const recordButtonRef = useRef<HTMLButtonElement>(null);

  // A new take supersedes the previous result. Without this the old score stayed on screen
  // beside a recording it never scored, and the new take could not be submitted.
  const record = () => {
    submit.reset();
    void recorder.start();
  };

  const startAgain = () => {
    submit.reset();
    recorder.reset();
    // The result section, which held focus, is about to unmount.
    recordButtonRef.current?.focus();
  };

  return (
    <article className="space-y-6" aria-labelledby="drill-sentence">
      <header className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{RP_FEATURE_LABELS[drill.feature]}</Badge>
          <Badge variant="outline">{DIFFICULTY_LABELS[drill.difficulty]}</Badge>
        </div>
        <h2 id="drill-sentence" className="text-2xl font-semibold tracking-tight">
          {drill.sentence}
        </h2>
        {/* und-fonipa marks the text as IPA, so screen readers do not read it as English. */}
        <p className="text-muted-foreground font-mono text-lg" lang="und-fonipa">
          /{drill.targetIpa}/
        </p>
        <p className="text-sm">{drill.coachingNote}</p>
      </header>

      <AudioClip
        label="Native reference"
        blob={reference.data ?? null}
        loading={reference.isPending}
        // Only when nothing is cached: a failed background refetch must not hide playable audio.
        error={
          reference.isError && !reference.data
            ? 'The reference recording is unavailable right now.'
            : null
        }
      />

      <section className="space-y-3" aria-labelledby="record-heading">
        <h3 id="record-heading" className="text-sm font-medium">
          Your recording
        </h3>

        <div className="flex flex-wrap gap-2">
          {state.status === 'recording' ? (
            <Button onClick={recorder.stop}>Stop recording</Button>
          ) : (
            <Button ref={recordButtonRef} onClick={record} disabled={busy}>
              {take ? 'Record again' : 'Record'}
            </Button>
          )}
          {canSubmit && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => submit.mutate({ drillId: drill.id, wav: take })}
            >
              {submit.isPending ? 'Checking…' : 'Check clarity'}
            </Button>
          )}
        </div>

        {/* Always mounted: a live region that appears together with its text is not announced. */}
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {RECORDER_PROGRESS[state.status]}
        </p>

        {state.status === 'error' && (
          <Alert variant="destructive">
            <AlertTitle>Could not record</AlertTitle>
            <AlertDescription>{RECORDER_ERRORS[state.reason]}</AlertDescription>
          </Alert>
        )}

        {takeBlob && <AudioClip label="Your take" blob={takeBlob} />}
      </section>

      {submit.isError && (
        <Alert variant="destructive">
          <AlertTitle>Could not check this recording</AlertTitle>
          <AlertDescription>
            {submit.error instanceof ApiError
              ? submit.error.message
              : 'Could not reach the server. Check your connection and try again.'}
            {unheard && ' Record a new take to try again.'}
          </AlertDescription>
        </Alert>
      )}

      {submit.data && <ClarityResult result={submit.data} onTryAgain={startAgain} />}
    </article>
  );
}

/**
 * The scored result, captioned as **clarity** and saying so in words.
 *
 * The scoring API measures how intelligibly the sentence came through; it cannot tell British
 * from American speech (`spike/FINDINGS.md`). Left uncaptioned, a number here would read as
 * an accent score.
 */
function ClarityResult({
  result,
  onTryAgain,
}: {
  readonly result: SubmittedAttempt;
  readonly onTryAgain: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The "Check clarity" button that held focus unmounts as this appears, which would drop
  // keyboard focus to the page body and leave a screen reader announcing nothing. Moving
  // focus here lands the learner on the result and reads it out.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section className="space-y-2 rounded-lg border p-4" aria-labelledby="result-heading">
      <h3
        id="result-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-sm font-medium focus:outline-none"
      >
        Clarity
      </h3>
      <p className="text-3xl font-semibold" aria-describedby="clarity-explainer">
        {result.attempt.accuracyScore ?? '—'}
        <span className="text-muted-foreground text-base font-normal"> / 100</span>
      </p>
      <p id="clarity-explainer" className="text-muted-foreground text-sm">
        How clearly the words came through. This is not a measure of accent — compare your
        take with the native reference by ear for that.
      </p>
      {result.recognisedText && (
        <p className="text-sm">
          Heard as: <q>{result.recognisedText}</q>
        </p>
      )}
      {!result.audioStored && (
        <p className="text-sm">
          Your score was saved, but this recording could not be stored for later replay.
        </p>
      )}
      <Button variant="outline" onClick={onTryAgain}>
        Try again
      </Button>
    </section>
  );
}
