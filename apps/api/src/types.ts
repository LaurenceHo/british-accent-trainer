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

