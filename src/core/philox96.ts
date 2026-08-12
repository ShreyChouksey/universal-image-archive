/**
 * 96-Word 3,072-Bit Philox ARX-Feistel Generator Core (Layer 0).
 *
 * Implements a 32-round Feistel network operating over 96 words (3,072-bit state
 * and key space). Evaluates 3,072-bit seeds into 8x8 48-bit grid pixels statelessly
 * in O(1) constant time on CPU and WebGPU.
 */

import type { ArchiveFormat } from './format';
import type { Seed3072 } from './seed3072';
import { pixelCount } from './format';

const PHILOX_CONSTANTS = [
  0xd2511f53, 0xcd9e8d57, 0x9e3779b9, 0xbb67ae85,
  0x85ebca6b, 0xc2b2ae35, 0x27d4eb2d, 0x165667b1,
] as const;

function mulhilo(a: number, b: number): [number, number] {
  const ah = (a >>> 16) & 0xffff;
  const al = a & 0xffff;
  const bh = (b >>> 16) & 0xffff;
  const bl = b & 0xffff;
  const albl = Math.imul(al, bl);
  const w1 = Math.imul(ah, bl) + (albl >>> 16);
  const w2 = Math.imul(al, bh) + (w1 & 0xffff);
  const hi = Math.imul(ah, bh) + (w1 >>> 16) + (w2 >>> 16);
  const lo = ((w2 & 0xffff) << 16) | (albl & 0xffff);
  return [hi >>> 0, lo >>> 0];
}

export function philox96x32(
  out: Uint32Array,
  counterLow: number,
  counterHigh: number,
  seed: Seed3072,
  rounds = 32,
): void {
  if (out.length < 96) throw new Error('Out array must have a length of at least 96');
  if (seed.length < 96) throw new Error('Seed3072 must have a length of 96');

  // Initialize state words from counters and seed
  out[0] = counterLow >>> 0;
  out[1] = counterHigh >>> 0;
  for (let i = 2; i < 96; i++) {
    out[i] = seed[i]! >>> 0;
  }

  // Feistel mixing rounds
  for (let r = 0; r < rounds; r++) {
    const c0 = PHILOX_CONSTANTS[r % 8]!;
    const c1 = PHILOX_CONSTANTS[(r + 1) % 8]!;

    for (let i = 0; i < 96; i += 2) {
      const [hi, lo] = mulhilo(c0, out[i]!);
      const key = seed[i]! ^ (c1 + r);
      out[i] = (lo ^ out[(i + 1) % 96]! ^ key) >>> 0;
      out[(i + 1) % 96] = hi >>> 0;
    }
  }
}

/**
 * Materialises a 3,072-bit seed into an 8x8 (or custom) grid pixel buffer.
 */
export function materialiseSeed3072(
  format: ArchiveFormat,
  seed: Seed3072,
  target: Uint8Array,
  rounds = 32,
): Uint8Array {
  const total = pixelCount(format);
  const bpc = format.depth.bpc;
  const bpp = format.depth.bytesPerPixel;
  const scratch = new Uint32Array(96);

  if (target.length < total * bpp) {
    throw new Error(`Target buffer too small: expected ${total * bpp} bytes`);
  }

  const mask = bpc === 16 ? 0xffff : 0xff;

  for (let i = 0; i < total; i++) {
    philox96x32(scratch, i >>> 0, (i / 0x100000000) >>> 0, seed, rounds);

    const r = scratch[0]! & mask;
    const g = scratch[1]! & mask;
    const b = scratch[2]! & mask;

    const offset = i * bpp;
    if (bpc === 16) {
      target[offset] = r >>> 8;
      target[offset + 1] = r & 0xff;
      target[offset + 2] = g >>> 8;
      target[offset + 3] = g & 0xff;
      target[offset + 4] = b >>> 8;
      target[offset + 5] = b & 0xff;
    } else {
      target[offset] = r;
      target[offset + 1] = g;
      target[offset + 2] = b;
    }
  }

  return target;
}
