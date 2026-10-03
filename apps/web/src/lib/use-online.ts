import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/**
 * Whether the browser believes it has a network connection.
 *
 * `navigator.onLine` can be true on a network with no internet access, so a true here
 * only means "worth trying"; requests still handle their own failures. False is reliable,
 * which is what it is used for: saying up front that something needs a connection.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine);
}
