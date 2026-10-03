import { describe, expect, it } from 'vitest';
import { referencedAssets, strategyFor } from '@/sw/strategy';

const ORIGIN = 'https://trainer.example';
const get = (path: string, mode = 'cors') => ({ url: `${ORIGIN}${path}`, method: 'GET', mode });

describe('strategyFor', () => {
  it('never caches the API: scores and progress are live data', () => {
    expect(strategyFor(get('/api/progress?days=90'), ORIGIN)).toBe('bypass');
    expect(strategyFor(get('/api/drills/w-bath/reference-audio'), ORIGIN)).toBe('bypass');
  });

  it('never caches a write', () => {
    expect(strategyFor({ ...get('/api/attempts'), method: 'POST' }, ORIGIN)).toBe('bypass');
    expect(strategyFor({ ...get('/'), method: 'POST' }, ORIGIN)).toBe('bypass');
  });

  it('serves pages network-first, so a deploy shows on the next online visit', () => {
    expect(strategyFor(get('/', 'navigate'), ORIGIN)).toBe('network-first');
    expect(strategyFor(get('/?utm=x', 'navigate'), ORIGIN)).toBe('network-first');
  });

  it('serves fingerprinted assets cache-first', () => {
    expect(strategyFor(get('/assets/index-B2x9.js'), ORIGIN)).toBe('cache-first');
    expect(strategyFor(get('/assets/geist-latin.woff2'), ORIGIN)).toBe('cache-first');
  });

  it('serves unversioned files network-first, since their names do not change', () => {
    expect(strategyFor(get('/manifest.webmanifest'), ORIGIN)).toBe('network-first');
    expect(strategyFor(get('/icons/icon-192.png'), ORIGIN)).toBe('network-first');
  });

  it('leaves other origins alone', () => {
    expect(strategyFor({ ...get('/'), url: 'https://elsewhere.example/assets/x.js' }, ORIGIN)).toBe(
      'bypass',
    );
  });
});

describe('referencedAssets', () => {
  it('finds the scripts and styles a built page loads, once each', () => {
    const html = `<!doctype html><html><head>
      <script type="module" crossorigin src="/assets/index-AbC123.js"></script>
      <link rel="modulepreload" href="/assets/vendor-x9.js">
      <link rel="stylesheet" crossorigin href="/assets/index-Zz.css">
      <link rel="manifest" href="/manifest.webmanifest">
      </head><body><script src="/assets/index-AbC123.js"></script></body></html>`;

    expect(referencedAssets(html)).toEqual([
      '/assets/index-AbC123.js',
      '/assets/vendor-x9.js',
      '/assets/index-Zz.css',
    ]);
  });

  it('finds nothing in a page with no assets', () => {
    expect(referencedAssets('<p>offline</p>')).toEqual([]);
  });
});
