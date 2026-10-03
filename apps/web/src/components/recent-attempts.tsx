import type { Attempt } from '@api/domain';
import { useId, useState } from 'react';
import { attemptAudioUrl } from '@/api/client';
import { useAudioBytes, useDrills, useRecentAttempts } from '@/api/hooks';
import { useWavBlob } from '@/audio/use-blob-source';
import { AudioClip } from '@/components/audio-clip';
import { Button } from '@/components/ui/button';

/** How many recent attempts to list. */
const RECENT_LIMIT = 10;

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The latest attempts across all drills, each replayable — so progress can be heard, not
 * just read off a chart.
 */
export function RecentAttempts() {
  const attempts = useRecentAttempts(RECENT_LIMIT);
  // Drills are usually cached from the practice screen; they supply each attempt's sentence.
  const drills = useDrills();

  if (attempts.isPending) return <p className="text-muted-foreground">Loading attempts…</p>;
  if (attempts.isError) {
    return <p className="text-destructive text-sm">Recent attempts could not be loaded.</p>;
  }
  if (attempts.data.length === 0) return <p className="text-muted-foreground text-sm">None yet.</p>;

  const sentences = new Map(drills.data?.map((d) => [d.id, d.sentence]));

  return (
    <ul className="divide-y rounded-lg border">
      {attempts.data.map((attempt) => (
        <AttemptRow
          key={attempt.id}
          attempt={attempt}
          // The raw id only if the drill has gone; while drills load, a placeholder.
          sentence={sentences.get(attempt.drillId) ?? (drills.isPending ? '…' : attempt.drillId)}
        />
      ))}
    </ul>
  );
}

function AttemptRow({ attempt, sentence }: { readonly attempt: Attempt; readonly sentence: string }) {
  const [replaying, setReplaying] = useState(false);
  const when = formatWhen(attempt.createdAt);
  const playerId = useId();
  const action = replaying ? 'Hide' : 'Replay';

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{sentence}</p>
          <p className="text-muted-foreground text-sm">
            <time dateTime={attempt.createdAt}>{when}</time>
            {attempt.accuracyScore !== null && <> · Clarity {attempt.accuracyScore}</>}
          </p>
        </div>
        {attempt.audioKey ? (
          <Button
            variant="outline"
            size="sm"
            // Ten buttons all named "Replay" are indistinguishable in a screen reader's list
            // of controls. The name starts with the visible word, so voice control still works.
            aria-label={`${action} ${sentence}, ${when}`}
            aria-expanded={replaying}
            aria-controls={playerId}
            onClick={() => setReplaying((r) => !r)}
          >
            {action}
          </Button>
        ) : (
          <span className="text-muted-foreground text-sm">Recording not stored</span>
        )}
      </div>
      {/* The player is mounted on demand, so a list of recordings does not download them all.
          The wrapper is always present, as the target of the button's aria-controls. */}
      <div id={playerId}>
        {replaying && <AttemptAudio attemptId={attempt.id} label={`Your attempt, ${when}`} />}
      </div>
    </li>
  );
}

function AttemptAudio({ attemptId, label }: { readonly attemptId: string; readonly label: string }) {
  // Immutable: an attempt's audio never changes once written.
  const audio = useAudioBytes(attemptAudioUrl(attemptId), true);
  const blob = useWavBlob(audio.data ?? null);
  return (
    <AudioClip
      label={label}
      blob={blob}
      loading={audio.isPending}
      error={audio.isError ? 'This recording is no longer available.' : null}
    />
  );
}
