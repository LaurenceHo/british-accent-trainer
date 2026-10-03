import type { FeatureProgress } from '@api/domain';
import { percent } from '@/lib/utils';
import { describeTrend, trendPoints } from '@/progress/trend';

/** Props for {@link TrendChart}. */
export interface TrendChartProps {
  readonly feature: FeatureProgress;
  readonly windowDays: number;
  /** The window's last day, `YYYY-MM-DD`, as the server counted it: the chart's right edge. */
  readonly today: string;
}

/**
 * One RP feature's clarity over the window: a line through each practised day, placed by
 * date so a gap in practice shows as a gap.
 *
 * The line is SVG; the points are HTML overlays so they stay round on a chart that
 * stretches to its container. The chart's accessible name summarises it, and the numbers
 * are in a table beneath, so the trend does not depend on seeing the line.
 */
export function TrendChart({ feature, windowDays, today }: TrendChartProps) {
  const points = trendPoints(feature.days, windowDays, today);
  const practised = feature.attempts > 0;

  return (
    <figure className="space-y-2 rounded-lg border p-4">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{feature.label}</span>
        <span className="text-muted-foreground text-sm">
          {practised
            ? `${feature.attempts} ${feature.attempts === 1 ? 'attempt' : 'attempts'}`
            : 'Not practised yet'}
        </span>
      </figcaption>

      <div className="flex gap-2">
        {/* The axis labels are read from the table; here they only orient the eye. */}
        <div
          aria-hidden="true"
          className="text-muted-foreground flex h-24 flex-col justify-between text-right text-xs"
        >
          <span>100</span>
          <span>50</span>
          <span>0</span>
        </div>
        {/* Inset so a point at 0, 100 or either end of the window is drawn whole. */}
        <div className="bg-muted/40 rounded-md p-1.5 flex-1">
          <div className="relative h-21">
            <svg
              role="img"
              aria-label={describeTrend(feature, points, windowDays)}
              className="absolute inset-0 h-full w-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <line x1="0" y1="50" x2="100" y2="50" className="stroke-border" vectorEffect="non-scaling-stroke" />
              {points.length > 1 && (
                <polyline
                  points={points.map((p) => `${p.x * 100},${100 - p.value}`).join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            {points.map((p) => (
              <span
                key={p.date}
                aria-hidden="true"
                data-testid="trend-point"
                className="bg-foreground absolute size-2 -translate-x-1/2 translate-y-1/2 rounded-full"
                style={{ left: percent(p.x), bottom: percent(p.value / 100) }}
              />
            ))}
          </div>
        </div>
      </div>

      {practised && (
        <details className="text-sm">
          <summary className="cursor-pointer">Show the numbers</summary>
          <table className="mt-2 w-full text-left">
            <caption className="sr-only">{feature.label}, clarity by day</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Attempts</th>
                <th scope="col">Average clarity</th>
              </tr>
            </thead>
            <tbody>
              {/* Every practised day, so the attempts add up to the total above. */}
              {feature.days.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td>{d.attempts}</td>
                  <td>{d.averageAccuracy ?? 'Not scored'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  );
}
