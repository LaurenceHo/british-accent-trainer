import { describe, expect, it, vi } from 'vitest';
import { precache, pruneCaches, respond, type SwContext } from '@/sw/handlers';

const ORIGIN = 'https://trainer.example';
const url = (path: string) => `${ORIGIN}${path}`;

/** An in-memory CacheStorage: enough of the API for the worker, keyed by URL. */
class MemoryCaches {
  readonly stores = new Map<string, Map<string, Response>>();
  /** Makes every put reject, as a full quota does. */
  failPuts = false;

  async open(name: string) {
    const store = this.stores.get(name) ?? new Map<string, Response>();
    this.stores.set(name, store);
    const key = (request: Request | string) => (typeof request === 'string' ? request : request.url);
    return {
      match: async (request: Request | string) => store.get(key(request))?.clone(),
      put: async (request: Request | string, response: Response) => {
        if (this.failPuts) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        store.set(key(request), response);
      },
    };
  }

  async keys() {
    return [...this.stores.keys()];
  }

  async delete(name: string) {
    return this.stores.delete(name);
  }
}

type Network = Record<string, () => Response>;

function setup(network: Network = {}) {
  const caches = new MemoryCaches();
  const background: Promise<unknown>[] = [];
  let online = true;
  const fetch = vi.fn(async (request: RequestInfo) => {
    const href = typeof request === 'string' ? request : request.url;
    if (!online) throw new TypeError('Failed to fetch');
    const answer = network[new URL(href).pathname];
    return answer ? answer() : new Response('missing', { status: 404 });
  });
  const ctx: SwContext = {
    origin: ORIGIN,
    caches: caches as unknown as CacheStorage,
    fetch,
    cacheName: 'bat-build2',
    waitUntil: (work) => void background.push(work),
  };
  return {
    caches,
    ctx,
    fetch,
    goOffline: () => (online = false),
    settle: () => Promise.all(background),
    cached: (path: string) => caches.stores.get('bat-build2')?.get(url(path)),
  };
}

/** A page navigation. Only browsers may create one, so the mode is set on the object. */
function navigate(path: string): Request {
  const request = new Request(url(path));
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  return request;
}

describe('precache', () => {
  const SHELL = `<script src="/assets/main-a1.js"></script><link href="/assets/main-b2.css">`;
  const network: Network = {
    '/': () => new Response(SHELL),
    '/assets/main-a1.js': () => new Response('js'),
    '/assets/main-b2.css': () => new Response('@font-face{src:url(/assets/geist-c3.woff2)}'),
    '/assets/geist-c3.woff2': () => new Response('font'),
  };

  it('stores the shell, its scripts and styles, and the fonts the styles name', async () => {
    const { ctx, cached } = setup(network);

    await precache(ctx);

    for (const path of ['/', '/assets/main-a1.js', '/assets/main-b2.css', '/assets/geist-c3.woff2']) {
      expect(cached(path), path).toBeDefined();
    }
    expect(await cached('/')!.text()).toBe(SHELL);
  });

  it('fails the install rather than cache a login page as the app', async () => {
    // Behind Cloudflare Access an expired session redirects; that page is not the shell.
    const redirected = new Response('<form>Sign in</form>');
    Object.defineProperty(redirected, 'redirected', { value: true });
    const { ctx, cached } = setup({ ...network, '/': () => redirected });

    await expect(precache(ctx)).rejects.toThrow(/Shell unavailable/);
    expect(cached('/')).toBeUndefined();
  });

  it('fails the install when an asset is missing, so a half-cached app never takes over', async () => {
    const { ctx } = setup({ ...network, '/assets/main-a1.js': () => new Response('', { status: 404 }) });

    await expect(precache(ctx)).rejects.toThrow(/main-a1\.js/);
  });
});

describe('pruneCaches', () => {
  it('deletes previous builds’ caches, and leaves this build’s and other apps’ alone', async () => {
    const { ctx, caches } = setup();
    for (const name of ['bat-build1', 'bat-build2', 'someone-else']) await caches.open(name);

    await pruneCaches(ctx);

    expect(await caches.keys()).toEqual(['bat-build2', 'someone-else']);
  });
});

describe('respond', () => {
  it('leaves the API to the network', () => {
    const { ctx } = setup();

    expect(respond(new Request(url('/api/progress')), ctx)).toBeNull();
  });

  it('serves a cached asset without touching the network', async () => {
    const { ctx, caches, fetch } = setup();
    await (await caches.open('bat-build2')).put(url('/assets/a.js'), new Response('cached'));

    const response = await respond(new Request(url('/assets/a.js')), ctx);

    expect(await response!.text()).toBe('cached');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('caches a page under one key, whatever its query string', async () => {
    const { ctx, settle, caches } = setup({ '/': () => new Response('shell') });

    await respond(navigate('/?utm=a'), ctx);
    await respond(navigate('/?utm=b'), ctx);
    await settle();

    expect([...caches.stores.get('bat-build2')!.keys()]).toEqual([url('/')]);
  });

  it('falls back to the cached shell for any page when offline', async () => {
    const { ctx, settle, goOffline } = setup({ '/': () => new Response('shell') });
    await respond(navigate('/'), ctx);
    await settle();
    goOffline();

    const response = await respond(navigate('/?from=homescreen'), ctx);

    expect(await response!.text()).toBe('shell');
  });

  it('still answers when the cache write fails, as on a full iOS quota', async () => {
    // The network answered; a failed copy into the cache must not turn that into an error.
    const { ctx, caches, settle } = setup({ '/assets/a.js': () => new Response('fresh') });
    caches.failPuts = true;

    const response = await respond(new Request(url('/assets/a.js')), ctx);

    expect(await response!.text()).toBe('fresh');
    await expect(settle()).resolves.toBeDefined();
  });

  it('does not cache partial or failed responses', async () => {
    const { ctx, settle, cached } = setup({
      '/assets/a.js': () => new Response('part', { status: 206 }),
      '/manifest.webmanifest': () => new Response('gone', { status: 500 }),
    });

    await respond(new Request(url('/assets/a.js')), ctx);
    await respond(new Request(url('/manifest.webmanifest')), ctx);
    await settle();

    expect(cached('/assets/a.js')).toBeUndefined();
    expect(cached('/manifest.webmanifest')).toBeUndefined();
  });
});
