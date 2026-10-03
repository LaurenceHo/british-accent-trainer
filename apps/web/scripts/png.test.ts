import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, encodePng, SIGNATURE } from './png';

/**
 * Byte-level checks: a malformed icon is silently ignored by browsers, which then refuse
 * to offer installation, so "it looked fine" is not evidence.
 */

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe('crc32', () => {
  it('matches the standard check value', () => {
    // CRC-32 of "123456789" is 0xCBF43926 by definition.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('encodePng', () => {
  // 2×1: one opaque red pixel, one transparent blue one.
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0]);
  const png = encodePng(2, 1, rgba);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

  it('starts with the PNG signature', () => {
    expect([...png.subarray(0, 8)]).toEqual([...SIGNATURE]);
    // The signature itself, spelled out once: 0x89, then "PNG", CR LF, EOF (0x1a), LF.
    expect([...SIGNATURE]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('declares the size and 8-bit RGBA in IHDR', () => {
    expect(view.getUint32(8)).toBe(13);
    expect(ascii(png.subarray(12, 16))).toBe('IHDR');
    expect(view.getUint32(16)).toBe(2);
    expect(view.getUint32(20)).toBe(1);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
  });

  it('checksums each chunk over its type and data', () => {
    expect(view.getUint32(29)).toBe(crc32(png.subarray(12, 29)));
  });

  it('stores each row behind a "none" filter byte, deflated', () => {
    const idatLength = view.getUint32(33);
    expect(ascii(png.subarray(37, 41))).toBe('IDAT');

    const raw = inflateSync(png.subarray(41, 41 + idatLength));

    expect([...raw]).toEqual([0, ...rgba]);
  });

  it('ends with an empty IEND', () => {
    expect(ascii(png.subarray(png.length - 8, png.length - 4))).toBe('IEND');
  });

  it('refuses pixel data of the wrong length', () => {
    expect(() => encodePng(2, 2, rgba)).toThrow(/Expected 16 bytes/);
  });
});
