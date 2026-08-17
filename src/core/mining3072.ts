/**
 * Experimental scratchpad-based proof-of-work primitives.
 *
 * The construction is deterministic but has not been cryptanalysed and must not
 * be described as ASIC-resistant or consensus-ready. The version-zero mining
 * wrappers below compare an independently supplied expected difficulty with the
 * block header and use fixed parameters. Network difficulty derivation remains
 * the responsibility of a future versioned consensus layer.
 */

import type { Seed3072 } from './seed3072';
import type { BlockContainer384 } from './block384';
import { encodeBlock384, decodeBlock384, blockToSeed3072, UINT64_MAX } from './block384';
import { philox96x32 } from './philox96';

export const DEFAULT_MEMORY_MB = 4; // 4 MiB scratchpad default
export const MAX_MEMORY_MB = 64;
export const POW_PROFILE_MEMORY_MB = DEFAULT_MEMORY_MB;
const POW_PROFILE_MIX_PASSES = 1;

function validateIntegerInRange(value: number, field: string, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/**
 * Expands a 3,072-bit seed into a 4 MiB (1,048,576 Uint32 words) memory scratchpad.
 */
export function generateMemoryScratchpad(seed: Seed3072, memoryMb = DEFAULT_MEMORY_MB): Uint32Array {
  if (seed.length !== 96) throw new Error('Seed3072 must contain exactly 96 words');
  const mb = validateIntegerInRange(memoryMb, 'memoryMb', 1, MAX_MEMORY_MB);
  const wordCount = (mb * 1024 * 1024) / 4;
  const scratchpad = new Uint32Array(wordCount);
  const temp = new Uint32Array(96);

  // Iterative expansion using Philox96x32
  const chunks = Math.ceil(wordCount / 96);
  for (let c = 0; c < chunks; c++) {
    philox96x32(temp, c >>> 0, (c / 0x100000000) >>> 0, seed, 16);
    const start = c * 96;
    const end = Math.min(start + 96, wordCount);
    for (let i = start; i < end; i++) {
      scratchpad[i] = temp[i - start]!;
    }
  }

  return scratchpad;
}

/**
 * Data-dependent scratchpad mixing loop.
 */
export function mixScratchpadMemoryHard(scratchpad: Uint32Array, passes = 2): Uint32Array {
  const len = scratchpad.length;
  if (len === 0) throw new Error('scratchpad must not be empty');
  const passCount = validateIntegerInRange(passes, 'passes', 1, 16);
  let ptr = 0;

  const iterations = len * passCount;
  for (let i = 0; i < iterations; i++) {
    const prev = scratchpad[ptr]!;
    const targetIdx = ((prev ^ i) >>> 0) % len;
    const readVal = scratchpad[targetIdx]!;

    const nextVal = (prev ^ readVal ^ 0x9e3779b9) >>> 0;
    scratchpad[ptr] = nextVal;
    ptr = ((ptr + readVal + 1) >>> 0) % len;
  }

  return scratchpad;
}

/**
 * Folds a non-empty scratchpad into eight 32-bit accumulator words. This is a
 * bespoke fingerprint, not a reviewed cryptographic hash.
 */
export function compressScratchpadToHash(scratchpad: Uint32Array): Uint32Array {
  const hash = new Uint32Array(8);
  let h0 = 0x6a09e667 >>> 0;
  let h1 = 0xbb67ae85 >>> 0;
  let h2 = 0x3c6ef372 >>> 0;
  let h3 = 0xa54ff53a >>> 0;
  let h4 = 0x510e527f >>> 0;
  let h5 = 0x9b05688c >>> 0;
  let h6 = 0x1f83d9ab >>> 0;
  let h7 = 0x5be0cd19 >>> 0;

  const len = scratchpad.length;
  if (len === 0) throw new Error('scratchpad must not be empty');

  for (let i = 0; i < len; i++) {
    const val = scratchpad[i]!;
    h0 = Math.imul(h0 ^ val, 0x01000193) >>> 0;
    h1 = Math.imul(h1 ^ val, 0x85ebca6b) >>> 0;
    h2 = Math.imul(h2 ^ val, 0xc2b2ae35) >>> 0;
    h3 = Math.imul(h3 ^ val, 0x27d4eb2d) >>> 0;
    h4 = Math.imul(h4 ^ val, 0x165667b1) >>> 0;
    h5 = Math.imul(h5 ^ val, 0x9e3779b9) >>> 0;
    h6 = Math.imul(h6 ^ val, 0xd2511f53) >>> 0;
    h7 = Math.imul(h7 ^ val, 0xcd9e8d57) >>> 0;
  }

  hash[0] = h0;
  hash[1] = h1;
  hash[2] = h2;
  hash[3] = h3;
  hash[4] = h4;
  hash[5] = h5;
  hash[6] = h6;
  hash[7] = h7;

  return hash;
}

/**
 * Counts leading zero bits in a 256-bit hash.
 */
export function countHashLeadingZeros(hash: Uint32Array): number {
  if (hash.length !== 8) throw new Error('Hash must contain exactly 8 Uint32 words');
  let count = 0;
  for (let i = 0; i < 8; i++) {
    const word = hash[i]!;
    const lz = Math.clz32(word);
    count += lz;
    if (lz < 32) break;
  }
  return count;
}

export interface MiningResult3072 {
  found: boolean;
  attempts: number;
  seed: Seed3072 | null;
  minedBlock: BlockContainer384 | null;
  hashHex: string;
  leadingZeros: number;
}

/**
 * Fixed-profile experimental mining loop. The caller must supply the expected
 * difficulty derived independently from the candidate block.
 */
export function mineBlock3072(
  block: BlockContainer384,
  expectedLeadingZeros: number,
  maxAttempts = 100,
  memoryMb = POW_PROFILE_MEMORY_MB,
): MiningResult3072 {
  const target = validateIntegerInRange(block.targetBits, 'block.targetBits', 1, 256);
  validateIntegerInRange(expectedLeadingZeros, 'expectedLeadingZeros', 1, 256);
  if (expectedLeadingZeros !== target) throw new Error('expectedLeadingZeros must match block.targetBits');
  if (memoryMb !== POW_PROFILE_MEMORY_MB) throw new Error(`memoryMb must equal the fixed profile value ${POW_PROFILE_MEMORY_MB}`);
  const attemptLimit = validateIntegerInRange(maxAttempts, 'maxAttempts', 1, 1_000_000);
  const candidate = decodeBlock384(encodeBlock384(block));
  let nonceCounter = candidate.nonce;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= attemptLimit; attempt++) {
    candidate.nonce = nonceCounter;
    attemptsMade = attempt;
    const blockBytes = encodeBlock384(candidate);
    const seed = blockToSeed3072(blockBytes);

    const scratchpad = generateMemoryScratchpad(seed, memoryMb);
    mixScratchpadMemoryHard(scratchpad, POW_PROFILE_MIX_PASSES);
    const hash = compressScratchpadToHash(scratchpad);
    const lz = countHashLeadingZeros(hash);

    let hashHex = '';
    for (let i = 0; i < 8; i++) {
      hashHex += hash[i]!.toString(16).padStart(8, '0');
    }

    if (lz >= target) {
      return {
        found: true,
        attempts: attempt,
        seed,
        minedBlock: candidate,
        hashHex,
        leadingZeros: lz,
      };
    }

    if (nonceCounter === UINT64_MAX) break;
    nonceCounter++;
  }

  return {
    found: false,
    attempts: attemptsMade,
    seed: null,
    minedBlock: null,
    hashHex: '',
    leadingZeros: 0,
  };
}

/**
 * Recomputes the fixed-profile proof of work and rejects a header whose target
 * differs from the independently derived expected target.
 */
export function verifyBlockMining3072(
  block: BlockContainer384,
  expectedLeadingZeros: number,
  memoryMb = POW_PROFILE_MEMORY_MB,
): { valid: boolean; leadingZeros: number; hashHex: string } {
  const target = validateIntegerInRange(block.targetBits, 'block.targetBits', 1, 256);
  validateIntegerInRange(expectedLeadingZeros, 'expectedLeadingZeros', 1, 256);
  if (expectedLeadingZeros !== target) throw new Error('expectedLeadingZeros must match block.targetBits');
  if (memoryMb !== POW_PROFILE_MEMORY_MB) throw new Error(`memoryMb must equal the fixed profile value ${POW_PROFILE_MEMORY_MB}`);
  const blockBytes = encodeBlock384(block);
  const seed = blockToSeed3072(blockBytes);

  const scratchpad = generateMemoryScratchpad(seed, memoryMb);
  mixScratchpadMemoryHard(scratchpad, POW_PROFILE_MIX_PASSES);
  const hash = compressScratchpadToHash(scratchpad);
  const lz = countHashLeadingZeros(hash);

  let hashHex = '';
  for (let i = 0; i < 8; i++) {
    hashHex += hash[i]!.toString(16).padStart(8, '0');
  }

  return {
    valid: lz >= target,
    leadingZeros: lz,
    hashHex,
  };
}
