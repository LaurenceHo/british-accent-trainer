import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Proves the D1 binding is reachable from inside a test before any schema exists.
 *
 * This is the load-bearing check for the whole test strategy: every later API test
 * depends on D1 being available here. `SELECT 1` needs no tables, so this stays valid
 * from Task 0 onward and fails loudly if the Workers pool is ever misconfigured.
 */
describe('D1 binding', () => {
  it('is reachable and answers a trivial query', async () => {
    const row = await env.DB.prepare('SELECT 1 AS one').first<{ one: number }>();
    expect(row?.one).toBe(1);
  });
});

describe('R2 binding', () => {
  it('is reachable and returns null for a missing object', async () => {
    const missing = await env.AUDIO.get('does-not-exist');
    expect(missing).toBeNull();
  });
});
