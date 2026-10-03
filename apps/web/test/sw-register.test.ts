import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '@/sw/register';

/** Installs a fake `navigator.serviceWorker` and returns its register spy. */
function fakeServiceWorker() {
  const register = vi.fn(() => Promise.resolve({} as ServiceWorkerRegistration));
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register },
    configurable: true,
  });
  return register;
}

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('registerServiceWorker', () => {
  it('registers /sw.js once the page has loaded, in a production build', () => {
    vi.stubEnv('PROD', true);
    const register = fakeServiceWorker();

    registerServiceWorker();
    expect(register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('load'));

    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('does nothing in development, where it would cache modules that change on save', () => {
    vi.stubEnv('PROD', false);
    const register = fakeServiceWorker();

    registerServiceWorker();
    window.dispatchEvent(new Event('load'));

    expect(register).not.toHaveBeenCalled();
  });

  it('does nothing where service workers are unsupported', () => {
    vi.stubEnv('PROD', true);

    expect(() => {
      registerServiceWorker();
      window.dispatchEvent(new Event('load'));
    }).not.toThrow();
  });
});
