/**
 * 3,072-Bit Seed Arithmetic Core (Layer 0).
 *
 * Implements Uint32Array(96) 3,072-bit seed entropy vectors, 768-character hex
 * serialization, cryptographically secure random generation, and BigInt carry-propagating
 * 96-word addition.
 */

export type Seed3072 = Uint32Array; // Length 96

export function createSeed3072(): Seed3072 {
  return new Uint32Array(96);
}

export function randomSeed3072(): Seed3072 {
  const seed = new Uint32Array(96);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(seed);
  } else {
    throw new Error('Web Crypto API (crypto.getRandomValues) is required for secure seed generation');
  }
  return seed;
}

export function seed3072FromHex(hex: string): Seed3072 {
  const clean = hex.trim().replace(/^0x/i, '');
  if (clean.length !== 768 || !/^[0-9a-fA-F]{768}$/.test(clean)) {
    throw new Error('Seed3072 hex string must be exactly 768 hexadecimal characters');
  }
  const seed = new Uint32Array(96);
  for (let i = 0; i < 96; i++) {
    const chunk = clean.slice(i * 8, (i + 1) * 8);
    seed[i] = parseInt(chunk, 16) >>> 0;
  }
  return seed;
}

export function seed3072ToHex(seed: Seed3072): string {
  if (seed.length !== 96) {
    throw new Error('Seed3072 must have a length of 96 words');
  }
  let out = '';
  for (let i = 0; i < 96; i++) {
    out += seed[i]!.toString(16).padStart(8, '0');
  }
  return out;
}

/**
 * Adds a BigInt delta to a 3,072-bit seed in-place with carry propagation across 96 words.
 */
export function seed3072Add(seed: Seed3072, delta: bigint): Seed3072 {
  if (seed.length !== 96) {
    throw new Error('Seed3072 must have a length of 96 words');
  }
  let carry = delta;
  for (let i = 95; i >= 0; i--) {
    const current = BigInt(seed[i]!);
    const sum = current + (carry & 0xffffffffn);
    seed[i] = Number(sum & 0xffffffffn) >>> 0;
    carry = (sum >> 32n) + (carry >> 32n);
    if (carry === 0n && i > 0) break;
  }
  return seed;
}
