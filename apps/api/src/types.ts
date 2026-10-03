import type { RpFeature } from './domain';

/**
 * Bindings and secrets available to the Worker at runtime.
 *
 * Sourced from the generated `worker-configuration.d.ts` — regenerate with
 * `bunx wrangler types` after changing bindings in `wrangler.jsonc`.
 *
 * Bindings (`DB`, `AUDIO`) come from `wrangler.jsonc`. Secrets
 * (`AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`) come from `.dev.vars` locally and
 * from Worker secrets when deployed — never from `wrangler.jsonc`.
 */
export type Env = Cloudflare.Env;

/** Shape of the `/health` response. */
export interface HealthResponse {
  readonly status: 'ok';
}

/** One day's practice on one feature. */
export interface DailyProgress {
  /** Calendar date in the requested timezone, `YYYY-MM-DD`. */
  readonly date: string;
  readonly attempts: number;
  /** Mean clarity accuracy, 0-100, or null if no attempt that day produced a score. */
  readonly averageAccuracy: number | null;
  readonly averageFluency: number | null;
}

/** Progress on one RP feature. */
export interface FeatureProgress {
  readonly feature: RpFeature;
  readonly label: string;
  /** Total attempts in the window. Zero means the feature has not been practised. */
  readonly attempts: number;
  /** Oldest first, one entry per day with at least one attempt. */
  readonly days: readonly DailyProgress[];
}

/** Response of `GET /api/progress`. */
export interface ProgressResponse {
  /** Always `clarity`: the averages measure intelligibility, never accent. */
  readonly measures: 'clarity';
  /** Whole local days covered, today included. */
  readonly windowDays: number;
  /** Every RP feature, including unpractised ones, in a fixed order. */
  readonly features: readonly FeatureProgress[];
}
