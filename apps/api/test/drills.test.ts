import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/index';
import type { Drill } from '../src/domain';

/** Inserts a drill directly, so route tests do not depend on the seed script. */
async function insertDrill(overrides: Partial<Drill> = {}): Promise<Drill> {
  const drill: Drill = {
    id: 'test-drill',
    sentence: 'The car park is over there',
    targetIpa: 'ðə ˈkɑː pɑːk ɪz ˈəʊvə ðeə',
    feature: 'NON_RHOTIC_R',
    coachingNote: 'No r sounds at all.',
    hasRContext: true,
    sortOrder: 1,
    ...overrides,
  };

  await env.DB.prepare(
    `INSERT OR REPLACE INTO drills
     (id, sentence, target_ipa, feature, coaching_note, has_r_context, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      drill.id,
      drill.sentence,
      drill.targetIpa,
      drill.feature,
      drill.coachingNote,
      drill.hasRContext ? 1 : 0,
      drill.sortOrder,
    )
    .run();

  return drill;
}

describe('GET /api/drills', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM drills').run();
  });

  it('returns an empty list when no drills exist', async () => {
    const res = await app.request('/api/drills', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ drills: [] });
  });

  it('returns drills in sort order', async () => {
    await insertDrill({ id: 'second', sortOrder: 20 });
    await insertDrill({ id: 'first', sortOrder: 10 });

    const res = await app.request('/api/drills', {}, env);
    const body = (await res.json()) as { drills: Drill[] };

    expect(body.drills.map((d) => d.id)).toEqual(['first', 'second']);
  });

  it('maps snake_case columns to camelCase fields', async () => {
    await insertDrill({ id: 'mapped', hasRContext: true });

    const res = await app.request('/api/drills', {}, env);
    const body = (await res.json()) as { drills: Drill[] };
    const drill = body.drills[0];

    expect(drill).toBeDefined();
    expect(drill?.targetIpa).toBe('ðə ˈkɑː pɑːk ɪz ˈəʊvə ðeə');
    expect(drill?.coachingNote).toBe('No r sounds at all.');
    // Stored as INTEGER 0/1 in SQLite — must surface as a real boolean.
    expect(drill?.hasRContext).toBe(true);
  });

  it('preserves IPA characters exactly through the round trip', async () => {
    await insertDrill({ id: 'ipa', targetIpa: 'ɑː ɒ ɜː əʊ θ ð ʃ tjuː' });

    const res = await app.request('/api/drills', {}, env);
    const body = (await res.json()) as { drills: Drill[] };

    expect(body.drills[0]?.targetIpa).toBe('ɑː ɒ ɜː əʊ θ ð ʃ tjuː');
  });

  it('filters by feature', async () => {
    await insertDrill({ id: 'rhotic', feature: 'NON_RHOTIC_R' });
    await insertDrill({ id: 'bath', feature: 'BATH' });

    const res = await app.request('/api/drills?feature=BATH', {}, env);
    const body = (await res.json()) as { drills: Drill[] };

    expect(body.drills).toHaveLength(1);
    expect(body.drills[0]?.id).toBe('bath');
  });
});

describe('GET /api/drills/:id', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM drills').run();
  });

  it('returns the drill when it exists', async () => {
    await insertDrill({ id: 'findme' });

    const res = await app.request('/api/drills/findme', {}, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Drill).id).toBe('findme');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await app.request('/api/drills/nope', {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'drill not found' });
  });
});
