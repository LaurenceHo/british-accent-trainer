import { DIFFICULTY_LABELS, RP_FEATURE_LABELS, type Drill } from '@api/domain';
import { useMemo } from 'react';
import { ApiError, referenceAudioUrl } from '@/api/client';
import { useAudioBlob, useSubmitAttempt } from '@/api/hooks';
import { useRecorder, type RecorderErrorReason } from '@/audio/use-recorder';
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

/** Props for {@link PracticePanel}. */
export interface PracticePanelProps {
  readonly drill: Drill;
}

/**
 * One drill, end to end: read it, hear the native model, record yourself, compare.
 *
 * The result shows a **clarity** score and says so in words. The scoring API measures how
 * intelligibly the sentence came through; it cannot tell British from American speech
 * (`spike/FINDINGS.md`). Left uncaptioned, a number here would read as an accent score.
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

  const startAgain = () => {
    submit.reset();
    recorder.reset();
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
        error={reference.isError ? 'The reference recording is unavailable right now.' : null}
      />

      <section className="space-y-3" aria-labelledby="record-heading">
        <h3 id="record-heading" className="text-sm font-medium">
          Your recording
        </h3>

        <div className="flex flex-wrap gap-2">
          {state.status === 'recording' ? (
            <Button onClick={recorder.stop}>Stop recording</Button>
          ) : (
            <Button onClick={() => void recorder.start()} disabled={busy}>
              {take ? 'Record again' : 'Record'}
            </Button>
          )}
          {take && !submit.data && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => submit.mutate({ drillId: drill.id, wav: take })}
            >
              {submit.isPending ? 'Checking…' : 'Check clarity'}
            </Button>
          )}
        </div>

        <p className="text-muted-foreground text-sm" aria-live="polite">
          {state.status === 'requesting' && 'Waiting for microphone permission…'}
          {state.status === 'recording' && 'Recording — read the sentence, then press stop.'}
          {state.status === 'processing' && 'Preparing your recording…'}
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
        <Alert variant="destructive" role="alert">
          <AlertTitle>Could not check this recording</AlertTitle>
          <AlertDescription>
            {submit.error instanceof ApiError ? submit.error.message : 'Please try again.'}
          </AlertDescription>
        </Alert>
      )}

      {submit.data && (
        <section className="space-y-2 rounded-lg border p-4" aria-labelledby="result-heading">
          <h3 id="result-heading" className="text-sm font-medium">
            Clarity
          </h3>
          <p className="text-3xl font-semibold" aria-describedby="clarity-explainer">
            {submit.data.attempt.accuracyScore ?? '—'}
            <span className="text-muted-foreground text-base font-normal"> / 100</span>
          </p>
          <p id="clarity-explainer" className="text-muted-foreground text-sm">
            How clearly the words came through. This is not a measure of accent — compare your
            take with the native reference by ear for that.
          </p>
          {submit.data.recognisedText && (
            <p className="text-sm">
              Heard as: <q>{submit.data.recognisedText}</q>
            </p>
          )}
          {!submit.data.audioStored && (
            <p className="text-sm">
              Your score was saved, but this recording could not be stored for later replay.
            </p>
          )}
          <Button variant="outline" onClick={startAgain}>
            Try again
          </Button>
        </section>
      )}
    </article>
  );
}
