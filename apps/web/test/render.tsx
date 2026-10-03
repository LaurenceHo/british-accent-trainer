import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { StrictMode, type ReactElement } from 'react';
import { createQueryClient } from '@/api/query-client';

/**
 * Renders inside StrictMode and a fresh copy of the application's QueryClient.
 *
 * The same factory as production, so tests see the real retry and refetch behaviour. A new
 * client per test keeps cached data from leaking between tests. StrictMode double-mounts
 * effects in development, which is exactly what exposes object-URL and cleanup bugs.
 */
export function renderWithClient(ui: ReactElement): RenderResult & { client: QueryClient } {
  const client = createQueryClient();
  const result = render(
    <StrictMode>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </StrictMode>,
  );
  return { ...result, client };
}

/** A route table for a stubbed `fetch`: URL prefix to response factory. */
export type Routes = Record<string, () => Response | Promise<Response>>;

/**
 * Builds a `fetch` stub that answers by URL prefix and records every call.
 *
 * Longest matching prefix wins, so `/api/drills/x/reference-audio` can be answered
 * separately from `/api/drills`. An unmatched URL fails the test loudly rather than hanging.
 */
export function fetchStub(routes: Routes) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const prefixes = Object.keys(routes).sort((a, b) => b.length - a.length);

  const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    const match = prefixes.find((p) => url.startsWith(p));
    if (!match) throw new Error(`Unexpected fetch in test: ${url}`);
    return routes[match]!();
  };

  return { stub, calls };
}

/** JSON response helper. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
