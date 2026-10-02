import type { D1Migration } from '@cloudflare/vitest-plugin';

/**
 * Augments the generated `Cloudflare.Env` with bindings that exist only under test.
 * `TEST_MIGRATIONS` is injected by `vitest.config.ts`.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
