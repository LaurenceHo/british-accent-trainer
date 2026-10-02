import { Hono } from 'hono';
import {
  DEFAULT_VOICE,
  isReferenceVoice,
  REFERENCE_VOICES,
  SpeechSynthesisError,
  synthesiseSpeech,
  type ReferenceVoice,
} from '../tts/azure';
import { readAzureConfig } from '../azure-config';
import type { Env } from '../types';
import { findDrill } from './drills';

/**
 * Reference audio for a drill: a native RP model to shadow.
 *
 * Synthesised once and cached in R2. The key includes a hash of the sentence, so editing a
 * drill's text invalidates its audio automatically — no stale recording of the old wording,
 * and no manual purge step to forget.
 */

/** Hex SHA-256 prefix. Long enough to make collisions irrelevant at corpus scale. */
async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest, 0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The R2 key for a drill's reference audio in a given voice. */
export async function referenceAudioKey(
  drillId: string,
  sentence: string,
  voice: ReferenceVoice,
): Promise<string> {
  return `reference/${voice}/${drillId}-${await shortHash(sentence)}.wav`;
}

/**
 * The R2 key doubles as a strong validator: it changes exactly when the audio does.
 *
 * The URL stays the same when a drill's sentence is edited, so a plain `max-age` would
 * have the browser — and later the PWA service worker — keep serving the old wording.
 * `no-cache` with this ETag means every play revalidates, and an unchanged recording costs
 * a 304 rather than a re-download.
 */
function etagFor(key: string): string {
  return `"${key}"`;
}

function wavResponse(
  audio: ArrayBuffer | ReadableStream,
  key: string,
  cache: 'HIT' | 'MISS',
): Response {
  return new Response(audio, {
    headers: {
      'Content-Type': 'audio/wav',
      'Cache-Control': 'no-cache',
      ETag: etagFor(key),
      'X-Reference-Cache': cache,
    },
  });
}

const referenceAudio = new Hono<{ Bindings: Env }>();

/** Returns the reference recording for a drill, synthesising and caching it on first use. */
referenceAudio.get('/:id/reference-audio', async (c) => {
  const voice = c.req.query('voice') ?? DEFAULT_VOICE;
  if (!isReferenceVoice(voice)) {
    return c.json({ error: `voice must be one of: ${REFERENCE_VOICES.join(', ')}` }, 400);
  }

  const drill = await findDrill(c.env.DB, c.req.param('id'));
  if (!drill) return c.json({ error: 'drill not found' }, 404);

  const key = await referenceAudioKey(drill.id, drill.sentence, voice);

  // Answered before touching R2: the key already says whether the client's copy is current.
  if (c.req.header('If-None-Match') === etagFor(key)) {
    return new Response(null, { status: 304, headers: { ETag: etagFor(key) } });
  }

  const cached = await c.env.AUDIO.get(key);
  if (cached) return wavResponse(cached.body, key, 'HIT');

  // Checked only on a cache miss: already-synthesised audio stays servable even if the
  // credentials are later removed.
  const config = readAzureConfig(c.env);
  if (!config) {
    console.error('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing or malformed');
    return c.json({ error: 'Reference audio is not configured.' }, 503);
  }

  let audio: ArrayBuffer;
  try {
    audio = await synthesiseSpeech(config, drill.sentence, voice);
  } catch (error) {
    if (error instanceof SpeechSynthesisError) {
      // The message holds only the upstream status, never the body or the key.
      console.error(`reference audio failed for drill ${drill.id} (${voice}):`, error.message, error.cause);
      return c.json({ error: 'Reference audio is temporarily unavailable' }, 502);
    }
    throw error;
  }

  // A failed cache write should not cost the user the audio already in hand. The next
  // request simply synthesises again.
  try {
    await c.env.AUDIO.put(key, audio, { httpMetadata: { contentType: 'audio/wav' } });
  } catch (error) {
    console.error(`reference audio for drill ${drill.id} not cached`, error);
  }
  return wavResponse(audio, key, 'MISS');
});

export default referenceAudio;
