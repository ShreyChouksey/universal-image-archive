/**
 * Sparsity, Difficulty Scarcity & 21M Monetary Hardcap Engine.
 *
 * Implements the 21,000,000 coin hardcap supply schedule, halving math, dynamic
 * difficulty retargeting, and 3,072-bit seed cryptographic sparsity evaluation.
 */

import type { Seed3072 } from './seed3072';
import { philox96x32 } from './philox96';

export const COIN_BASE_UNITS = 100_000_000n; // 1 Coin = 10^8 base units (satoshis)
export const INITIAL_SUBSIDY = 50n * COIN_BASE_UNITS; // 50 coins per block
export const HALVING_INTERVAL = 210_000; // Halves every 210,000 blocks
export const MAX_SUPPLY = 21_000_000n * COIN_BASE_UNITS; // 21,000,000 coins hardcap

/**
 * Calculates the exact block mining subsidy for a given block height.
 * Halves every 210,000 blocks. Reaches 0 at halving #33 (Block 6,930,000).
 */
export function getBlockSubsidy(blockHeight: number): bigint {
  if (blockHeight < 0) return 0n;
  const halvings = Math.floor(blockHeight / HALVING_INTERVAL);
  if (halvings >= 64) return 0n;
  const subsidy = INITIAL_SUBSIDY >> BigInt(halvings);
  return subsidy < 0n ? 0n : subsidy;
}

/**
 * Calculates the total cumulative coin supply issued up to a given block height.
 * Mathematically bounded by 21,000,000.00000000 coins.
 */
export function getTotalSupplyAtHeight(blockHeight: number): bigint {
  if (blockHeight < 0) return 0n;
  let total = 0n;
  const halvings = Math.floor(blockHeight / HALVING_INTERVAL);

  // Full halving eras
  let eraSubsidy = INITIAL_SUBSIDY;
  for (let i = 0; i < halvings && eraSubsidy > 0n; i++) {
    total += eraSubsidy * BigInt(HALVING_INTERVAL);
    eraSubsidy >>= 1n;
  }

  // Current partial era
  const remainingBlocks = (blockHeight % HALVING_INTERVAL) + 1;
  total += eraSubsidy * BigInt(remainingBlocks);

  return total > MAX_SUPPLY ? MAX_SUPPLY : total;
}

/** FNV-1a / SHA-256 style 256-bit hash for block sparsity checking */
export function computeBlockSparsityHash(pixels: Uint32Array): Uint32Array {
  const hash = new Uint32Array(8);
  let h0 = 0x6a09e667 >>> 0;
  let h1 = 0xbb67ae85 >>> 0;
  let h2 = 0x3c6ef372 >>> 0;
  let h3 = 0xa54ff53a >>> 0;

  for (let i = 0; i < pixels.length; i++) {
    const val = pixels[i]!;
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
 * Evaluates whether a 3,072-bit seed produces an 8x8 grid pixel payload
 * that satisfies the required leading zero bit difficulty target.
 */
export function evaluateBlockSparsity(
  seed: Seed3072,
  requiredLeadingZeros = 16,
  rounds = 32,
): { valid: boolean; leadingZeros: number; hashHex: string } {
  const pixels = new Uint32Array(96);
  philox96x32(pixels, 0, 0, seed, rounds);

  const hash = computeBlockSparsityHash(pixels);
  let count = 0;
  for (let i = 0; i < 8; i++) {
    const word = hash[i]!;
    const lz = Math.clz32(word);
    count += lz;
    if (lz < 32) break;
  }

  let hashHex = '';
  for (let i = 0; i < 8; i++) {
    hashHex += hash[i]!.toString(16).padStart(8, '0');
  }

  return {
    valid: count >= requiredLeadingZeros,
    leadingZeros: count,
    hashHex,
  };
}

/**
 * Retargets difficulty based on actual time taken vs target time (Nakamoto rule).
 */
export function calculateNextDifficulty(
  currentLeadingZeros: number,
  actualTimeMs: number,
  targetTimeMs: number,
): number {
  if (actualTimeMs <= 0 || targetTimeMs <= 0) return currentLeadingZeros;
  const ratio = actualTimeMs / targetTimeMs;

  if (ratio < 0.25) {
    return Math.min(256, currentLeadingZeros + 2);
  } else if (ratio < 0.75) {
    return Math.min(256, currentLeadingZeros + 1);
  } else if (ratio > 4.0) {
    return Math.max(1, currentLeadingZeros - 2);
  } else if (ratio > 1.5) {
    return Math.max(1, currentLeadingZeros - 1);
  }
  return currentLeadingZeros;
}
