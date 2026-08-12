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
import { type Philox4, type Seed, philox4x32, philoxScratch } from './philox';

const LOG10_2 = Math.LOG10E * Math.LN2; // log10(2), correctly rounded

/**
 * V8 caps a BigInt at 2^30 bits, measured: 134,217,728 bytes parses and one
 * byte more throws. Everything that converts a whole address through BigInt —
 * the decimal export, and the digit counter's exact fallback — has to know
 * this number, because an 8K address is half again over it.
 */
export const BIGINT_MAX_BYTES = 134_217_728;

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
 * [R_hi, R_lo, G_hi, G_lo, B_hi, B_lo] at 16-bit, [R, G, B] at 8-bit.
 *
 * Counter arrangement: c0 = low 32 bits of pixel index, c1 = high 32 bits, c2 and
 * c3 = seed words 2 and 3. Key arrangement: k0 = seed word 0, k1 = seed word 1.
 *
 * The cipher is run once per pixel; the output four uint32 words fill the pixel's
 * three channels and leave the fourth word unused, exactly as the shader's fetch
 * helper does on the GPU.
 *
 * `range` restricts the write to `out` to `[range.from, range.to)` pixels, so a
 * worker can materialise a slice of an address directly without zeroing the
 * first three words. Pixel i depends only on i, so this may be resumed, sliced,
 * or run out of order.
 */
export function materialiseSeed(
  format: ArchiveFormat,
  seed: Seed,
  out: Uint8Array,
  range?: { from: number; to: number },
  rounds = 12,
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
      philox4x32(scratch, i >>> 0, (i / 0x100000000) >>> 0, c2, c3, k0, k1, rounds);
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
      philox4x32(scratch, i >>> 0, (i / 0x100000000) >>> 0, c2, c3, k0, k1, rounds);
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
  rounds = 12,
): { r: number; g: number; b: number } {
  const scratch = philoxScratch();
  philox4x32(
    scratch,
    pixelIndex >>> 0,
    (pixelIndex / 0x100000000) >>> 0,
    seed[2],
    seed[3],
    seed[0],
    seed[1],
    rounds,
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
 *
 * Returns the index of the lowest byte it touched, so callers can refresh only
 * the part of the picture that actually changed — for a small step that is the
 * last row rather than all forty-seven megabytes.
 */
export function bumpAddress(bytes: Uint8Array, delta: number | bigint): number {
  if (delta === 0 || delta === 0n) return bytes.length;
  const deltaBig = typeof delta === 'bigint' ? delta : BigInt(Math.trunc(delta));
  const negative = deltaBig < 0n;
  let mag = negative ? -deltaBig : deltaBig;
  let i = bytes.length - 1;

  if (negative) {
    let borrow = 0n;
    while (i >= 0 && (mag > 0n || borrow > 0n)) {
      const sub = (mag & 0xffn) + borrow;
      let v = BigInt(bytes[i]) - sub;
      if (v < 0n) {
        v += 256n;
        borrow = 1n;
      } else borrow = 0n;
      bytes[i] = Number(v);
      mag >>= 8n;
      i--;
    }
    return i + 1;
  } else {
    let carry = 0n;
    while (i >= 0 && (mag > 0n || carry > 0n)) {
      const add = (mag & 0xffn) + carry;
      let v = BigInt(bytes[i]) + add;
      if (v > 255n) {
        v -= 256n;
        carry = 1n;
      } else carry = 0n;
      bytes[i] = Number(v);
      mag >>= 8n;
      i--;
    }
    return i + 1;
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
  // The residue is mod 10^15, so fifteen digits is all this function knows.
  // Asking for more used to silently return fifteen; now it is an error, since
  // a sixteen-digit request answered with fifteen is a wrong answer.
  if (digits > 15) throw new RangeError('trailingDecimalDigits knows at most 15 digits');
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
  if (n < TAIL_BYTES) {
    // Too short to hold a solvable tail. Failing loudly beats what the old code
    // did, which was to write before the start of the array and report success.
    throw new RangeError(`solveTail needs at least ${TAIL_BYTES} bytes, got ${n}`);
  }
  if (!Number.isInteger(target) || target < 0 || target >= DECIMAL_MODULUS) {
    throw new RangeError('target must be an integer in [0, 10^15)');
  }

  // Value of everything before the tail, shifted into place.
  const head = residueMod10e15(bytes, 0, n - TAIL_BYTES, TAIL_BYTES);
  const base = (((target - head) % DECIMAL_MODULUS) + DECIMAL_MODULUS) % DECIMAL_MODULUS;

  // The tail spans [0, 2^56): 72 or 73 solutions to the congruence. The pick
  // can exceed 2^53, so the bytes are extracted through BigInt — an earlier
  // version capped at MAX_SAFE_INTEGER to stay in doubles and silently reached
  // only the bottom eighth of the space, misreporting the count it printed.
  const CEILING = (1n << 56n) - 1n;
  const solutions = Number((CEILING - BigInt(base)) / BigInt(DECIMAL_MODULUS)) + 1;
  const pick = Math.floor(Math.random() * solutions);
  let value = BigInt(base) + BigInt(pick) * BigInt(DECIMAL_MODULUS);

  for (let i = n - 1; i >= n - TAIL_BYTES; i--) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return { chosen: pick, solutions };
}

// log10(2) split across two doubles. A single double carries it to about one
// part in 10^16; multiplied by a bit length of 4 x 10^8 that leaves 10^-8 of
// slop, which is enough to miscount the digits of a number sitting on a decade
// boundary. The pair carries it to one part in 10^33.
const LOG10_2_HI = 0.3010299956639812;
const LOG10_2_LO = -2.80372812778517e-18;

/** Exact product of two doubles as an unevaluated sum, by Dekker's method. */
function twoProduct(a: number, b: number): [number, number] {
  const p = a * b;
  const SPLIT = 134217729; // 2^27 + 1
  const ca = SPLIT * a;
  const ahi = ca - (ca - a);
  const alo = a - ahi;
  const cb = SPLIT * b;
  const bhi = cb - (cb - b);
  const blo = b - bhi;
  return [p, alo * blo - (((p - ahi * bhi) - alo * bhi) - ahi * blo)];
}

/** Exact sum of two doubles as an unevaluated sum, by Knuth's method. */
function twoSum(a: number, b: number): [number, number] {
  const s = a + b;
  const bb = s - a;
  return [s, (a - (s - bb)) + (b - bb)];
}

/** Above this many significant bytes, the exact route costs more than it is worth. */
const EXACT_DIGIT_LIMIT = 8192;

/**
 * Widest the two-double estimate can be wrong, generously over-stated.
 *
 * The real bound is around 10^-14: one part in 2^52 from truncating the
 * mantissa, a couple of ulps from `Math.log10`, and one rounding at the end.
 * A thousandfold margin on top costs nothing, because all this threshold decides
 * is how often the exact route gets taken.
 */
const DIGIT_ESTIMATE_SLOP = 1e-11;

/**
 * Decimal magnitude of the address: how many digits it has written out in full.
 *
 * Three routes, and the answer is always exact.
 *
 * Up to 8 KiB, straight from BigInt — instant at that size, and it settles every
 * awkward case outright.
 *
 * Above that, from the bit length and the leading 53 bits in two-double
 * arithmetic. The naive single-double version cannot work: the answer is around
 * 1.2 x 10^8, which a double resolves only to 1.5 x 10^-8, coarser than the
 * quantity being floored.
 *
 * And when the estimate lands close enough to a decade boundary that the floor
 * is genuinely undecided — an address at or beside an exact power of ten, where
 * the true fractional part is zero and no finite precision can break the tie —
 * it falls through to BigInt regardless of size. That is slow, and it is taken
 * for roughly one address in 10^11, which is to say never unless someone
 * constructs one on purpose. Correctness is the thing being bought.
 */
export function decimalDigitCount(bytes: Uint8Array): number {
  let lead = 0;
  while (lead < bytes.length && bytes[lead] === 0) lead++;
  if (lead === bytes.length) return 1; // the all-black image is address zero

  const significant = bytes.length - lead;
  if (significant <= EXACT_DIGIT_LIMIT) {
    return BigInt('0x' + hexSlice(bytes, lead, significant)).toString(10).length;
  }

  // N = mantissa * 2^shift, with mantissa held to 53 bits so it is exact as a
  // double. Twelve leading bytes through BigInt costs nothing at this size and
  // avoids hand-rolling the shift.
  const topBytes = Math.min(significant, 12);
  const leadingBits = 32 - Math.clz32(bytes[lead]);
  const bitsInTop = (topBytes - 1) * 8 + leadingBits;
  const drop = Math.max(0, bitsInTop - 53);
  const mantissa = Number(BigInt('0x' + hexSlice(bytes, lead, topBytes)) >> BigInt(drop));
  const shift = (significant - topBytes) * 8 + drop;

  // log10(N) = log10(mantissa) + shift * log10(2), accumulated without losing
  // the low end to the exponent's magnitude.
  let [hi, lo] = twoProduct(shift, LOG10_2_HI);
  lo += shift * LOG10_2_LO;
  const [mh, ml] = twoSum(hi, Math.log10(mantissa));
  hi = mh;
  lo += ml;

  const floorHi = Math.floor(hi);
  let integer = floorHi;
  let frac = (hi - floorHi) + lo;
  if (frac >= 1) {
    integer += 1;
    frac -= 1;
  } else if (frac < 0) {
    integer -= 1;
    frac += 1;
  }

  // Too near a boundary to call. Pay for the exact answer rather than guess —
  // unless the address exceeds what a BigInt can hold, where the estimate is
  // all there is. That combination needs an address over 128 MiB constructed to
  // sit within 10^-11 of a power of ten; if someone builds one, the count may
  // be off by one, and every other figure shown for it remains exact.
  if (frac < DIGIT_ESTIMATE_SLOP || frac > 1 - DIGIT_ESTIMATE_SLOP) {
    if (significant <= BIGINT_MAX_BYTES) {
      return BigInt('0x' + hexSlice(bytes, lead, significant)).toString(10).length;
    }
  }
  return integer + 1;
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

  const width = dv.getUint32(4, false);
  const height = dv.getUint32(8, false);
  const bpc = dv.getUint16(12, false);
  const channels = dv.getUint16(14, false);
  const bytes = new Uint8Array(buffer, v2 ? 20 : 16);

  // A truncated file is not a shorter address — it is a different number
  // entirely, and opening it as one would show the right dimensions wrapped
  // around the wrong image. The header's arithmetic must match the payload.
  if (bpc !== 8 && bpc !== 16) return null;
  if (width === 0 || height === 0 || channels !== 3) return null;
  if (bytes.length !== width * height * channels * (bpc / 8)) return null;

  return {
    width,
    height,
    bpc,
    channels,
    geometry: v2 && dv.getUint16(16, false) === 1 ? 'sphere' : 'plane',
    bytes,
  };
}
