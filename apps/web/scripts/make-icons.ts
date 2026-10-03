import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encodePng } from './png';

/**
 * Writes the app's icons to `public/icons/`.
 *
 *   bun scripts/make-icons.ts      (from apps/web)
 *
 * The mark is five rounded bars, a waveform, on a solid square. It is drawn here rather
 * than in an image editor so it can be regenerated at any size, and so the repository
 * needs no image tooling. Rerun after changing the mark, and commit the PNGs.
 */

/** The theme's foreground and background, matching the manifest's colours. */
const BACKGROUND = [0x1f, 0x29, 0x37] as const; // slate
const BAR = [0xf8, 0xfa, 0xfc] as const;

/** Bar heights as fractions of the drawing area: a short phrase's envelope. */
const BARS = [0.36, 0.72, 1, 0.6, 0.3];

/** Samples per pixel along each axis, for anti-aliased edges. */
const SUPERSAMPLE = 4;

/**
 * Whether a point lies inside a vertical capsule (a bar with round ends).
 *
 * @param x - Point, in the same units as the bar.
 * @param y - Point.
 * @param cx - Bar centre line.
 * @param top - Top of the straight section.
 * @param bottom - Bottom of the straight section.
 * @param radius - Half the bar's width.
 */
function inCapsule(x: number, y: number, cx: number, top: number, bottom: number, radius: number) {
  const nearestY = Math.min(Math.max(y, top), bottom);
  return (x - cx) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
}

/**
 * Draws the mark.
 *
 * @param size - Width and height in pixels.
 * @param scale - The drawing's share of the icon. Maskable icons need their content inside
 *   the central 80% circle, so they use a smaller scale than plain ones.
 */
function draw(size: number, scale: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const area = size * scale;
  const origin = (size - area) / 2;
  const pitch = area / BARS.length;
  const radius = pitch * 0.3;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = px + (sx + 0.5) / SUPERSAMPLE;
          const y = py + (sy + 0.5) / SUPERSAMPLE;
          const i = Math.floor((x - origin) / pitch);
          const height = BARS[i];
          if (height === undefined) continue;
          const half = (area * height) / 2 - radius;
          const cx = origin + (i + 0.5) * pitch;
          if (inCapsule(x, y, cx, size / 2 - half, size / 2 + half, radius)) hits++;
        }
      }
      const t = hits / SUPERSAMPLE ** 2;
      const o = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) rgba[o + c] = Math.round(BACKGROUND[c]! + (BAR[c]! - BACKGROUND[c]!) * t);
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

const ICONS = [
  { file: 'icon-192.png', size: 192, scale: 0.6 },
  { file: 'icon-512.png', size: 512, scale: 0.6 },
  { file: 'maskable-512.png', size: 512, scale: 0.5 },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.6 },
];

const out = path.resolve(import.meta.dirname, '../public/icons');
mkdirSync(out, { recursive: true });
for (const { file, size, scale } of ICONS) {
  writeFileSync(path.join(out, file), encodePng(size, size, draw(size, scale)));
  console.log(`wrote public/icons/${file}`);
}
