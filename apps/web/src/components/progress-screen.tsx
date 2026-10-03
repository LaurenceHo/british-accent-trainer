import { useProgress } from '@/api/hooks';
import { RecentAttempts } from '@/components/recent-attempts';
import { TrendChart } from '@/components/trend-chart';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { localDateString } from '@/progress/trend';

/** The window the progress screen covers, in whole local days. */
export const PROGRESS_WINDOW_DAYS = 90;

/**
 * Practice over time: one clarity trend per RP feature, never a single global average, and
 * the latest attempts to replay.
 *
 * Every number here is clarity — how intelligibly the words came through. The engine cannot
 * judge accent (`spike/FINDINGS.md`), so nothing on this screen claims to.
 */
export function ProgressScreen() {
  const progress = useProgress(PROGRESS_WINDOW_DAYS);

  if (progress.isPending) {
    return (
      <p className="text-muted-foreground" aria-live="polite">
        Loading progress…
      </p>
    );
  }

  if (progress.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Progress could not be loaded</AlertTitle>
        <AlertDescription>Check that the API is running, then reload the page.</AlertDescription>
      </Alert>
    );
  }

  const { features, windowDays } = progress.data;
  const practised = features.some((f) => f.attempts > 0);
  const today = localDateString(new Date());

  return (
    <div className="space-y-8">
      <section className="space-y-4" aria-labelledby="trends-heading">
        <div className="space-y-1">
          <h2 id="trends-heading" className="text-xl font-semibold tracking-tight">
            Clarity by feature
          </h2>
          <p className="text-muted-foreground text-sm">
            The last {windowDays} days. Clarity is how clearly the words came through — it is
            not a measure of accent, which only your ear can judge.
          </p>
        </div>

        {practised ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {features.map((feature) => (
              <TrendChart
                key={feature.feature}
                feature={feature}
                windowDays={windowDays}
                today={today}
              />
            ))}
          </div>
        ) : (
          <p>
            No attempts in the last {windowDays} days.{' '}
            <a href="#/" className="underline underline-offset-4">
              Record a drill
            </a>{' '}
            to start tracking clarity.
          </p>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="text-xl font-semibold tracking-tight">
          Recent attempts
        </h2>
        <RecentAttempts />
      </section>
    </div>
  );
}
