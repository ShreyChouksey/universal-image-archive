/**
 * Walking the address without ever building it.
 *
 * An address is 47.46 MiB, and materialising one to move a single step is what
 * made the address lane heavy enough that it had to be kept separate from the
 * coordinate lane. It does not have to be.
 *
 * Adding N to a base-256 integer changes only its least significant bytes —
 * the last ceil(log256 N) of them, plus however far the carry runs. Everything
 * above that is untouched. For a seeded address every byte is a pure function
 * of its own index, so the image at `A(seed) + N` is the seeded image with a
 * few bytes rewritten at the very end, and the shader can paint it by
 * evaluating Philox everywhere except the last handful of pixels, where it
 * reads a patch instead.
 *
 * So a location is a coordinate and a signed offset. Stepping costs the
 * arithmetic on ~72 bytes and a uniform upload — no allocation, no texture, no
 * 47 MiB anywhere. It works on grids far too large to materialise at all, and
 * because the pair is small, an exact address finally fits in a URL.
 *
 * The carry is the one thing that can escape. If it runs past the patch the
 * answer would be wrong, so that case is detected and reported rather than
 * approximated — the caller falls back to materialising. For a pseudorandom
 * tail it requires every one of 72 bytes to be 0xFF (or 0x00 going down), which
 * is a probability of 256^-72.
 */

import { type ArchiveFormat, pixelCount } from './format';
import { sampleSeed } from './address';
import type { Seed } from './philox';

/**
 * Pixels the patch covers. Twelve is 72 bytes at 48-bit and 36 at 24-bit —
 * against the 7 bytes a maximum offset can touch, that is ten orders of
 * magnitude of headroom for the carry.
 */
export const PATCH_PIXELS = 12;

export interface TailPatch {
  /** Index of the first pixel the patch replaces. */
  firstPixel: number;
  /** Channel values, four per pixel (alpha unused), ready for a uniform. */
  values: Uint32Array;
  /** Pixels actually covered; 0 means no patch is needed. */
  count: number;
}

/** The last `PATCH_PIXELS` pixels of a seeded address, as raw bytes. */
function tailBytes(format: ArchiveFormat, seed: Seed, firstPixel: number, count: number): Uint8Array {
  const bpp = format.depth.bytesPerPixel;
  const bytes = new Uint8Array(count * bpp);
  for (let k = 0; k < count; k++) {
    const s = sampleSeed(format, seed, firstPixel + k);
    const o = k * bpp;
    if (bpp === 6) {
      bytes[o] = s.r >>> 8;
      bytes[o + 1] = s.r & 0xff;
      bytes[o + 2] = s.g >>> 8;
      bytes[o + 3] = s.g & 0xff;
      bytes[o + 4] = s.b >>> 8;
      bytes[o + 5] = s.b & 0xff;
    } else {
      bytes[o] = s.r;
      bytes[o + 1] = s.g;
      bytes[o + 2] = s.b;
    }
  }
  return bytes;
}

/**
 * The patch that turns the seeded image into the image at `A(seed) + offset`.
 *
 * Returns null when the offset is zero (nothing to patch) and throws
 * `CarryEscaped` when the carry runs past the patch, which the caller answers
 * by materialising the address properly.
 */
export class CarryEscaped extends Error {
  constructor() {
    super('The carry ran past the tail patch; this address needs materialising.');
    this.name = 'CarryEscaped';
  }
}

export function tailPatch(format: ArchiveFormat, seed: Seed, offset: number): TailPatch | null {
  if (offset === 0) return null;

  const total = pixelCount(format);
  const count = Math.min(PATCH_PIXELS, total);
  const firstPixel = total - count;
  const bpp = format.depth.bytesPerPixel;

  const bytes = tailBytes(format, seed, firstPixel, count);

  // BigInt is the right tool at 72 bytes and the wrong one at 47 MiB — here it
  // is exact and instant.
  const width = BigInt(bytes.length * 8);
  const modulus = 1n << width;
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);

  const moved = value + BigInt(Math.trunc(offset));
  if (moved < 0n || moved >= modulus) {
    // The step crossed the top or bottom of the patch, so bytes outside it
    // changed too. Refusing beats quietly painting the wrong picture.
    throw new CarryEscaped();
  }

  let v = moved;
  for (let i = bytes.length - 1; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }

  const values = new Uint32Array(PATCH_PIXELS * 4);
  for (let k = 0; k < count; k++) {
    const o = k * bpp;
    const d = k * 4;
    if (bpp === 6) {
      values[d] = (bytes[o] << 8) | bytes[o + 1];
      values[d + 1] = (bytes[o + 2] << 8) | bytes[o + 3];
      values[d + 2] = (bytes[o + 4] << 8) | bytes[o + 5];
    } else {
      values[d] = bytes[o];
      values[d + 1] = bytes[o + 1];
      values[d + 2] = bytes[o + 2];
    }
  }
  return { firstPixel, values, count };
}

/**
 * The colour at one pixel of the image at `A(seed) + offset`.
 *
 * The loupe reads through this, so what it reports is what the shader painted
 * rather than what the unshifted seed would have painted.
 */
export function sampleAt(
  format: ArchiveFormat,
  seed: Seed,
  offset: number,
  pixelIndex: number,
  patch: TailPatch | null,
): { r: number; g: number; b: number } {
  if (patch && pixelIndex >= patch.firstPixel) {
    const d = (pixelIndex - patch.firstPixel) * 4;
    return { r: patch.values[d], g: patch.values[d + 1], b: patch.values[d + 2] };
  }
  void offset;
  return sampleSeed(format, seed, pixelIndex);
}

/**
 * Head of the address as hexadecimal, straight from the generator.
 *
 * Cheap for the same reason the patch is: the leading bytes of a seeded address
 * are just the first few pixels, so the address can be shown in the coordinate
 * lane without materialising anything.
 */
export function seedHeadBytes(format: ArchiveFormat, seed: Seed, count: number): Uint8Array {
  const bpp = format.depth.bytesPerPixel;
  const pixels = Math.ceil(count / bpp);
  const bytes = new Uint8Array(pixels * bpp);
  for (let k = 0; k < pixels; k++) {
    const s = sampleSeed(format, seed, k);
    const o = k * bpp;
    if (bpp === 6) {
      bytes[o] = s.r >>> 8;
      bytes[o + 1] = s.r & 0xff;
      bytes[o + 2] = s.g >>> 8;
      bytes[o + 3] = s.g & 0xff;
      bytes[o + 4] = s.b >>> 8;
      bytes[o + 5] = s.b & 0xff;
    } else {
      bytes[o] = s.r;
      bytes[o + 1] = s.g;
      bytes[o + 2] = s.b;
    }
  }
  return bytes.subarray(0, count);
}

/** Tail of the address as raw bytes, patched if an offset is in play. */
export function seedTailBytes(
  format: ArchiveFormat,
  seed: Seed,
  offset: number,
  count: number,
): Uint8Array {
  const total = pixelCount(format);
  const bpp = format.depth.bytesPerPixel;
  const pixels = Math.min(total, Math.ceil(count / bpp));
  const first = total - pixels;
  const bytes = tailBytes(format, seed, first, pixels);

  if (offset !== 0) {
    const modulus = 1n << BigInt(bytes.length * 8);
    let value = 0n;
    for (const b of bytes) value = (value << 8n) | BigInt(b);
    const moved = value + BigInt(Math.trunc(offset));
    if (moved < 0n || moved >= modulus) throw new CarryEscaped();
    let v = moved;
    for (let i = bytes.length - 1; i >= 0; i--) {
      bytes[i] = Number(v & 0xffn);
      v >>= 8n;
    }
  }
  return bytes.subarray(Math.max(0, bytes.length - count));
}
