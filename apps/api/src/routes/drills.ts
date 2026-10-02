import { Hono } from 'hono';
import type { Drill, RpFeature } from '../domain';
import type { Env } from '../types';

/** Row shape as stored in D1. Column names are snake_case; the API returns camelCase. */
interface DrillRow {
  readonly id: string;
  readonly sentence: string;
  readonly target_ipa: string;
  readonly feature: string;
  readonly coaching_note: string;
  readonly has_r_context: number;
  readonly sort_order: number;
}

/** Maps a D1 row to the API representation. */
function toDrill(row: DrillRow): Drill {
  return {
    id: row.id,
    sentence: row.sentence,
    targetIpa: row.target_ipa,
    feature: row.feature as RpFeature,
    coachingNote: row.coaching_note,
    hasRContext: row.has_r_context === 1,
    sortOrder: row.sort_order,
  };
}

const SELECT_COLUMNS =
  'id, sentence, target_ipa, feature, coaching_note, has_r_context, sort_order';

/**
 * Looks up a single drill.
 *
 * @param db - The D1 binding.
 * @param id - Drill identifier.
 * @returns The drill, or `null` when no drill matches.
 */
export async function findDrill(db: D1Database, id: string): Promise<Drill | null> {
  const row = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM drills WHERE id = ?`)
    .bind(id)
    .first<DrillRow>();
  return row ? toDrill(row) : null;
}

const drills = new Hono<{ Bindings: Env }>();

/** Lists all drills in presentation order, optionally filtered by RP feature. */
drills.get('/', async (c) => {
  const feature = c.req.query('feature');

  const query = feature
    ? c.env.DB.prepare(
        `SELECT ${SELECT_COLUMNS} FROM drills WHERE feature = ? ORDER BY sort_order`,
      ).bind(feature)
    : c.env.DB.prepare(`SELECT ${SELECT_COLUMNS} FROM drills ORDER BY sort_order`);

  const { results } = await query.all<DrillRow>();
  return c.json({ drills: results.map(toDrill) });
});

/** Fetches one drill by id. */
drills.get('/:id', async (c) => {
  const drill = await findDrill(c.env.DB, c.req.param('id'));
  if (!drill) return c.json({ error: 'drill not found' }, 404);
  return c.json(drill);
});

export default drills;
