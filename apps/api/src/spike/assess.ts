import { Hono } from 'hono';
import type { Env } from '../types';
import { summarise, type AzureAssessmentResponse } from './azure-types';
import { analyseRhoticity } from './rhotic-detector';
import { RECORDER_HTML } from './recorder-page';

/**
 * THROWAWAY — Task 1 engine spike. Delete once the vendor decision is final.
 *
 * Answers whether Azure's `en-GB` pronunciation assessment is fit for RP training.
 * A Microsoft engineer stated `en-GB` phones were produced by copying the **en-US**
 * inventory. If Azure segments `en-GB` audio against an American phone set, correct
 * non-rhotic RP (*car* = `kɑː`, 2 phones) is matched against rhotic `k ɑ r` (3 phones) —
 * breaking index alignment, and possibly scoring correct RP as an error on the /r/ slot.
 *
 * Two routes:
 *   GET  /spike/run            — synthetic A/B using Azure TTS voices (no human needed)
 *   GET  /spike/recorder       — browser page for recording real speech
 *   POST /spike/assess-upload  — assess an uploaded 16 kHz mono WAV
 *
 * An absolute score is uninterpretable, hence the A/B: the same word produced both
 * non-rhotically and rhotically, each assessed at `en-GB`.
 */

/** One synthetic A/B probe. */
interface Probe {
  readonly label: string;
  readonly text: string;
  readonly voice: string;
  /** Expected RP phone count, for the index-alignment parity check. 0 = not checked. */
  readonly expectedRpPhones: number;
}

const PROBES: readonly Probe[] = [
  // RP /kɑː/ = 2 phones. General American /kɑr/ = 3.
  { label: 'car / non-rhotic RP', text: 'car', voice: 'en-GB-SoniaNeural', expectedRpPhones: 2 },
  { label: 'car / rhotic GA', text: 'car', voice: 'en-US-JennyNeural', expectedRpPhones: 2 },
  { label: 'water / non-rhotic RP', text: 'water', voice: 'en-GB-SoniaNeural', expectedRpPhones: 5 },
  { label: 'water / rhotic GA', text: 'water', voice: 'en-US-JennyNeural', expectedRpPhones: 5 },
  {
    label: 'sentence / non-rhotic RP',
    text: 'Pass me a glass of water',
    voice: 'en-GB-SoniaNeural',
    expectedRpPhones: 0,
  },
  {
    label: 'sentence / rhotic GA',
    text: 'Pass me a glass of water',
    voice: 'en-US-JennyNeural',
    expectedRpPhones: 0,
  },
];

/** Synthesises `text` with `voice` as 16 kHz/16-bit/mono PCM WAV — the format assessment requires. */
async function synthesise(env: Env, text: string, voice: string): Promise<ArrayBuffer> {
  const lang = voice.startsWith('en-GB') ? 'en-GB' : 'en-US';
  const ssml =
    `<speak version='1.0' xml:lang='${lang}'>` + `<voice name='${voice}'>${text}</voice></speak>`;

  const res = await fetch(
    `https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-16khz-16bit-mono-pcm',
        'User-Agent': 'accent-trainer-spike',
      },
      body: ssml,
    },
  );

  if (!res.ok) throw new Error(`TTS failed ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
}

/** Submits WAV audio for `en-GB` pronunciation assessment against `referenceText`. */
async function assess(
  env: Env,
  wav: ArrayBuffer,
  referenceText: string,
  locale = 'en-GB',
  nBestPhonemes = 0,
): Promise<AzureAssessmentResponse> {
  const config = {
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    Dimension: 'Comprehensive',
    PhonemeAlphabet: 'IPA',
    ...(nBestPhonemes > 0 ? { NBestPhonemeCount: nBestPhonemes } : {}),
  };

  const res = await fetch(
    `https://${env.AZURE_SPEECH_REGION}.stt.speech.microsoft.com` +
      `/speech/recognition/conversation/cognitiveservices/v1?language=${locale}`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        'Pronunciation-Assessment': btoa(JSON.stringify(config)),
        Accept: 'application/json',
      },
      body: wav,
    },
  );

  if (!res.ok) throw new Error(`Assessment failed ${res.status}: ${await res.text()}`);
  return res.json<AzureAssessmentResponse>();
}

const spike = new Hono<{ Bindings: Env }>();

/** Synthetic A/B — no human recording required. */
spike.get('/run', async (c) => {
  const results = [];
  for (const probe of PROBES) {
    try {
      const wav = await synthesise(c.env, probe.text, probe.voice);
      const raw = await assess(c.env, wav, probe.text);
      results.push({
        label: probe.label,
        text: probe.text,
        voice: probe.voice,
        expectedRpPhones: probe.expectedRpPhones,
        ...summarise(raw),
        raw,
      });
    } catch (err) {
      return c.json({ error: String(err), failedOn: probe.label }, 502);
    }
  }
  return c.json({ generatedAt: new Date().toISOString(), results });
});

/**
 * The inversion test: assess at `en-US`, which DOES return phoneme names and
 * `NBestPhonemes`, and read the result backwards.
 *
 * At `en-US` the reference for *car* is /k ɑ r/. A speaker producing correct non-rhotic RP
 * omits that /r/, so the /r/ phone should score LOW. A **low /r/ score therefore means
 * correct RP** — the American model becomes a rhoticity detector when its verdict is
 * inverted. This does not score the user against General American; it uses the American
 * model only to locate and measure one specific feature.
 */
spike.get('/run-us', async (c) => {
  const words: readonly Probe[] = PROBES.filter((p) => p.expectedRpPhones > 0);
  const results = [];

  for (const probe of words) {
    try {
      const wav = await synthesise(c.env, probe.text, probe.voice);
      const raw = await assess(c.env, wav, probe.text, 'en-US', 5);
      const w = raw.NBest?.[0]?.Words?.[0];
      results.push({
        label: probe.label,
        text: probe.text,
        overall: raw.NBest?.[0]?.AccuracyScore ?? null,
        // Per-phoneme with NAMES — available at en-US but not en-GB.
        phonemes: (w?.Phonemes ?? []).map((p) => ({
          phoneme: p.Phoneme,
          score: p.AccuracyScore,
        })),
        raw,
      });
    } catch (err) {
      return c.json({ error: String(err), failedOn: probe.label }, 502);
    }
  }
  return c.json({ generatedAt: new Date().toISOString(), locale: 'en-US', results });
});

/** Browser recorder for testing with real speech. */
spike.get('/recorder', (c) => c.html(RECORDER_HTML));

/** Assesses an uploaded 16 kHz mono WAV against `?text=`. */
spike.post('/assess-upload', async (c) => {
  const text = c.req.query('text');
  if (!text) return c.json({ error: 'missing ?text= reference text' }, 400);

  const wav = await c.req.arrayBuffer();
  if (wav.byteLength < 44) return c.json({ error: 'body is not a WAV file' }, 400);

  // The REST assessment path caps audio at 30 seconds. 16 kHz mono 16-bit = 32000 bytes/sec.
  if (wav.byteLength > 30 * 32000 + 44) {
    return c.json({ error: 'audio exceeds the 30 second limit' }, 400);
  }

  try {
    // Two assessments of the same audio:
    //   en-GB — the scoring the product would normally use
    //   en-US — used only as a rhoticity feature detector, verdict inverted
    const [gb, us] = await Promise.all([
      assess(c.env, wav, text, 'en-GB'),
      assess(c.env, wav, text, 'en-US', 5),
    ]);

    return c.json({
      ...summarise(gb),
      heard: gb.DisplayText ?? null,
      rhotic: analyseRhoticity(us),
      usPhonemes: (us.NBest?.[0]?.Words ?? []).flatMap((w) =>
        (w.Phonemes ?? []).map((p) => ({ phoneme: p.Phoneme, score: p.AccuracyScore })),
      ),
      raw: { gb, us },
    });
  } catch (err) {
    return c.json({ error: String(err) }, 502);
  }
});

export default spike;
