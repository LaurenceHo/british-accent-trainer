import { env } from 'cloudflare:test';
import { vi } from 'vitest';
import type { RpFeature } from '../src/domain';

/**
 * Replaces global `fetch` with a stub that answers every call with `body`.
 *
 * Route tests run the whole handler — validation, the provider, D1 — so stubbing at the
 * HTTP boundary is what keeps them from calling the live Azure API. Callers restore the
 * real `fetch` with `vi.unstubAllGlobals()`.
 *
 * @param body - A string is sent as-is; anything else is JSON-encoded.
 * @param init - Response status and headers. Defaults to 200.
 * @returns The spy, so tests can assert on what was (or was not) sent upstream.
 */
export function stubAzure(body: unknown, init: ResponseInit = { status: 200 }) {
  const spy = vi.fn(
    async (_input: unknown, _init?: unknown) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), init),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

/**
 * Inserts (or replaces) a drill row with placeholder values for the fields routes ignore.
 *
 * @param id - Drill id. Defaults to `test-drill`.
 * @param sentence - The reference text submissions are scored against.
 * @param feature - The RP feature the drill trains. Defaults to `BATH`.
 */
export async function seedDrill(
  id = 'test-drill',
  sentence = 'Pass me a glass of water',
  feature: RpFeature = 'BATH',
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO drills
     (id, sentence, target_ipa, feature, difficulty, coaching_note, has_r_context, sort_order)
     VALUES (?, ?, 'x', ?, 4, 'note', 0, 1)`,
  )
    .bind(id, sentence, feature)
    .run();
}
