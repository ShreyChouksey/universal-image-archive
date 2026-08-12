/**
 * Layer 1.5: Memory-Bound ASIC-Resistant Mining Core.
 *
 * Implements a memory-hard scratchpad access algorithm over 3,072-bit seeds.
 * Forces true memory-bandwidth and latency consumption (4 MiB scratchpad),
 * preventing data-center ASIC centralization and keeping mining decentralized
 * across CPUs and WebGPU devices.
 */

import type { Seed3072 } from './seed3072';
import type { BlockContainer384 } from './block384';
import { encodeBlock384, blockToSeed3072 } from './block384';
import { philox96x32 } from './philox96';

export const DEFAULT_MEMORY_MB = 4; // 4 MiB scratchpad default

/**
 * Expands a 3,072-bit seed into a 4 MiB (1,048,576 Uint32 words) memory scratchpad.
 */
export function generateMemoryScratchpad(seed: Seed3072, memoryMb = DEFAULT_MEMORY_MB): Uint32Array {
  const wordCount = (memoryMb * 1024 * 1024) / 4;
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
 * Memory-hard pseudo-random access loop.
 * Forces sequential memory reads where each read location depends on the data stored at the previous read.
 * This effectively prevents ASICs from skipping memory bandwidth.
 */
export function mixScratchpadMemoryHard(scratchpad: Uint32Array, passes = 2): Uint32Array {
  const len = scratchpad.length;
  let ptr = 0;

  const iterations = len * passes;
  for (let i = 0; i < iterations; i++) {
    const prev = scratchpad[ptr]!;
    const targetIdx = (prev ^ i) % len;
    const readVal = scratchpad[targetIdx]!;

    const nextVal = (prev ^ readVal ^ 0x9e3779b9) >>> 0;
    scratchpad[ptr] = nextVal;
    ptr = (ptr + readVal + 1) % len;
  }

  return scratchpad;
}

/**
 * Collapses the 4 MiB memory scratchpad into a 256-bit block hash.
 */
export function compressScratchpadToHash(scratchpad: Uint32Array): Uint32Array {
  const hash = new Uint32Array(8);
  let h0 = 0x6a09e667 >>> 0;
  let h1 = 0xbb67ae85 >>> 0;
  let h2 = 0x3c6ef372 >>> 0;
  let h3 = 0xa54ff53a >>> 0;

  const len = scratchpad.length;
  const step = Math.max(1, Math.floor(len / 1024));

  for (let i = 0; i < len; i += step) {
    const val = scratchpad[i]!;
    h0 = Math.imul(h0 ^ val, 0x01000193) >>> 0;
    h1 = Math.imul(h1 ^ val, 0x85ebca6b) >>> 0;
    h2 = Math.imul(h2 ^ val, 0xc2b2ae35) >>> 0;
    h3 = Math.imul(h3 ^ val, 0x27d4eb2d) >>> 0;
  }

  hash[0] = h0;
  hash[1] = h1;
  hash[2] = h2;
  hash[3] = h3;
  hash[4] = h0 ^ h2;
  hash[5] = h1 ^ h3;
  hash[6] = h0 ^ h1;
  hash[7] = h2 ^ h3;

  return hash;
}

/**
 * Counts leading zero bits in a 256-bit hash.
 */
export function countHashLeadingZeros(hash: Uint32Array): number {
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
 * Memory-Bound ASIC-Resistant Miner Loop.
 * Searches nonces by expanding 3,072-bit seeds into memory scratchpads.
 */
export function mineBlock3072(
  block: BlockContainer384,
  requiredLeadingZeros = 12,
  maxAttempts = 100,
  memoryMb = 1, // Small default for fast unit tests/browsers
): MiningResult3072 {
  let nonceCounter = block.nonce;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    block.nonce = nonceCounter;
    const blockBytes = encodeBlock384(block);
    const seed = blockToSeed3072(blockBytes);

    const scratchpad = generateMemoryScratchpad(seed, memoryMb);
    mixScratchpadMemoryHard(scratchpad, 1);
    const hash = compressScratchpadToHash(scratchpad);
    const lz = countHashLeadingZeros(hash);

    let hashHex = '';
    for (let i = 0; i < 8; i++) {
      hashHex += hash[i]!.toString(16).padStart(8, '0');
    }

    if (lz >= requiredLeadingZeros) {
      return {
        found: true,
        attempts: attempt,
        seed,
        minedBlock: block,
        hashHex,
        leadingZeros: lz,
      };
    }

    nonceCounter++;
  }

  return {
    found: false,
    attempts: maxAttempts,
    seed: null,
    minedBlock: null,
    hashHex: '',
    leadingZeros: 0,
  };
}

/**
 * Instantly verifies whether a mined block satisfies the memory-bound ASIC-resistant difficulty target.
 */
export function verifyBlockMining3072(
  block: BlockContainer384,
  requiredLeadingZeros = 12,
  memoryMb = 1,
): { valid: boolean; leadingZeros: number; hashHex: string } {
  const blockBytes = encodeBlock384(block);
  const seed = blockToSeed3072(blockBytes);

  const scratchpad = generateMemoryScratchpad(seed, memoryMb);
  mixScratchpadMemoryHard(scratchpad, 1);
  const hash = compressScratchpadToHash(scratchpad);
  const lz = countHashLeadingZeros(hash);

  let hashHex = '';
  for (let i = 0; i < 8; i++) {
    hashHex += hash[i]!.toString(16).padStart(8, '0');
  }

  return {
    valid: lz >= requiredLeadingZeros,
    leadingZeros: lz,
    hashHex,
  };
}
