/**
 * How the service worker answers each request. Pure, so the routing rules are tested
 * without a browser.
 *
 * - `network-first`: pages and unversioned files (icons, the manifest). Fresh when online,
 *   so a deploy is picked up on the next visit; the cached copy when offline.
 * - `cache-first`: Vite's fingerprinted `/assets/*`. A name changes whenever its content
 *   does, so a cached copy is never stale.
 * - `bypass`: left to the network untouched. Above all `/api/*`: drills, scores and
 *   recordings are live data, and a cached clarity score or chart would quietly lie.
 */
export type Strategy = 'network-first' | 'cache-first' | 'bypass';

/** The parts of a request the decision depends on. */
export interface RequestFacts {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
}

/**
 * Decides how to answer a request.
 *
 * @param request - The request's URL, method and mode.
 * @param origin - The app's own origin; anything else is bypassed.
 */
export function strategyFor(request: RequestFacts, origin: string): Strategy {
  if (request.method !== 'GET') return 'bypass';
  const url = new URL(request.url);
  if (url.origin !== origin) return 'bypass';
  if (url.pathname.startsWith('/api/')) return 'bypass';
  if (request.mode === 'navigate') return 'network-first';
  if (url.pathname.startsWith('/assets/')) return 'cache-first';
  return 'network-first';
}

/**
 * The fingerprinted assets a page references, so they can be cached on install and the
 * app opens offline after a single visit.
 *
 * @param html - The page's HTML.
 * @returns Root-relative asset paths, without duplicates.
 */
export function referencedAssets(html: string): string[] {
  return [...new Set(html.match(/\/assets\/[^"'\s)>]+/g) ?? [])];
}
