import { CACHE_PREFIX, precache, pruneCaches, respond, type SwContext } from './handlers';

/**
 * The service worker: makes the app installable and lets it open offline.
 *
 * Built by Vite as a separate entry at `/sw.js` (see `vite.config.ts`). Every build bakes
 * in a fresh `__BUILD_ID__`, so every deploy changes this file's bytes, which is what makes
 * the browser install a new worker. The behaviour lives in `handlers.ts`; this file only
 * connects it to the worker's events.
 */

declare const self: ServiceWorkerGlobalScope;
declare const __BUILD_ID__: string;

const context = (event: ExtendableEvent): SwContext => ({
  origin: self.location.origin,
  caches,
  fetch: (request) => fetch(request),
  cacheName: `${CACHE_PREFIX}${__BUILD_ID__}`,
  waitUntil: (work) => event.waitUntil(work),
});

self.addEventListener('install', (event) => event.waitUntil(precache(context(event))));

self.addEventListener('activate', (event) => event.waitUntil(pruneCaches(context(event))));

self.addEventListener('fetch', (event) => {
  const response = respond(event.request, context(event));
  if (response) event.respondWith(response);
});
