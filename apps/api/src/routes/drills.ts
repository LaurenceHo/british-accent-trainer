import { Hono } from 'hono';
import { toDifficulty, type Drill, type RpFeature } from '../domain';
import type { Env } from '../types';

/** Row shape as stored in D1. Column names are snake_case; the API returns camelCase. */
interface DrillRow {
  readonly id: string;
  readonly sentence: string;
  readonly target_ipa: string;
  readonly feature: string;
  readonly coaching_note: string;
  readonly has_r_context: number;
  readonly difficulty: number;
  readonly sort_order: number;
}

/** Maps a D1 row to the API representation. */
function toDrill(row: DrillRow): Drill {
  return {
    id: row.id,
    sentence: row.sentence,
    targetIpa: row.target_ipa,
    feature: row.feature as RpFeature,
    difficulty: toDifficulty(row.difficulty),
    coachingNote: row.coaching_note,
    hasRContext: row.has_r_context === 1,
    sortOrder: row.sort_order,
  };
}

const SELECT_COLUMNS =
  'id, sentence, target_ipa, feature, difficulty, coaching_note, has_r_context, sort_order';

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

/**
 * Lists drills, easiest first.
 *
 * Ordering by difficulty then `sort_order` means the natural progression — isolate the
 * sound, contrast it, build up to flowing speech — is the default presentation.
 *
 * Optional filters: `?feature=BATH`, `?difficulty=1`, or both.
 */
drills.get('/', async (c) => {
  const feature = c.req.query('feature');
  const difficultyParam = c.req.query('difficulty');

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (feature) {
    conditions.push('feature = ?');
    bindings.push(feature);
  }

  if (difficultyParam !== undefined) {
    const difficulty = Number(difficultyParam);
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
      return c.json({ error: 'difficulty must be an integer from 1 to 5' }, 400);
    }
    conditions.push('difficulty = ?');
    bindings.push(difficulty);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT ${SELECT_COLUMNS} FROM drills${where} ORDER BY difficulty, sort_order`;

  const { results } = await c.env.DB.prepare(sql)
    .bind(...bindings)
    .all<DrillRow>();

  return c.json({ drills: results.map(toDrill) });
});

/** Fetches one drill by id. */
drills.get('/:id', async (c) => {
  const drill = await findDrill(c.env.DB, c.req.param('id'));
  if (!drill) return c.json({ error: 'drill not found' }, 404);
  return c.json(drill);
});

export default drills;
