import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/**
 * API tests run inside the real Workers runtime via Miniflare, which is what makes the
 * D1 and R2 bindings available to tests. Bun's own test runner cannot provide these.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
});
