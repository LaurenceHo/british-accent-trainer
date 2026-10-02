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

/**
 * Base64-encodes as UTF-8. `btoa` works on Latin-1 code units, so it silently mis-encodes
 * anything above U+007F and throws above U+00FF; Azure expects base64 of UTF-8 bytes.
 */
function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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
        'Pronunciation-Assessment': base64Utf8(JSON.stringify(config)),
        Accept: 'application/json',
      },
      body: wav,
    },
  );

  if (!res.ok) {
    throw new AssessmentError(res.status, await res.text());
  }
  return res.json<AzureAssessmentResponse>();
}

/** Carries the upstream HTTP status so callers can distinguish throttling from real failures. */
class AssessmentError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Assessment failed ${status}: ${body}`);
    this.name = 'AssessmentError';
  }
}

/**
 * Assesses with retry on HTTP 429.
 *
 * The Azure free tier (F0) permits only **one concurrent transcription**. Requests that
 * overlap — even two assessments of the same clip — are rejected with
 * "The number of parallel requests exceeded the number of allowed concurrent
 * transcriptions." Callers must therefore run assessments **sequentially**, and this
 * backoff absorbs the residual races when a previous request has not yet been released.
 */
async function assessWithRetry(
  env: Env,
  wav: ArrayBuffer,
  referenceText: string,
  locale: string,
  nBestPhonemes = 0,
  maxAttempts = 4,
): Promise<AzureAssessmentResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await assess(env, wav, referenceText, locale, nBestPhonemes);
    } catch (err) {
      lastError = err;
      const throttled = err instanceof AssessmentError && err.status === 429;
      if (!throttled || attempt === maxAttempts - 1) throw err;
      // 500ms, 1s, 2s — F0 releases its single slot quickly once the prior call completes.
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }

  throw lastError;
}

const spike = new Hono<{ Bindings: Env }>();

/** Synthetic A/B — no human recording required. */
spike.get('/run', async (c) => {
  const results = [];
  for (const probe of PROBES) {
    try {
      const wav = await synthesise(c.env, probe.text, probe.voice);
      const raw = await assessWithRetry(c.env, wav, probe.text, 'en-GB');
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
      const raw = await assessWithRetry(c.env, wav, probe.text, 'en-US', 5);
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

/**
 * Maps WHICH r-contexts the detector can actually judge.
 *
 * Validated on real speech: *car* classifies correctly both ways, *water* does not.
 * Hypothesis under test — detection works on **stressed** r-vowels (START `ɑː`, NORTH `ɔː`,
 * NURSE `ɜː`), where the American counterpart is acoustically distant, and fails on
 * **unstressed** schwa-r (lettER `ə`/`ɚ`), where the two are nearly identical.
 *
 * Synthetic audio is an acceptable proxy here: it agreed with real speech on both the
 * working case and the failing one. Spot-check the boundary with a real voice afterwards.
 */
const R_CONTEXT_WORDS: readonly { word: string; lexicalSet: string; stressed: boolean }[] = [
  { word: 'car', lexicalSet: 'START', stressed: true },
  { word: 'hard', lexicalSet: 'START', stressed: true },
  { word: 'north', lexicalSet: 'NORTH', stressed: true },
  { word: 'short', lexicalSet: 'NORTH', stressed: true },
  { word: 'more', lexicalSet: 'FORCE', stressed: true },
  { word: 'nurse', lexicalSet: 'NURSE', stressed: true },
  { word: 'word', lexicalSet: 'NURSE', stressed: true },
  { word: 'there', lexicalSet: 'SQUARE', stressed: true },
  { word: 'near', lexicalSet: 'NEAR', stressed: true },
  { word: 'water', lexicalSet: 'lettER', stressed: false },
  { word: 'better', lexicalSet: 'lettER', stressed: false },
  { word: 'father', lexicalSet: 'lettER', stressed: false },
];

spike.get('/run-contexts', async (c) => {
  const results = [];

  for (const item of R_CONTEXT_WORDS) {
    for (const [accent, voice] of [
      ['RP', 'en-GB-SoniaNeural'],
      ['GA', 'en-US-JennyNeural'],
    ] as const) {
      try {
        const wav = await synthesise(c.env, item.word, voice);
        const raw = await assessWithRetry(c.env, wav, item.word, 'en-US', 5);
        const analysis = analyseRhoticity(raw);
        results.push({
          word: item.word,
          lexicalSet: item.lexicalSet,
          stressed: item.stressed,
          accent,
          // RP should read false (r dropped); GA should read true (r produced).
          soundsBritish: analysis.soundsBritish,
          correct: accent === 'RP' ? analysis.soundsBritish === true : analysis.soundsBritish === false,
          findings: analysis.findings,
        });
      } catch (err) {
        results.push({ word: item.word, accent, error: String(err) });
      }
    }
  }

  return c.json({ generatedAt: new Date().toISOString(), results });
});

/**
 * Tests whether feature detection survives at SENTENCE level, and whether **vowel**
 * contrasts detect better than rhoticity.
 *
 * Rhoticity may be the hardest case — r-colouring sits in a narrow acoustic space. Vowel
 * contrasts are far wider: BATH is /ɑː/ in RP against /æ/ in American, a different vowel
 * entirely. If those detect reliably, the product gets real automated feedback on several
 * RP features and rhoticity is simply the one that does not work.
 *
 * Each item is synthesised with both an `en-GB` and an `en-US` voice and assessed at
 * `en-US`, where phoneme names and `NBestPhonemes` are available. A feature is detectable
 * only if the RP and GA renditions produce **different** heard-phones at the target word.
 */
const FEATURE_PROBES: readonly { text: string; feature: string; targetWords: string[] }[] = [
  // BATH — RP /ɑː/ vs GA /æ/. A whole vowel apart.
  { text: 'Ask the class about the bath', feature: 'BATH', targetWords: ['ask', 'class', 'bath'] },
  { text: 'bath', feature: 'BATH', targetWords: ['bath'] },
  // LOT — RP rounded /ɒ/ vs GA unrounded /ɑ/.
  { text: 'Tom got a job in the shop', feature: 'LOT', targetWords: ['tom', 'got', 'job', 'shop'] },
  { text: 'got', feature: 'LOT', targetWords: ['got'] },
  // GOAT — RP /əʊ/ starts central, GA /oʊ/ starts rounded.
  { text: 'Go home slowly', feature: 'GOAT', targetWords: ['go', 'home', 'slowly'] },
  // Rhoticity at sentence level — works on isolated *car*, untested in connected speech.
  { text: 'The car park is over there', feature: 'NON_RHOTIC_R', targetWords: ['car', 'park'] },
  { text: 'The nurse heard the first word', feature: 'NON_RHOTIC_R', targetWords: ['nurse', 'word'] },
];

spike.get('/run-features', async (c) => {
  const results = [];

  for (const probe of FEATURE_PROBES) {
    for (const [accent, voice] of [
      ['RP', 'en-GB-SoniaNeural'],
      ['GA', 'en-US-JennyNeural'],
    ] as const) {
      try {
        const wav = await synthesise(c.env, probe.text, voice);
        const raw = await assessWithRetry(c.env, wav, probe.text, 'en-US', 5);
        const words = raw.NBest?.[0]?.Words ?? [];

        results.push({
          text: probe.text,
          feature: probe.feature,
          accent,
          isSentence: probe.text.includes(' '),
          words: words
            .filter((w) => probe.targetWords.includes(w.Word.toLowerCase()))
            .map((w) => ({
              word: w.Word,
              score: w.AccuracyScore,
              phonemes: (w.Phonemes ?? []).map((p) => {
                const nBest = (p as { NBestPhonemes?: { Phoneme: string; Score: number }[] })
                  .NBestPhonemes;
                return {
                  expected: p.Phoneme,
                  score: p.AccuracyScore,
                  heard: nBest?.[0]?.Phoneme ?? null,
                };
              }),
            })),
        });
      } catch (err) {
        results.push({ text: probe.text, feature: probe.feature, accent, error: String(err) });
      }
    }
  }

  return c.json({ generatedAt: new Date().toISOString(), results });
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
    //
    // SEQUENTIAL, deliberately. The F0 free tier allows a single concurrent
    // transcription, so running these together returns 429.
    const gb = await assessWithRetry(c.env, wav, text, 'en-GB');
    const us = await assessWithRetry(c.env, wav, text, 'en-US', 5);

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
