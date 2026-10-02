import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/**
 * API tests run inside the real Workers runtime via Miniflare, which is what makes the
 * D1 and R2 bindings available. Bun's own test runner cannot provide these.
 *
 * Migrations are read at config time (Node can touch the filesystem; the Workers runtime
 * cannot) and injected as a binding, then applied per test file by the setup script.
 */
// Relative to this config file's directory, which is vitest's working directory.
const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
