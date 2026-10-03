import type { Attempt, Drill, ProgressResponse } from '@api/domain';

/**
 * Typed calls to the Worker API.
 *
 * Response types are imported from the API's own `domain.ts`, so a change to the server's
 * shape breaks the client's build rather than its behaviour.
 */

/** An API failure, carrying what the UI needs to explain it. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The API's error code, when it sent one — e.g. `not-recognised`, `throttled`. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  readonly error?: string;
  readonly code?: string;
}

/** Fetches JSON from the API, throwing an {@link ApiError} on a non-2xx response. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (response.ok) return (await response.json()) as T;

  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // Not JSON — a proxy page or an empty body. The status alone has to do.
  }
  throw new ApiError(
    body.error ?? `Request failed with status ${response.status}`,
    response.status,
    body.code,
  );
}

/** Lists every drill, easiest first. */
export async function fetchDrills(): Promise<Drill[]> {
  return (await request<{ drills: Drill[] }>('/api/drills')).drills;
}

/** The result of submitting a recording. */
export interface SubmittedAttempt {
  readonly attempt: Attempt;
  /** What the recogniser heard — shown so a misread drill is obvious. */
  readonly recognisedText: string | null;
  /** False when the score was kept but the audio could not be stored for later replay. */
  readonly audioStored: boolean;
}

/**
 * Submits a recording for scoring.
 *
 * @param drillId - The drill being practised. Scoring uses the drill's own sentence.
 * @param wav - 16 kHz mono 16-bit WAV, as produced by `toScorableWav`.
 */
export async function submitAttempt(drillId: string, wav: ArrayBuffer): Promise<SubmittedAttempt> {
  return request<SubmittedAttempt>(`/api/attempts?drillId=${encodeURIComponent(drillId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: wav,
  });
}

/** URL of a drill's native reference recording. */
export function referenceAudioUrl(drillId: string): string {
  return `/api/drills/${encodeURIComponent(drillId)}/reference-audio`;
}

/** URL of a stored attempt's recording. */
export function attemptAudioUrl(attemptId: string): string {
  return `/api/attempts/${encodeURIComponent(attemptId)}/audio`;
}

/**
 * The most recent attempts across every drill, newest first.
 *
 * @param limit - How many to return; the API caps this at 200.
 */
export async function fetchRecentAttempts(limit: number): Promise<Attempt[]> {
  return (await request<{ attempts: Attempt[] }>(`/api/attempts?limit=${limit}`)).attempts;
}

/**
 * Clarity progress per RP feature.
 *
 * @param days - Whole local days to cover, today included.
 * @param tzOffsetMinutes - The learner's offset in minutes east of UTC, so days break at
 *   their local midnight. Note the sign: `Date#getTimezoneOffset` returns minutes *west*.
 */
export async function fetchProgress(days: number, tzOffsetMinutes: number): Promise<ProgressResponse> {
  return request<ProgressResponse>(`/api/progress?days=${days}&tzOffsetMinutes=${tzOffsetMinutes}`);
}
