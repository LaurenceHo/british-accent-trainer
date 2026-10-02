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
        bindings: {
          TEST_MIGRATIONS: migrations,
          // Dummy credentials override the real ones in .dev.vars. The suite must never
          // call Azure; with real values, a test that forgot to stub fetch would do so
          // silently, spending quota and sending the real key.
          AZURE_SPEECH_KEY: 'test-key-not-real',
          AZURE_SPEECH_REGION: 'testregion',
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
