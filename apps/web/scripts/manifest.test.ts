import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Installability depends on the manifest and its icons agreeing, and browsers fail
 * silently — no install prompt, no error. So the icons' real pixel sizes are read from the
 * PNG headers and checked against what the manifest declares.
 */

const PUBLIC = path.resolve(import.meta.dirname, '../public');

interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose?: string;
}

interface Manifest {
  readonly name: string;
  readonly short_name: string;
  readonly start_url: string;
  readonly display: string;
  readonly icons: readonly ManifestIcon[];
}

const manifest = JSON.parse(
  readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8'),
) as Manifest;

/** Width and height from a PNG's IHDR chunk, after checking it is a PNG at all. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(path.join(PUBLIC, file));
  expect([...bytes.subarray(0, 8)], `${file} is not a PNG`).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('web app manifest', () => {
  it('has what browsers require to offer installation', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name.length).toBeLessThanOrEqual(15); // fits under a home-screen icon
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  it('declares 192 and 512 icons, and a maskable one for Android', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it.each(manifest.icons.map((i) => [i.src, i] as const))(
    '%s exists at the size it declares',
    (src, icon) => {
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(icon.type).toBe('image/png');
      expect(pngSize(src)).toEqual({ width: w, height: h });
    },
  );

  it('has the 180×180 Apple touch icon iOS asks for instead', () => {
    expect(pngSize('icons/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
  });
});
