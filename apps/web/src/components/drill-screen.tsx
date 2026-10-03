import { DIFFICULTY_LABELS, type Difficulty, type Drill } from '@api/domain';
import { useState } from 'react';
import { useDrills } from '@/api/hooks';
import { PracticePanel } from '@/components/practice-panel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

/** Groups drills by difficulty, preserving the API's easiest-first order within each. */
function byDifficulty(drills: readonly Drill[]): [Difficulty, Drill[]][] {
  const groups = new Map<Difficulty, Drill[]>();
  for (const drill of drills) {
    const group = groups.get(drill.difficulty) ?? [];
    group.push(drill);
    groups.set(drill.difficulty, group);
  }
  return [...groups.entries()];
}

/**
 * The practice screen: a drill picker grouped by difficulty, and the selected drill.
 *
 * Grouping follows the order the corpus is built to be practised in — isolate the sound,
 * contrast it, then build up to running speech.
 */
export function DrillScreen() {
  const drills = useDrills();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (drills.isPending) {
    return (
      <p className="text-muted-foreground" aria-live="polite">
        Loading drills…
      </p>
    );
  }

  if (drills.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Drills could not be loaded</AlertTitle>
        <AlertDescription>Check that the API is running, then reload the page.</AlertDescription>
      </Alert>
    );
  }

  if (drills.data.length === 0) {
    return <p>No drills yet. Run <code>bun run db:seed</code> in <code>apps/api</code>.</p>;
  }

  const selected = drills.data.find((d) => d.id === selectedId) ?? drills.data[0];

  return (
    <div className="grid gap-8 md:grid-cols-[16rem_1fr]">
      <nav aria-label="Drills" className="space-y-6">
        {byDifficulty(drills.data).map(([difficulty, group]) => (
          <section key={difficulty} aria-labelledby={`difficulty-${difficulty}`}>
            <h2
              id={`difficulty-${difficulty}`}
              className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase"
            >
              {DIFFICULTY_LABELS[difficulty]}
            </h2>
            <ul className="space-y-1">
              {group.map((drill) => {
                const current = drill.id === selected?.id;
                return (
                  <li key={drill.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(drill.id)}
                      aria-current={current ? 'true' : undefined}
                      className={cn(
                        'w-full rounded-md px-2 py-1.5 text-left text-sm',
                        'hover:bg-accent focus-visible:ring-ring focus-visible:ring-2',
                        // Not colour alone: the current drill is also bold.
                        current && 'bg-accent font-semibold',
                      )}
                    >
                      {drill.sentence}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>

      {selected && <PracticePanel key={selected.id} drill={selected} />}
    </div>
  );
}
