import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

/**
 * Whether a failed query is worth retrying.
 *
 * The library default is three retries with backoff for any failure, which meant roughly
 * seven seconds of "Loading…" before telling the learner the API was down — and three
 * pointless repeats of answers that will not change: a 404, or a 503 meaning "not
 * configured". Only a request that never reached the server is retried, once.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) return false;
  return failureCount < 1;
}

/**
 * The application's QueryClient. Used by `main.tsx` and by tests alike, so tests exercise
 * the same retry and refetch behaviour the learner gets rather than a quieter stand-in.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry },
      // Submissions are never retried: a failed one is usually unrecognised speech or a
      // throttled free tier, and resubmitting would spend another transcription.
      mutations: { retry: false },
    },
  });
}
