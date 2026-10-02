import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { HealthResponse } from '../src/types';

describe('GET /health', () => {
  it('returns 200 with an ok status', async () => {
    const res = await app.request('/health', {}, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthResponse;
    expect(body.status).toBe('ok');
  });

  it('returns 404 for an unknown route', async () => {
    const res = await app.request('/nope', {}, env);
    expect(res.status).toBe(404);
  });
});
