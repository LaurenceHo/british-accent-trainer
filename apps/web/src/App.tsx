import { useEffect, useRef, useSyncExternalStore } from 'react';
import { DrillScreen } from '@/components/drill-screen';
import { ProgressScreen } from '@/components/progress-screen';
import { useOnline } from '@/lib/use-online';
import { cn } from '@/lib/utils';

/** The app's views, addressed by URL hash so the back button and deep links work. */
const ROUTES = {
  drills: { hash: '#/', label: 'Practise' },
  progress: { hash: '#/progress', label: 'Progress' },
} as const;

type Route = keyof typeof ROUTES;

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The current view. Anything unrecognised is the practice screen, the app's home. */
function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return hash === ROUTES.progress.hash ? 'progress' : 'drills';
}

/**
 * Application shell. The header sits outside `<main>` so it is exposed as the page's
 * banner landmark; nested inside `<main>` it would be just another region of content.
 */
export function App() {
  const route = useRoute();
  const online = useOnline();
  const mainRef = useRef<HTMLElement>(null);
  // The route last shown. Compared rather than a "first render" flag, which StrictMode's
  // double-run of effects would flip on load.
  const shownRoute = useRef(route);

  useEffect(() => {
    document.title = `${ROUTES[route].label} · British Accent Trainer`;
    // A hash navigation swaps the content without a page load, and most screen readers do
    // not announce a title change. Moving focus to the new content does announce it, and
    // puts keyboard users there. Not on first load, where focus belongs at the page's top.
    if (shownRoute.current === route) return;
    shownRoute.current = route;
    mainRef.current?.focus();
  }, [route]);

  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* Moves focus itself rather than linking to "#main": the URL hash is the router, and
          following an in-page anchor would navigate away from the current view. */}
      <a
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
        className="bg-background sr-only rounded-md border px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">British Accent Trainer</h1>
          <p className="text-muted-foreground mt-1">
            Hear a native model, record yourself, and compare the two.
          </p>
        </div>
        <nav aria-label="Main">
          <ul className="flex gap-1">
            {(Object.keys(ROUTES) as Route[]).map((key) => {
              const current = key === route;
              return (
                <li key={key}>
                  <a
                    href={ROUTES[key].hash}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'block rounded-md px-3 py-1.5 text-sm',
                      'hover:bg-accent focus-visible:ring-ring focus-visible:ring-2',
                      // Not colour alone: the current view is also bold.
                      current && 'bg-accent font-semibold',
                    )}
                  >
                    {ROUTES[key].label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      {/* Always mounted: a live region that appears together with its text is not announced. */}
      <div role="status">
        {!online && (
          <p className="bg-muted mb-6 rounded-md border px-4 py-3 text-sm">
            You are offline. You can still record and replay your take, but checking clarity,
            loading new reference recordings and progress need a connection.
          </p>
        )}
      </div>
      <main ref={mainRef} tabIndex={-1} aria-label={ROUTES[route].label} className="outline-none">
        {route === 'progress' ? <ProgressScreen /> : <DrillScreen />}
      </main>
    </div>
  );
}
