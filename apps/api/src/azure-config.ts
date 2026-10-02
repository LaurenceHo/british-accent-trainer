import type { Env } from './types';

/**
 * Reads Azure credentials from the Worker environment.
 *
 * The generated `Env` types both secrets as `string`, so TypeScript cannot catch an absent
 * one — at runtime a missing secret is `undefined`. That matters more than it looks:
 * `/^[a-z0-9-]+$/.test(undefined)` is **true**, because `test` coerces its argument to the
 * string `"undefined"`. Without this check a deploy with the region unset would send real
 * requests, carrying the key, to `undefined.stt.speech.microsoft.com`.
 */

/** Azure regions are lowercase alphanumeric. The region becomes part of a hostname. */
const VALID_REGION = /^[a-z0-9-]+$/;

/** Credentials and region for the Azure Speech resource. */
export interface AzureConfig {
  readonly key: string;
  readonly region: string;
}

/**
 * Whether a value is a usable Azure region.
 *
 * Checks the type before the pattern, so `undefined` is rejected rather than coerced.
 */
export function isValidRegion(value: unknown): value is string {
  return typeof value === 'string' && VALID_REGION.test(value);
}

/**
 * Returns the Azure configuration, or `null` when it is missing or malformed.
 *
 * Callers treat `null` as "this feature is not configured" — a 503, not a 500, and never
 * an attempt to call Azure.
 */
export function readAzureConfig(env: Env): AzureConfig | null {
  const key: unknown = env.AZURE_SPEECH_KEY;
  const region: unknown = env.AZURE_SPEECH_REGION;

  if (typeof key !== 'string' || key.length === 0) return null;
  if (!isValidRegion(region)) return null;

  return { key, region };
}
