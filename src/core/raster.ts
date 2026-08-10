/**
 * Pixel conversions between the archive's address bytes and the shapes other
 * parts of the system need.
 *
 * These were inside the worker, which made them untestable — Node cannot import
 * a module whose top level assigns `self.onmessage`. They are engine logic, not
 * worker plumbing, so they live here and the worker imports them. Nothing about
 * their behaviour changed in the move.
 */

import type { ArchiveFormat } from './format';
import { philox4x32_10, philoxScratch, type Seed } from './philox';

export type LowBits = 'replicate' | 'noise';

/**
 * Address bytes -> RGBA16 texels for the GPU.
 *
 * Alpha is unused by the shader but keeps rows at a width the upload path is
 * happy with.
 */
export function toTexture(format: ArchiveFormat, bytes: Uint8Array): Uint16Array {
  const { width, height } = format.resolution;
  const n = width * height;
  const out = new Uint16Array(n * 4);

  if (format.depth.bpc === 16) {
    for (let i = 0; i < n; i++) {
      const s = i * 6;
      const d = i * 4;
      out[d] = (bytes[s] << 8) | bytes[s + 1];
      out[d + 1] = (bytes[s + 2] << 8) | bytes[s + 3];
      out[d + 2] = (bytes[s + 4] << 8) | bytes[s + 5];
      out[d + 3] = 65535;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const s = i * 3;
      const d = i * 4;
      out[d] = bytes[s];
      out[d + 1] = bytes[s + 1];
      out[d + 2] = bytes[s + 2];
      out[d + 3] = 255;
    }
  }
  return out;
}

/**
 * 8-bit RGBA -> address bytes at the archive's depth.
 *
 * Promoting 8 bits to 16 by multiplying by 257 maps 0 -> 0 and 255 -> 65535
 * exactly, which is the correct expansion; here that is expressed as writing the
 * source byte into both halves, which is the same thing. The low byte is then
 * fully determined by the high one, so the image lands at a very unusual address
 * — one of the vanishingly few whose bytes repeat in pairs. `noise` instead
 * seeds the low byte from the archive itself, which leaves the picture visually
 * identical and puts it somewhere far more typical.
 */
export function encodeAddress(
  format: ArchiveFormat,
  rgba: Uint8ClampedArray | Uint8Array,
  lowBits: LowBits,
): Uint8Array {
  const n = format.resolution.width * format.resolution.height;
  const out = new Uint8Array(n * format.depth.bytesPerPixel);

  if (format.depth.bpc === 8) {
    for (let i = 0; i < n; i++) {
      out[i * 3] = rgba[i * 4];
      out[i * 3 + 1] = rgba[i * 4 + 1];
      out[i * 3 + 2] = rgba[i * 4 + 2];
    }
    return out;
  }

  if (lowBits === 'replicate') {
    for (let i = 0; i < n; i++) {
      const s = i * 4;
      const d = i * 6;
      out[d] = rgba[s];
      out[d + 1] = rgba[s];
      out[d + 2] = rgba[s + 1];
      out[d + 3] = rgba[s + 1];
      out[d + 4] = rgba[s + 2];
      out[d + 5] = rgba[s + 2];
    }
  } else {
    const scratch = philoxScratch();
    for (let i = 0; i < n; i++) {
      philox4x32_10(scratch, i >>> 0, (i / 0x100000000) >>> 0, 0, 0, 0x9e3779b9, 0x85ebca6b);
      const s = i * 4;
      const d = i * 6;
      out[d] = rgba[s];
      out[d + 1] = scratch[0] & 0xff;
      out[d + 2] = rgba[s + 1];
      out[d + 3] = scratch[1] & 0xff;
      out[d + 4] = rgba[s + 2];
      out[d + 5] = scratch[2] & 0xff;
    }
  }
  return out;
}

/**
 * Fills everything a supplied image did not reach with the archive's own noise
 * at `seed`. You supply what you saw; the archive supplies the rest of what
 * could have been seen from there.
 *
 * A null mask means nothing was reached, which is what the plane path passes
 * when the whole grid is surround.
 */
export function fillSurroundFromArchive(
  format: ArchiveFormat,
  seed: Seed,
  bytes: Uint8Array,
  mask: Uint8Array | null,
): void {
  const n = format.resolution.width * format.resolution.height;
  const scratch = philoxScratch();
  const wide = format.depth.bpc === 16;

  for (let i = 0; i < n; i++) {
    if (mask && mask[i]) continue;
    philox4x32_10(scratch, i >>> 0, (i / 0x100000000) >>> 0, seed[2], seed[3], seed[0], seed[1]);
    if (wide) {
      const o = i * 6;
      const r = scratch[0] & 0xffff;
      const g = scratch[1] & 0xffff;
      const b = scratch[2] & 0xffff;
      out16(bytes, o, r, g, b);
    } else {
      const o = i * 3;
      bytes[o] = scratch[0] & 0xff;
      bytes[o + 1] = scratch[1] & 0xff;
      bytes[o + 2] = scratch[2] & 0xff;
    }
  }
}

function out16(bytes: Uint8Array, o: number, r: number, g: number, b: number): void {
  bytes[o] = r >>> 8;
  bytes[o + 1] = r & 0xff;
  bytes[o + 2] = g >>> 8;
  bytes[o + 3] = g & 0xff;
  bytes[o + 4] = b >>> 8;
  bytes[o + 5] = b & 0xff;
}
