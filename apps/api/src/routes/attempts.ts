import { Hono } from 'hono';
import { assertScorableWav, InvalidAudioError } from '../audio/wav';
import type { Attempt, WordScore } from '../domain';
import { AzureScoringProvider } from '../scoring/azure';
import { ScoringError, type ClarityAssessment, type ScoringProvider } from '../scoring/provider';
import type { Env } from '../types';
import { findDrill } from './drills';

/**
 * Recording submission.
 *
 * Audio is validated here rather than relying on the provider: the provider's
 * `Content-Type` header *asserts* 16 kHz mono PCM, and sending something else yields an
 * opaque upstream 400. Checking the header locally turns that into a precise message.
 */

/** Maximum accepted upload. 30s of 16 kHz 16-bit mono is ~960 KB; this leaves headroom. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Row shape as stored in D1. */
interface AttemptRow {
  readonly id: string;
  readonly drill_id: string;
  readonly created_at: string;
  readonly accuracy_score: number | null;
  readonly fluency_score: number | null;
  readonly completeness_score: number | null;
  readonly pron_score: number | null;
  readonly word_scores: string | null;
  readonly feature_verdicts: string | null;
  readonly audio_key: string | null;
}

function toAttempt(row: AttemptRow): Attempt {
  return {
    id: row.id,
    drillId: row.drill_id,
    createdAt: row.created_at,
    accuracyScore: row.accuracy_score,
    fluencyScore: row.fluency_score,
    completenessScore: row.completeness_score,
    pronScore: row.pron_score,
    wordScores: row.word_scores ? (JSON.parse(row.word_scores) as WordScore[]) : [],
    // Detection was disproven, so no verdicts are produced. The column stays because the
    // three-state shape is still the right one if a capable provider ever appears.
    featureFindings: [],
    audioKey: row.audio_key,
  };
}

/** Flattens a clarity assessment into the per-word shape stored against an attempt. */
function toWordScores(assessment: ClarityAssessment): WordScore[] {
  return assessment.words.map((word) => ({
    word: word.word,
    score: word.score,
    phonemes: word.phonemes.map((p) => ({
      score: p.score,
      offset: p.offset,
      duration: p.duration,
    })),
  }));
}

/** Maps a scoring failure onto an HTTP status the client can act on. */
function statusFor(error: ScoringError): 400 | 502 | 503 {
  if (error.code === 'not-recognised') return 400;
  if (error.code === 'throttled') return 503;
  return 502;
}

const attempts = new Hono<{ Bindings: Env }>();

/**
 * Submits a recording for a drill.
 *
 * Accepts the raw WAV as the request body with `?drillId=`, rather than multipart: the
 * browser already produces an `ArrayBuffer`, and multipart would add an encode/decode
 * round trip for a single field.
 */
attempts.post('/', async (c) => {
  const drillId = c.req.query('drillId');
  if (!drillId) return c.json({ error: 'drillId query parameter is required' }, 400);

  const drill = await findDrill(c.env.DB, drillId);
  if (!drill) return c.json({ error: 'drill not found' }, 404);

  const audio = await c.req.arrayBuffer();
  if (audio.byteLength > MAX_UPLOAD_BYTES) {
    return c.json({ error: 'Audio upload is too large' }, 413);
  }

  try {
    assertScorableWav(audio);
  } catch (error) {
    if (error instanceof InvalidAudioError) return c.json({ error: error.message }, 400);
    throw error;
  }

  const provider: ScoringProvider = new AzureScoringProvider({
    key: c.env.AZURE_SPEECH_KEY,
    region: c.env.AZURE_SPEECH_REGION,
  });

  let assessment: ClarityAssessment;
  try {
    // Scored against the drill's own sentence, never against client-supplied text —
    // otherwise a caller could score themselves against whatever they liked.
    assessment = await provider.assess(audio, drill.sentence);
  } catch (error) {
    if (error instanceof ScoringError) {
      return c.json({ error: error.message, code: error.code }, statusFor(error));
    }
    throw error;
  }

  const attempt: Attempt = {
    id: crypto.randomUUID(),
    drillId: drill.id,
    createdAt: new Date().toISOString(),
    accuracyScore: assessment.accuracy,
    fluencyScore: assessment.fluency,
    completenessScore: assessment.completeness,
    pronScore: assessment.overall,
    wordScores: toWordScores(assessment),
    featureFindings: [],
    audioKey: null,
  };

  await c.env.DB.prepare(
    `INSERT INTO attempts
     (id, drill_id, created_at, accuracy_score, fluency_score, completeness_score,
      pron_score, word_scores, feature_verdicts, audio_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      attempt.id,
      attempt.drillId,
      attempt.createdAt,
      attempt.accuracyScore,
      attempt.fluencyScore,
      attempt.completenessScore,
      attempt.pronScore,
      JSON.stringify(attempt.wordScores),
      JSON.stringify(attempt.featureFindings),
      attempt.audioKey,
    )
    .run();

  return c.json({ attempt, recognisedText: assessment.recognisedText }, 201);
});

/** Lists attempts, newest first, optionally for one drill. */
attempts.get('/', async (c) => {
  const drillId = c.req.query('drillId');

  const query = drillId
    ? c.env.DB.prepare('SELECT * FROM attempts WHERE drill_id = ? ORDER BY created_at DESC').bind(
        drillId,
      )
    : c.env.DB.prepare('SELECT * FROM attempts ORDER BY created_at DESC');

  const { results } = await query.all<AttemptRow>();
  return c.json({ attempts: results.map(toAttempt) });
});

/** Fetches one attempt. */
attempts.get('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM attempts WHERE id = ?')
    .bind(c.req.param('id'))
    .first<AttemptRow>();

  if (!row) return c.json({ error: 'attempt not found' }, 404);
  return c.json(toAttempt(row));
});

export default attempts;
