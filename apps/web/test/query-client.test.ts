import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import { shouldRetry } from '@/api/query-client';

describe('shouldRetry', () => {
  it('never retries an answer from the server', () => {
    // A 404 or a 503 "not configured" will not change on retry; it only delays the message.
    for (const status of [400, 404, 500, 502, 503]) {
      expect(shouldRetry(0, new ApiError('x', status)), String(status)).toBe(false);
    }
  });

  it('retries a request that never reached the server, once', () => {
    const network = new TypeError('Failed to fetch');

    expect(shouldRetry(0, network)).toBe(true);
    expect(shouldRetry(1, network)).toBe(false);
  });
});
