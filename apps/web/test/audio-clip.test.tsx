import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioClip } from '@/components/audio-clip';

/**
 * Object-URL lifecycle under StrictMode, which mounts, unmounts and remounts effects in
 * development. An object URL pins its Blob in memory until revoked, and recordings are
 * about a megabyte, so every URL created must be revoked — and none revoked while in use.
 */

let created: string[] = [];
let revoked: string[] = [];

beforeEach(() => {
  created = [];
  revoked = [];
  let n = 0;
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:${++n}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
});

afterEach(() => vi.restoreAllMocks());

const clip = (blob: Blob | null) => (
  <StrictMode>
    <AudioClip label="Native reference" blob={blob} />
  </StrictMode>
);

describe('AudioClip', () => {
  it('assigns a live object URL to the element, even under StrictMode', () => {
    const { getByLabelText } = render(clip(new Blob(['a'])));

    const src = (getByLabelText('Native reference') as HTMLAudioElement).getAttribute('src');
    expect(src).toBeTruthy();
    expect(revoked, 'the URL in use must not have been revoked').not.toContain(src);
  });

  it('revokes the previous URL when the recording changes', () => {
    const { rerender, getByLabelText } = render(clip(new Blob(['a'])));
    const first = getByLabelText('Native reference').getAttribute('src');

    rerender(clip(new Blob(['b'])));

    expect(revoked).toContain(first);
    expect(getByLabelText('Native reference').getAttribute('src')).not.toBe(first);
  });

  it('revokes every URL it created once unmounted', () => {
    const { rerender, unmount } = render(clip(new Blob(['a'])));
    rerender(clip(new Blob(['b'])));
    unmount();

    expect(created.length).toBeGreaterThan(0);
    expect([...revoked].sort()).toEqual([...created].sort());
  });
});
