import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

/**
 * Renders inside a fresh QueryClient.
 *
 * A new client per test keeps cached data from leaking between tests. Retries are off so a
 * failed request surfaces immediately instead of waiting out the default backoff.
 */
export function renderWithClient(ui: ReactElement): RenderResult & { client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
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
