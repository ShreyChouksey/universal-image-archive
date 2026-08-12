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
 * So a location is a base and a signed offset. Stepping costs the arithmetic on
 * ~72 bytes and a uniform upload — no allocation, no texture, no 47 MiB
 * anywhere. It works on grids far too large to materialise at all, and because
 * the pair is small, an exact address finally fits in a URL.
 *
 * Nothing here cares where the base came from. A seeded address supplies its
 * tail from the generator; a located photograph supplies it from the bytes
 * already loaded, with its picture already on the GPU as a texture. Either way
 * the offset rewrites the same last few bytes, so both lanes step at the same
 * cost by the same code.
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
 * Pixels the patch covers. 128 pixels is 768 bytes at 48-bit and 384 at 24-bit —
 * providing vast headroom for carry propagation through black-tailed letterboxed images.
 */
export const PATCH_PIXELS = 128;

export interface TailPatch {
  /** Index of the first pixel the patch replaces. */
  firstPixel: number;
  /** Channel values, four per pixel (alpha unused), ready for a uniform. */
  values: Uint32Array;
  /** Pixels actually covered; 0 means no patch is needed. */
  count: number;
}

/** The last `PATCH_PIXELS` pixels of a seeded address, as raw bytes. */
function tailBytes(format: ArchiveFormat, seed: Seed, firstPixel: number, count: number, rounds = 12): Uint8Array {
  const bpp = format.depth.bytesPerPixel;
  const bytes = new Uint8Array(count * bpp);
  for (let k = 0; k < count; k++) {
    const s = sampleSeed(format, seed, firstPixel + k, rounds);
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

/**
 * Adds `offset` to a tail read as one big-endian integer, in place.
 *
 * BigInt is the right tool at 72 bytes and the wrong one at 47 MiB — here it is
 * exact and instant. Throws when the carry leaves the tail, because bytes
 * outside it would have changed and painting them unchanged would be a
 * different picture wearing the right number.
 */
export function applyOffsetToTail(bytes: Uint8Array, offset: number | bigint): void {
  const modulus = 1n << BigInt(bytes.length * 8);
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);

  const delta = typeof offset === 'bigint' ? offset : BigInt(Math.trunc(offset));
  const moved = value + delta;
  if (moved < 0n || moved >= modulus) throw new CarryEscaped();

  let v = moved;
  for (let i = bytes.length - 1; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

/** Packs tail bytes into the uniform layout the shader reads. */
export function packTailPatch(bytes: Uint8Array, bpp: number, firstPixel: number): TailPatch {
  const count = Math.floor(bytes.length / bpp);
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

/** How many trailing bytes a base must supply for the patch to work. */
export function patchByteCount(format: ArchiveFormat): number {
  return Math.min(PATCH_PIXELS, pixelCount(format)) * format.depth.bytesPerPixel;
}

/** The patch for a base whose tail bytes are already in hand — a loaded address. */
export function tailPatchFromBytes(
  format: ArchiveFormat,
  baseTail: Uint8Array,
  offset: number | bigint,
): TailPatch | null {
  if (offset === 0 || offset === 0n) return null;
  const bpp = format.depth.bytesPerPixel;
  const count = Math.floor(baseTail.length / bpp);
  const bytes = baseTail.slice(0, count * bpp);
  applyOffsetToTail(bytes, offset);
  return packTailPatch(bytes, bpp, pixelCount(format) - count);
}

export function tailPatch(format: ArchiveFormat, seed: Seed, offset: number | bigint, rounds = 12): TailPatch | null {
  if (offset === 0 || offset === 0n) return null;
  const total = pixelCount(format);
  const count = Math.min(PATCH_PIXELS, total);
  const bytes = tailBytes(format, seed, total - count, count, rounds);
  applyOffsetToTail(bytes, offset);
  return packTailPatch(bytes, format.depth.bytesPerPixel, total - count);
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
  offset: number | bigint,
  pixelIndex: number,
  patch: TailPatch | null,
  rounds = 12,
): { r: number; g: number; b: number } {
  if (patch && pixelIndex >= patch.firstPixel) {
    const d = (pixelIndex - patch.firstPixel) * 4;
    return { r: patch.values[d], g: patch.values[d + 1], b: patch.values[d + 2] };
  }
  void offset;
  return sampleSeed(format, seed, pixelIndex, rounds);
}

/**
 * Head of the address as hexadecimal, straight from the generator.
 *
 * Cheap for the same reason the patch is: the leading bytes of a seeded address
 * are just the first few pixels, so the address can be shown in the coordinate
 * lane without materialising anything.
 */
export function seedHeadBytes(format: ArchiveFormat, seed: Seed, count: number, rounds = 12): Uint8Array {
  const bpp = format.depth.bytesPerPixel;
  const pixels = Math.ceil(count / bpp);
  const bytes = new Uint8Array(pixels * bpp);
  for (let k = 0; k < pixels; k++) {
    const s = sampleSeed(format, seed, k, rounds);
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
  offset: number | bigint,
  count: number,
  rounds = 12,
): Uint8Array {
  const total = pixelCount(format);
  const bpp = format.depth.bytesPerPixel;
  const pixels = Math.min(total, Math.ceil(count / bpp));
  const first = total - pixels;
  const bytes = tailBytes(format, seed, first, pixels, rounds);
  if (offset !== 0 && offset !== 0n) applyOffsetToTail(bytes, offset);
  return bytes.subarray(Math.max(0, bytes.length - count));
}
