import { useProgress } from '@/api/hooks';
import { RecentAttempts } from '@/components/recent-attempts';
import { TrendChart } from '@/components/trend-chart';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/** The window the progress screen covers, in whole local days. */
export const PROGRESS_WINDOW_DAYS = 90;

/**
 * Practice over time: one clarity trend per RP feature, never a single global average, and
 * the latest attempts to replay.
 *
 * The two sections load independently, so recent attempts appear — and stay replayable —
 * even while progress is loading or has failed.
 *
 * Every number here is clarity — how intelligibly the words came through. The engine cannot
 * judge accent (`spike/FINDINGS.md`), so nothing on this screen claims to.
 */
export function ProgressScreen() {
  return (
    <div className="space-y-8">
      <section className="space-y-4" aria-labelledby="trends-heading">
        <div className="space-y-1">
          <h2 id="trends-heading" className="text-xl font-semibold tracking-tight">
            Clarity by feature
          </h2>
          <p className="text-muted-foreground text-sm">
            The last {PROGRESS_WINDOW_DAYS} days. Clarity is how clearly the words came through
            — it is not a measure of accent, which only your ear can judge.
          </p>
        </div>
        <Trends />
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

function Trends() {
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

  const { features, windowDays, today } = progress.data;

  if (!features.some((f) => f.attempts > 0)) {
    return (
      <p>
        No attempts in the last {windowDays} days.{' '}
        <a href="#/" className="underline underline-offset-4">
          Record a drill
        </a>{' '}
        to start tracking clarity.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {features.map((feature) => (
        // `today` from the server, not this device's clock: the buckets were drawn by the
        // server's, and a device a few minutes out would push the newest day off the chart.
        <TrendChart key={feature.feature} feature={feature} windowDays={windowDays} today={today} />
      ))}
    </div>
  );
}
