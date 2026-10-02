import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { assertScorableWav, InvalidAudioError } from '../audio/wav';
import { readAzureConfig } from '../azure-config';
import type { Attempt, WordScore } from '../domain';
import { AzureScoringProvider } from '../scoring/azure';
import {
  ScoringError,
  type ClarityAssessment,
  type ScoringErrorCode,
  type ScoringProvider,
} from '../scoring/provider';
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

/** Default and ceiling for `GET /api/attempts`. Each row carries per-phoneme timings. */
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/**
 * What the client is told for each failure.
 *
 * Fixed text, never the provider's message: that carries the vendor name, upstream status
 * and up to 200 characters of the upstream body. The detail goes to the server log, where
 * it is useful, rather than to the browser, where it is not.
 */
const CLIENT_MESSAGES: Record<ScoringErrorCode, string> = {
  'not-recognised': 'No speech was recognised. Check your microphone and try again.',
  throttled: 'The scoring service is busy. Wait a moment and try again.',
  unauthorised: 'The scoring service is unavailable.',
  upstream: 'The scoring service is unavailable.',
};

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

/**
 * Parses the stored word scores, tolerating a bad value.
 *
 * Only this server writes the column, but schema changes and manual edits happen — and an
 * exception here would fail the whole list rather than the one row.
 */
function parseWordScores(row: AttemptRow): WordScore[] {
  if (!row.word_scores) return [];
  try {
    const parsed: unknown = JSON.parse(row.word_scores);
    if (Array.isArray(parsed)) return parsed as WordScore[];
  } catch {
    // Fall through to the log below.
  }
  console.error(`attempt ${row.id}: unreadable word_scores, returning none`);
  return [];
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
    wordScores: parseWordScores(row),
    // Detection was disproven, so no verdicts are produced. The column stays because the
    // three-state shape is still the right one if a capable provider ever appears.
    featureFindings: [],
    audioKey: row.audio_key,
  };
}

/**
 * Flattens a clarity assessment into the per-word shape stored against an attempt.
 *
 * A whitelist rather than a spread: it deliberately drops word-level error types and
 * timings, so what is persisted is decided here and not by the provider's shape.
 */
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

/**
 * Stores the submitted recording so it can be replayed against the reference later.
 *
 * Runs after scoring succeeds, so a rejected or unrecognised recording never occupies
 * storage. A storage failure does not fail the request: the score has already been paid
 * for, and the learner still has the recording in their browser for this session. The
 * attempt is saved with no audio and the failure is logged.
 *
 * The key is derived from the server-generated attempt id, never from client input.
 *
 * @returns The R2 key, or `null` when the write failed.
 */
async function storeAttemptAudio(
  bucket: R2Bucket,
  attemptId: string,
  audio: ArrayBuffer,
): Promise<string | null> {
  const key = `attempts/${attemptId}.wav`;
  try {
    await bucket.put(key, audio, { httpMetadata: { contentType: 'audio/wav' } });
    return key;
  } catch (error) {
    console.error(`attempt ${attemptId}: audio not stored`, error);
    return null;
  }
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
 *
 * The body limit is middleware rather than a length check after reading. Reading first
 * would buffer up to the platform's 100 MB request limit into a 128 MB isolate before the
 * check ran; the middleware rejects on `Content-Length` and stops a chunked upload as soon
 * as it crosses the limit.
 */
attempts.post(
  '/',
  bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: (c) => c.json({ error: 'Audio upload is too large' }, 413),
  }),
  async (c) => {
    const drillId = c.req.query('drillId');
    if (!drillId) return c.json({ error: 'drillId query parameter is required' }, 400);

    const config = readAzureConfig(c.env);
    if (!config) {
      console.error('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing or malformed');
      return c.json({ error: 'Scoring is not configured.' }, 503);
    }

    const drill = await findDrill(c.env.DB, drillId);
    if (!drill) return c.json({ error: 'drill not found' }, 404);

    const audio = await c.req.arrayBuffer();

    try {
      assertScorableWav(audio);
    } catch (error) {
      if (error instanceof InvalidAudioError) return c.json({ error: error.message }, 400);
      throw error;
    }

    let assessment: ClarityAssessment;
    try {
      const provider: ScoringProvider = new AzureScoringProvider(config);
      // Scored against the drill's own sentence, never against client-supplied text —
      // otherwise a caller could score themselves against whatever they liked.
      assessment = await provider.assess(audio, drill.sentence);
    } catch (error) {
      if (error instanceof ScoringError) {
        console.error(`scoring failed for drill ${drill.id}:`, error.message, error.cause);
        return c.json(
          { error: CLIENT_MESSAGES[error.code], code: error.code },
          statusFor(error),
        );
      }
      throw error;
    }

    const id = crypto.randomUUID();
    const audioKey = await storeAttemptAudio(c.env.AUDIO, id, audio);

    const attempt: Attempt = {
      id,
      drillId: drill.id,
      createdAt: new Date().toISOString(),
      accuracyScore: assessment.accuracy,
      fluencyScore: assessment.fluency,
      completenessScore: assessment.completeness,
      pronScore: assessment.overall,
      wordScores: toWordScores(assessment),
      featureFindings: [],
      audioKey,
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
  },
);

/**
 * Lists attempts, newest first, optionally for one drill.
 *
 * Bounded by `?limit=` (default 50, at most 200). `id` breaks ties so attempts created in
 * the same millisecond come back in a stable order.
 */
attempts.get('/', async (c) => {
  const drillId = c.req.query('drillId');
  const limitParam = c.req.query('limit');

  let limit = DEFAULT_LIST_LIMIT;
  if (limitParam !== undefined) {
    limit = Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
      return c.json({ error: `limit must be an integer from 1 to ${MAX_LIST_LIMIT}` }, 400);
    }
  }

  const where = drillId ? 'WHERE drill_id = ?' : '';
  const bindings = drillId ? [drillId, limit] : [limit];

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM attempts ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(...bindings)
    .all<AttemptRow>();

  return c.json({ attempts: results.map(toAttempt) });
});

/**
 * Streams the learner's recording for an attempt, for replay against the reference.
 *
 * Attempt audio never changes once written — the key is a fresh UUID — so it is cacheable
 * indefinitely. `private` because it is the user's own voice.
 */
attempts.get('/:id/audio', async (c) => {
  const row = await c.env.DB.prepare('SELECT audio_key FROM attempts WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ audio_key: string | null }>();

  if (!row) return c.json({ error: 'attempt not found' }, 404);
  if (!row.audio_key) return c.json({ error: 'no audio was stored for this attempt' }, 404);

  const object = await c.env.AUDIO.get(row.audio_key);
  if (!object) return c.json({ error: 'audio is no longer available' }, 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': 'audio/wav',
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
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
