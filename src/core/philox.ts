/**
 * Philox 4x32-10 — a counter-based pseudorandom function.
 *
 * Why this and not a stream cipher or a Mersenne twister: Philox is *stateless*.
 * The value at pixel i is a pure function of (key, i), so pixel 8,294,399 costs
 * exactly as much to compute as pixel 0. That is what lets the GPU paint a whole
 * 4K frame in parallel, and what lets the CPU materialise any slice of an address
 * without walking the ones before it. A sequential PRNG cannot do either, which is
 * why the original Babelia needs three seconds and a server to draw one image.
 *
 * This module is the normative CPU implementation. `philox.wgsl` / the GLSL
 * fragment shader are line-for-line ports; `verifyGpuAgreement()` in the renderer
 * checks a sample of pixels against this code at startup.
 */

const M0 = 0xd2511f53;
const M1 = 0xcd9e8d57;
const W0 = 0x9e3779b9; // golden ratio
const W1 = 0xbb67ae85; // sqrt(3) - 1

/** Full 64-bit product of two uint32s, returned as [hi, lo]. */
function mulhilo(a: number, b: number): [number, number] {
  const ah = a >>> 16;
  const al = a & 0xffff;
  const bh = b >>> 16;
  const bl = b & 0xffff;

  const albl = al * bl; // < 2^32
  const mid = ah * bl + al * bh + (albl >>> 16); // < 2^33, exact in a double
  const hi = (ah * bh + Math.floor(mid / 65536)) >>> 0;
  const lo = ((((mid & 0xffff) << 16) >>> 0) + (albl & 0xffff)) >>> 0;
  return [hi, lo];
}

/** Scratch output so the hot loop allocates nothing. */
export type Philox4 = Uint32Array & { length: 4 };

export function philoxScratch(): Philox4 {
  return new Uint32Array(4) as Philox4;
}

/**
 * Ten rounds of Philox4x32.
 *
 * @param out  4 uint32s of output (128 bits)
 * @param c0..c3 counter words
 * @param k0,k1  key words
 */
export function philox4x32_10(
  out: Philox4,
  c0: number,
  c1: number,
  c2: number,
  c3: number,
  k0: number,
  k1: number,
): void {
  let x0 = c0 >>> 0;
  let x1 = c1 >>> 0;
  let x2 = c2 >>> 0;
  let x3 = c3 >>> 0;
  let key0 = k0 >>> 0;
  let key1 = k1 >>> 0;

  for (let round = 0; round < 10; round++) {
    const [hi0, lo0] = mulhilo(M0, x0);
    const [hi1, lo1] = mulhilo(M1, x2);
    const n0 = (hi1 ^ x1 ^ key0) >>> 0;
    const n1 = lo1;
    const n2 = (hi0 ^ x3 ^ key1) >>> 0;
    const n3 = lo0;
    x0 = n0;
    x1 = n1;
    x2 = n2;
    x3 = n3;
    if (round < 9) {
      key0 = (key0 + W0) >>> 0;
      key1 = (key1 + W1) >>> 0;
    }
  }

  out[0] = x0;
  out[1] = x1;
  out[2] = x2;
  out[3] = x3;
}

/**
 * A coordinate in the seeded lane of the archive: 128 bits, four uint32 words.
 *
 * Words 0 and 1 become the Philox key; words 2 and 3 occupy the high half of
 * the counter. The low half of the counter is the pixel index, so a seed names
 * one image and the pixel index selects within it.
 */
export type Seed = Uint32Array & { length: 4 };

export function seedFromWords(a: number, b: number, c: number, d: number): Seed {
  const s = new Uint32Array(4) as Seed;
  s[0] = a >>> 0;
  s[1] = b >>> 0;
  s[2] = c >>> 0;
  s[3] = d >>> 0;
  return s;
}

export function randomSeed(): Seed {
  const s = new Uint32Array(4) as Seed;
  crypto.getRandomValues(s);
  return s;
}

export function seedToHex(seed: Seed): string {
  let out = '';
  for (let i = 0; i < 4; i++) out += seed[i].toString(16).padStart(8, '0');
  return out;
}

/** Parses 1–32 hex characters; short input is right-aligned (treated as a small number). */
export function seedFromHex(hex: string): Seed | null {
  const clean = hex.trim().replace(/^0x/i, '').replace(/[\s_-]/g, '').toLowerCase();
  if (clean.length === 0 || clean.length > 32 || /[^0-9a-f]/.test(clean)) return null;
  const padded = clean.padStart(32, '0');
  const s = new Uint32Array(4) as Seed;
  for (let i = 0; i < 4; i++) s[i] = parseInt(padded.slice(i * 8, i * 8 + 8), 16) >>> 0;
  return s;
}

/** seed + delta, as a 128-bit big-endian integer, wrapping at the ends. */
export function seedAdd(seed: Seed, delta: number): Seed {
  const out = new Uint32Array(4) as Seed;
  out.set(seed);
  if (delta === 0) return out;

  const negative = delta < 0;
  let mag = Math.abs(Math.trunc(delta));
  const limbs: number[] = []; // least significant first
  while (mag > 0) {
    limbs.push(mag % 0x100000000);
    mag = Math.floor(mag / 0x100000000);
  }

  let borrowOrCarry = 0;
  for (let k = 0; k < 4; k++) {
    const i = 3 - k; // words are big-endian
    const operand = (limbs[k] ?? 0) + borrowOrCarry;
    if (negative) {
      let v = out[i] - operand;
      if (v < 0) {
        v += 0x100000000;
        borrowOrCarry = 1;
      } else borrowOrCarry = 0;
      out[i] = v >>> 0;
    } else {
      let v = out[i] + operand;
      if (v > 0xffffffff) {
        v -= 0x100000000;
        borrowOrCarry = 1;
      } else borrowOrCarry = 0;
      out[i] = v >>> 0;
    }
  }
  return out;
}

/**
 * Checks this implementation against the two published Random123 vectors for
 * philox4x32-10. If these pass, the generator is the standard one — which
 * matters because the address of an image is defined by it, and a divergence
 * would silently repoint every coordinate in the archive at a different picture.
 */
export function selfTest(): { ok: boolean; detail: string } {
  const out = philoxScratch();
  const hex = () => Array.from(out, (v) => v.toString(16).padStart(8, '0')).join('');

  philox4x32_10(out, 0, 0, 0, 0, 0, 0);
  const zeros = hex();
  philox4x32_10(out, -1, -1, -1, -1, -1, -1);
  const ones = hex();

  const expectZeros = '6627e8d5e169c58dbc57ac4c9b00dbd8';
  const expectOnes = '408f276d41c83b0ea20bc7c66d5451fd';
  const ok = zeros === expectZeros && ones === expectOnes;
  return {
    ok,
    detail: ok ? 'philox4x32-10 matches Random123 reference vectors' : `got ${zeros} / ${ones}`,
  };
}

/** Deterministic seed derived from arbitrary text, so phrases name images too. */
export function seedFromPhrase(phrase: string): Seed {
  // FNV-1a over UTF-8, four independently offset lanes.
  const bytes = new TextEncoder().encode(phrase);
  const offsets = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  const s = new Uint32Array(4) as Seed;
  for (let lane = 0; lane < 4; lane++) {
    let h = offsets[lane] >>> 0;
    for (let i = 0; i < bytes.length; i++) {
      h = (h ^ bytes[i]) >>> 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    // final avalanche (murmur3 fmix32)
    h = (h ^ (h >>> 16)) >>> 0;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    s[lane] = h;
  }
  return s;
}
