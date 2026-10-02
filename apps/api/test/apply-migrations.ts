import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

/**
 * Applies the D1 schema before any test runs.
 *
 * Each test file gets an isolated database, so this runs per file. Migrations are supplied
 * as a binding by `vitest.config.ts` because the Workers runtime cannot read the filesystem.
 */
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
