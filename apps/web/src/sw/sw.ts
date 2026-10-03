/// <reference lib="webworker" />
import { referencedAssets, strategyFor } from './strategy';

/**
 * The service worker: makes the app installable and lets it open offline.
 *
 * Built by Vite as a separate entry at `/sw.js` (see `vite.config.ts`). Every build bakes
 * in a fresh `__BUILD_ID__`, so every deploy changes this file's bytes, which is what makes
 * the browser install a new worker. Each build gets its own caches; activating a new worker
 * deletes the previous build's.
 */

declare const self: ServiceWorkerGlobalScope;
declare const __BUILD_ID__: string;

const CACHE = `bat-${__BUILD_ID__}`;

self.addEventListener('install', (event) => {
  // The shell and the assets it references, so the app opens offline after one visit.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const shell = await fetch('/', { cache: 'no-cache' });
      if (!shell.ok) throw new Error(`Shell fetch failed: ${shell.status}`);
      const html = await shell.clone().text();
      await cache.put('/', shell);
      await cache.addAll(referencedAssets(html));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('bat-') && n !== CACHE).map((n) => caches.delete(n)),
      );
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const strategy = strategyFor(request, self.location.origin);
  if (strategy === 'bypass') return;

  event.respondWith(strategy === 'cache-first' ? cacheFirst(request) : networkFirst(request));
});

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    // Offline. Any page is the single-page app's shell, so a navigation falls back to it.
    const cached =
      (await cache.match(request)) ??
      (request.mode === 'navigate' ? await cache.match('/') : undefined);
    if (cached) return cached;
    throw error;
  }
}
