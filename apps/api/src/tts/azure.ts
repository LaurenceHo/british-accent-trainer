import { isValidRegion, type AzureConfig } from '../azure-config';

/**
 * Native RP reference audio via Azure neural text-to-speech.
 *
 * This is the half of Azure that works well for this product: the `en-GB` neural voices
 * are a good model to shadow. Output is 16 kHz / 16-bit / mono PCM WAV — deliberately the
 * same format as the learner's recordings, so reference and attempt share a sample rate
 * and can be compared on one time axis without resampling.
 */

/** Voices offered as references. A whitelist, not a passthrough: see `isReferenceVoice`. */
export const REFERENCE_VOICES = ['en-GB-SoniaNeural', 'en-GB-RyanNeural'] as const;

export type ReferenceVoice = (typeof REFERENCE_VOICES)[number];

export const DEFAULT_VOICE: ReferenceVoice = 'en-GB-SoniaNeural';

/**
 * Narrows an arbitrary string to a known voice.
 *
 * The voice is interpolated into SSML and into the R2 cache key, so accepting anything
 * would allow markup injection and let a caller fill the bucket with arbitrary keys.
 */
export function isReferenceVoice(value: string): value is ReferenceVoice {
  return (REFERENCE_VOICES as readonly string[]).includes(value);
}

/** Matches the output format of the browser recorder. */
const OUTPUT_FORMAT = 'riff-16khz-16bit-mono-pcm';

const REQUEST_TIMEOUT_MS = 15_000;

/** A synthesis failure. Callers map it to a 502; nothing about it is the user's fault. */
export class SpeechSynthesisError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SpeechSynthesisError';
  }
}

/** Escapes text for inclusion in an SSML element body. */
export function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Synthesises `text` in a British voice.
 *
 * @param config - Azure Speech credentials.
 * @param text - Plain text to speak. Escaped before being placed in SSML.
 * @param voice - One of {@link REFERENCE_VOICES}.
 * @returns A 16 kHz mono 16-bit PCM WAV file.
 * @throws {SpeechSynthesisError} On any upstream or transport failure.
 */
export async function synthesiseSpeech(
  config: AzureConfig,
  text: string,
  voice: ReferenceVoice,
): Promise<ArrayBuffer> {
  // Type-checked before the pattern: a bare regex test accepts undefined. See azure-config.ts.
  if (!isValidRegion(config.region)) {
    throw new SpeechSynthesisError(`Invalid Azure region: ${config.region}`);
  }

  const ssml =
    `<speak version='1.0' xml:lang='en-GB'>` +
    `<voice name='${voice}'>${escapeXml(text)}</voice></speak>`;

  let response: Response;
  try {
    response = await fetch(
      `https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': config.key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
          'User-Agent': 'british-accent-trainer',
        },
        body: ssml,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch (cause) {
    throw new SpeechSynthesisError('Could not reach Azure text-to-speech', { cause });
  }

  if (!response.ok) {
    // The body is deliberately not echoed: it is upstream-controlled text, and this error
    // can reach logs. The status is enough to diagnose.
    throw new SpeechSynthesisError(`Azure text-to-speech failed: ${response.status}`);
  }

  return response.arrayBuffer();
}
