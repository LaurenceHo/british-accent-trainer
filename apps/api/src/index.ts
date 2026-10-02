import { Hono } from 'hono';
import spike from './spike/assess';
import type { Env, HealthResponse } from './types';

const app = new Hono<{ Bindings: Env }>();

/**
 * Liveness probe.
 *
 * Deliberately does not touch D1 or R2 — it answers "is the Worker running", not
 * "are its dependencies healthy", so it stays useful when a binding is misconfigured.
 */
app.get('/health', (c) => {
  const body: HealthResponse = { status: 'ok' };
  return c.json(body);
});

// THROWAWAY — Task 1 engine spike. Remove this mount and `src/spike/` once the
// Engine Decision Gate is resolved. It calls the live Azure API and is not shipped.
app.route('/spike', spike);

export default app;
