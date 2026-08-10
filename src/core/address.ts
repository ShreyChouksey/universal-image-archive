/**
 * Addresses.
 *
 * An address is the image. Concretely: the pixels of an image, row-major, each
 * channel big-endian, concatenated into one byte string — and that byte string
 * read as a single integer in base 256. Address 0 is pure black; the largest
 * address is pure white; every image that fits the format sits at exactly one
 * address, and every address is exactly one image. The map is total and
 * injective in both directions, which is the whole claim of the archive.
 *
 * At 4K/48-bit an address is 47.5 MiB — about 120 million decimal digits. That
 * is unshareable, so the archive has a second lane: a 128-bit *seed* names an
 * address by expanding through Philox. Every seed resolves to a real address;
 * not every address has a seed. Seeds are for travelling, addresses are for
 * completeness.
 */

import {
  type ArchiveFormat,
  type Geometry,
  addressBits,
  addressBytes,
  pixelCount,
} from './format';
import { type Philox4, type Seed, philox4x32_10, philoxScratch } from './philox';

const LOG10_2 = Math.LOG10E * Math.LN2; // log10(2), correctly rounded

// ---------------------------------------------------------------------------
// Archive-scale statistics
// ---------------------------------------------------------------------------

export interface ArchiveScale {
  /** Distinct colours a single pixel can take. */
  colours: number;
  pixels: number;
  /** Bytes in one address. */
  bytes: number;
  /** Bits in one address == log2 of the archive's cardinality. */
  bits: number;
  /** Decimal digits in the count of images. */
  cardinalityDigits: number;
  /** The archive's size as "10^n". */
  cardinalityExponent: number;
}

export function archiveScale(format: ArchiveFormat): ArchiveScale {
  const bits = addressBits(format);
  const exponent = Math.floor(bits * LOG10_2);
  return {
    colours: Math.pow(2, format.depth.bpc * 3),
    pixels: pixelCount(format),
    bytes: addressBytes(format),
    bits,
    cardinalityDigits: exponent + 1,
    cardinalityExponent: exponent,
  };
}

// ---------------------------------------------------------------------------
// Materialisation: seed -> address bytes
// ---------------------------------------------------------------------------

/**
 * Writes the address named by `seed` into `out`.
 *
 * Layout per pixel, matching PNG's byte order so export is a straight copy:
 *   16 bpc -> [R_hi, R_lo, G_hi, G_lo, B_hi, B_lo]
 *    8 bpc -> [R, G, B]
 *
 * Each pixel consumes one Philox block (128 bits) and uses the low bits of the
 * first three words. Pixel i depends only on i, so this may be resumed, sliced,
 * or run out of order.
 */
export function materialiseSeed(
  format: ArchiveFormat,
  seed: Seed,
  out: Uint8Array,
  range?: { from: number; to: number },
): void {
  const total = pixelCount(format);
  const from = range?.from ?? 0;
  const to = Math.min(range?.to ?? total, total);
  const scratch: Philox4 = philoxScratch();
  const k0 = seed[0];
  const k1 = seed[1];
  const c2 = seed[2];
  const c3 = seed[3];

  if (format.depth.bpc === 16) {
    for (let i = from; i < to; i++) {
      philox4x32_10(scratch, i >>> 0, (i / 0x100000000) >>> 0, c2, c3, k0, k1);
      const o = i * 6;
      const r = scratch[0] & 0xffff;
      const g = scratch[1] & 0xffff;
      const b = scratch[2] & 0xffff;
      out[o] = r >>> 8;
      out[o + 1] = r & 0xff;
      out[o + 2] = g >>> 8;
      out[o + 3] = g & 0xff;
      out[o + 4] = b >>> 8;
      out[o + 5] = b & 0xff;
    }
  } else {
    for (let i = from; i < to; i++) {
      philox4x32_10(scratch, i >>> 0, (i / 0x100000000) >>> 0, c2, c3, k0, k1);
      const o = i * 3;
      out[o] = scratch[0] & 0xff;
      out[o + 1] = scratch[1] & 0xff;
      out[o + 2] = scratch[2] & 0xff;
    }
  }
}

/** The colour at a single pixel of a seeded image, without materialising the rest. */
export function sampleSeed(
  format: ArchiveFormat,
  seed: Seed,
  pixelIndex: number,
): { r: number; g: number; b: number } {
  const scratch = philoxScratch();
  philox4x32_10(
    scratch,
    pixelIndex >>> 0,
    (pixelIndex / 0x100000000) >>> 0,
    seed[2],
    seed[3],
    seed[0],
    seed[1],
  );
  const mask = format.depth.bpc === 16 ? 0xffff : 0xff;
  return { r: scratch[0] & mask, g: scratch[1] & mask, b: scratch[2] & mask };
}

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

/**
 * address += delta, in place, as a big-endian base-256 integer.
 *
 * Adding one flips the least significant bit of the last pixel's blue channel:
 * the neighbouring image in the archive, indistinguishable to the eye and a
 * different picture by definition. Wraps at both ends.
 */
export function bumpAddress(bytes: Uint8Array, delta: number): void {
  if (delta === 0) return;
  const negative = delta < 0;
  let mag = Math.abs(Math.trunc(delta));
  let i = bytes.length - 1;

  if (negative) {
    let borrow = 0;
    while (i >= 0 && (mag > 0 || borrow)) {
      const sub = (mag % 256) + borrow;
      let v = bytes[i] - sub;
      if (v < 0) {
        v += 256;
        borrow = 1;
      } else borrow = 0;
      bytes[i] = v;
      mag = Math.floor(mag / 256);
      i--;
    }
  } else {
    let carry = 0;
    while (i >= 0 && (mag > 0 || carry)) {
      const add = (mag % 256) + carry;
      let v = bytes[i] + add;
      if (v > 255) {
        v -= 256;
        carry = 1;
      } else carry = 0;
      bytes[i] = v;
      mag = Math.floor(mag / 256);
      i--;
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering an address for human eyes
// ---------------------------------------------------------------------------

const HEX = '0123456789abcdef';

export function hexSlice(bytes: Uint8Array, start: number, count: number): string {
  let out = '';
  const end = Math.min(start + count, bytes.length);
  for (let i = start; i < end; i++) {
    out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  }
  return out;
}

/**
 * The last `digits` decimal digits of the address, computed exactly.
 *
 * Streams the whole byte string under mod 10^15, splitting the multiply so every
 * intermediate stays inside a double's exact integer range. One pass, no BigInt.
 */
export const DECIMAL_MODULUS = 1e15;

/**
 * The address, reduced mod 10^15, reading `bytes[from..to)` and then treating
 * the remaining `trailingZeros` bytes as zero.
 *
 * Every intermediate stays inside a double's exact integer range by splitting
 * the multiply at 10^8. One pass over 47 MB, no BigInt.
 */
export function residueMod10e15(
  bytes: Uint8Array,
  from = 0,
  to = bytes.length,
  trailingZeros = 0,
): number {
  const SPLIT = 1e8;
  let acc = 0;
  const step = (byte: number) => {
    const hi = Math.floor(acc / SPLIT); // < 1e7
    const lo = acc - hi * SPLIT; // < 1e8
    acc = (((hi * 256) % 1e7) * SPLIT + lo * 256 + byte) % DECIMAL_MODULUS;
  };
  for (let i = from; i < to; i++) step(bytes[i]);
  for (let i = 0; i < trailingZeros; i++) step(0);
  return acc;
}

export function trailingDecimalDigits(bytes: Uint8Array, digits = 15): string {
  return String(residueMod10e15(bytes)).padStart(15, '0').slice(-digits);
}

/** Bytes at the end of the address reserved for solving. 7 x 8 = 56 bits > log2(10^15). */
export const TAIL_BYTES = 7;

/**
 * Rewrites the final `TAIL_BYTES` so the whole address ends in `target`.
 *
 * The address is H·256^7 + T with H fixed by everything already stamped, so
 * T ≡ target − H·256^7 (mod 10^15). Because 256^7 ≈ 7.2 × 10^16 exceeds the
 * modulus, that congruence has many solutions in range; the choice among them
 * is the only randomness, and it is confined to the last two pixels.
 *
 * This is what makes the plate possible at all. The number is not a label
 * attached to the image — it is the image, so the image can be solved for.
 */
export function solveTail(bytes: Uint8Array, target: number): { chosen: number; solutions: number } {
  const n = bytes.length;
  // Value of everything before the tail, shifted into place.
  const head = residueMod10e15(bytes, 0, n - TAIL_BYTES, TAIL_BYTES);
  const base = (((target - head) % DECIMAL_MODULUS) + DECIMAL_MODULUS) % DECIMAL_MODULUS;

  // Keep candidates under 2^53 so the byte extraction below stays exact.
  const ceiling = Number.MAX_SAFE_INTEGER;
  const solutions = Math.floor((ceiling - base) / DECIMAL_MODULUS) + 1;
  const pick = Math.floor(Math.random() * solutions);
  let value = base + pick * DECIMAL_MODULUS;

  for (let i = n - 1; i >= n - TAIL_BYTES; i--) {
    bytes[i] = value % 256;
    value = Math.floor(value / 256);
  }
  return { chosen: pick, solutions };
}

/**
 * Decimal magnitude of the address: how many digits it has written out in full.
 *
 * Derived from the position of the leading non-zero byte, so it is exact except
 * for addresses within one part in 10^9 of a power of ten.
 */
export function decimalDigitCount(bytes: Uint8Array): number {
  let lead = 0;
  while (lead < bytes.length && bytes[lead] === 0) lead++;
  if (lead === bytes.length) return 1; // the all-black image is address zero

  // Value of the top 6 significant bytes, exact in a double.
  let top = 0;
  for (let i = lead; i < Math.min(lead + 6, bytes.length); i++) top = top * 256 + bytes[i];
  const consumed = Math.min(6, bytes.length - lead);
  const remainingBytes = bytes.length - lead - consumed;
  const log10 = Math.log10(top) + remainingBytes * 8 * LOG10_2;
  return Math.floor(log10) + 1;
}

export interface AddressReadout {
  head: string;
  tail: string;
  bytes: number;
  digitCount: number;
  trailingDecimal: string;
}

export function readAddress(bytes: Uint8Array, groupBytes = 16): AddressReadout {
  return {
    head: hexSlice(bytes, 0, groupBytes),
    tail: hexSlice(bytes, Math.max(0, bytes.length - groupBytes), groupBytes),
    bytes: bytes.length,
    digitCount: decimalDigitCount(bytes),
    trailingDecimal: trailingDecimalDigits(bytes, 12),
  };
}

// ---------------------------------------------------------------------------
// Address file container
// ---------------------------------------------------------------------------

const MAGIC_V1 = 0x55494131; // "UIA1" — 16-byte header, plane geometry implied
const MAGIC_V2 = 0x55494132; // "UIA2" — 20-byte header, geometry recorded

/**
 * Wraps raw address bytes in a self-describing header.
 *
 * Geometry has to travel with the file. The same bytes are a different picture
 * read as a plane and read as a sphere, so a container that omitted it would
 * hand back the right number and the wrong image.
 */
export function packAddressFile(format: ArchiveFormat, bytes: Uint8Array): Blob {
  const header = new ArrayBuffer(20);
  const dv = new DataView(header);
  dv.setUint32(0, MAGIC_V2, false);
  dv.setUint32(4, format.resolution.width, false);
  dv.setUint32(8, format.resolution.height, false);
  dv.setUint16(12, format.depth.bpc, false);
  dv.setUint16(14, 3, false); // channels
  dv.setUint16(16, format.resolution.geometry === 'sphere' ? 1 : 0, false);
  dv.setUint16(18, 0, false); // reserved
  return new Blob([header, bytes as BufferSource], { type: 'application/octet-stream' });
}

export interface UnpackedAddress {
  width: number;
  height: number;
  bpc: number;
  channels: number;
  geometry: Geometry;
  bytes: Uint8Array;
}

/** Reads either container version; v1 files predate geometry and are planes. */
export function unpackAddressFile(buffer: ArrayBuffer): UnpackedAddress | null {
  if (buffer.byteLength < 16) return null;
  const dv = new DataView(buffer);
  const magic = dv.getUint32(0, false);
  if (magic !== MAGIC_V1 && magic !== MAGIC_V2) return null;

  const v2 = magic === MAGIC_V2;
  if (v2 && buffer.byteLength < 20) return null;
  return {
    width: dv.getUint32(4, false),
    height: dv.getUint32(8, false),
    bpc: dv.getUint16(12, false),
    channels: dv.getUint16(14, false),
    geometry: v2 && dv.getUint16(16, false) === 1 ? 'sphere' : 'plane',
    bytes: new Uint8Array(buffer, v2 ? 20 : 16),
  };
}
