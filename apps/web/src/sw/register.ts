/**
 * Registers the service worker, in production builds only.
 *
 * In development Vite serves unbundled modules that change on every save; a worker caching
 * them would serve stale code and make every edit look broken.
 *
 * Registration waits for the page's `load` event so the worker's own install — which
 * downloads the shell and its assets — never competes with the first render.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener(
    'load',
    () => {
      navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
        // The app works without it; it just will not open offline or install.
        console.error('Service worker registration failed', error);
      });
    },
    { once: true },
  );
}
