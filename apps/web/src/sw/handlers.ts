import { referencedAssets, strategyFor } from './strategy';

/**
 * What the service worker does, separated from the worker globals so it can be tested
 * with an in-memory cache and a fake network. `sw.ts` only wires these to its events.
 */

/** The worker's environment, injected. */
export interface SwContext {
  /** The app's origin. Paths are resolved against it, and other origins are left alone. */
  readonly origin: string;
  readonly caches: CacheStorage;
  readonly fetch: (request: RequestInfo) => Promise<Response>;
  /** This build's cache; every build gets its own. */
  readonly cacheName: string;
  /** Keeps the worker alive for background work, such as a cache write. */
  readonly waitUntil: (work: Promise<unknown>) => void;
}

/** Every cache this app has ever created starts with this, so cleanup never touches others. */
export const CACHE_PREFIX = 'bat-';

/** Navigations are all the same single-page shell, so they share one key: the root. */
const shellUrl = (ctx: SwContext) => new URL('/', ctx.origin).href;

/**
 * Downloads the shell and every fingerprinted asset it needs — scripts and styles named in
 * the HTML, and the fonts those styles name — so the app opens offline after one visit.
 *
 * @throws When the shell or an asset cannot be fetched, failing the install: a worker that
 *   could not cache the app must not take over from one that did.
 */
export async function precache(ctx: SwContext): Promise<void> {
  const cache = await ctx.caches.open(ctx.cacheName);
  const shell = await ctx.fetch(new Request(shellUrl(ctx), { cache: 'no-cache' }));
  // A redirect here is a login page (Cloudflare Access) or similar, not the app.
  if (!shell.ok || shell.redirected) throw new Error(`Shell unavailable: ${shell.status}`);

  const html = await shell.clone().text();
  await cache.put(shellUrl(ctx), shell);

  const queue = referencedAssets(html);
  const seen = new Set<string>();
  for (const path of queue) {
    if (seen.has(path)) continue;
    seen.add(path);
    const url = new URL(path, ctx.origin).href;
    const response = await ctx.fetch(new Request(url));
    if (!response.ok) throw new Error(`Asset unavailable: ${path} (${response.status})`);
    if (path.endsWith('.css')) {
      // Fonts are named in the CSS, not the HTML.
      for (const nested of referencedAssets(await response.clone().text())) queue.push(nested);
    }
    await cache.put(url, response);
  }
}

/** Deletes previous builds' caches. */
export async function pruneCaches(ctx: SwContext): Promise<void> {
  const names = await ctx.caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== ctx.cacheName)
      .map((name) => ctx.caches.delete(name)),
  );
}

/**
 * Answers a request, or returns null to leave it to the browser.
 *
 * @param request - The intercepted request.
 */
export function respond(request: Request, ctx: SwContext): Promise<Response> | null {
  const strategy = strategyFor(request, ctx.origin);
  if (strategy === 'bypass') return null;
  return strategy === 'cache-first' ? cacheFirst(request, ctx) : networkFirst(request, ctx);
}

/**
 * Stores a copy of a response without delaying it. The write runs in the background and its
 * failure is ignored: a full quota (small on iOS) or an uncacheable response must not turn
 * an answer the network already gave into an error.
 */
function store(key: Request | string, response: Response, ctx: SwContext): void {
  // 206 Partial Content cannot be cached, and only a complete answer is worth keeping.
  if (response.status !== 200) return;
  ctx.waitUntil(
    ctx.caches
      .open(ctx.cacheName)
      .then((cache) => cache.put(key, response.clone()))
      .catch(() => undefined),
  );
}

async function cacheFirst(request: Request, ctx: SwContext): Promise<Response> {
  const cache = await ctx.caches.open(ctx.cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await ctx.fetch(request);
  store(request, response, ctx);
  return response;
}

async function networkFirst(request: Request, ctx: SwContext): Promise<Response> {
  // Every navigation is the same shell; keying by URL would store a copy per query string.
  const key = request.mode === 'navigate' ? shellUrl(ctx) : request;
  try {
    const response = await ctx.fetch(request);
    if (!response.redirected) store(key, response, ctx);
    return response;
  } catch (error) {
    const cached = await (await ctx.caches.open(ctx.cacheName)).match(key);
    if (cached) return cached;
    throw error;
  }
}
