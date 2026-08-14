/**
 * Experimental 96-word scratchpad-folding evaluator.
 *
 * Folding MiB of scratchpad state into 384 bytes is necessarily compression.
 * This construction has not been cryptanalysed and makes no entropy-preservation
 * or ASIC-resistance guarantee.
 */

import type { Seed3072 } from './seed3072';
import type { BlockContainer384 } from './block384';
import { encodeBlock384, decodeBlock384, blockToSeed3072, UINT64_MAX } from './block384';
import { POW_PROFILE_MEMORY_MB, generateMemoryScratchpad, mixScratchpadMemoryHard } from './mining3072';

function validateTarget(value: number, minimum = 0): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum || value > 3072) {
    throw new Error(`requiredLeadingZeros must be an integer between ${minimum} and 3072`);
  }
  return value;
}

/**
 * Folds a non-empty scratchpad into a 96-word evaluation vector.
 */
export function compressScratchpadToVector3072(scratchpad: Uint32Array): Uint32Array {
  const vector = new Uint32Array(96);
  const len = scratchpad.length;
  if (len === 0) throw new Error('scratchpad must not be empty');

  for (let i = 0; i < len; i++) {
    const wordIdx = i % 96;
    const val = scratchpad[i]!;

    // ARX non-linear mixing into 96-word vector
    let h = vector[wordIdx]!;
    h = (h ^ val) >>> 0;
    h = Math.imul(h, 0x9e3779b9) >>> 0;
    h = (h << 13) | (h >>> 19);
    vector[wordIdx] = h >>> 0;
  }

  return vector;
}

/**
 * Counts leading zero bits continuously across all 96 words (0 to 3,072 bits).
 */
export function countVectorLeadingZeros3072(vector: Uint32Array): number {
  if (vector.length !== 96) throw new Error('Vector must contain exactly 96 Uint32 words');

  let totalZeros = 0;
  for (let i = 0; i < 96; i++) {
    const word = vector[i]!;
    const lz = Math.clz32(word);
    totalZeros += lz;
    if (lz < 32) break; // First non-zero word encountered
  }
  return totalZeros;
}

export interface SparsityEvaluation3072 {
  valid: boolean;
  leadingZeros: number;
  requiredLeadingZeros: number;
  vector: Uint32Array;
  vectorHex: string;
}

/**
 * Evaluates a seed against the folded-vector prefix target.
 */
export function evaluateFullSparsity3072(
  seed: Seed3072,
  requiredLeadingZeros: number,
  memoryMb = 1,
): SparsityEvaluation3072 {
  const target = validateTarget(requiredLeadingZeros);
  const scratchpad = generateMemoryScratchpad(seed, memoryMb);
  mixScratchpadMemoryHard(scratchpad, 1);
  const vector = compressScratchpadToVector3072(scratchpad);
  const lz = countVectorLeadingZeros3072(vector);

  let vectorHex = '';
  for (let i = 0; i < 96; i++) {
    vectorHex += vector[i]!.toString(16).padStart(8, '0');
  }

  return {
    valid: lz >= target,
    leadingZeros: lz,
    requiredLeadingZeros: target,
    vector,
    vectorHex,
  };
}

export interface MiningResult3072Full {
  found: boolean;
  attempts: number;
  seed: Seed3072 | null;
  minedBlock: BlockContainer384 | null;
  vectorHex: string;
  leadingZeros: number;
}

/**
 * Research-only folded-vector search. This is a separate, incompatible
 * experiment—not a consensus alternative to mineBlock3072—and has no verifier.
 * The caller must independently supply the expected target.
 */
export function mineBlock3072Full(
  block: BlockContainer384,
  expectedLeadingZeros: number,
  maxAttempts = 500,
  memoryMb = POW_PROFILE_MEMORY_MB,
): MiningResult3072Full {
  const target = validateTarget(block.targetBits, 1);
  validateTarget(expectedLeadingZeros, 1);
  if (expectedLeadingZeros !== target) throw new Error('expectedLeadingZeros must match block.targetBits');
  if (memoryMb !== POW_PROFILE_MEMORY_MB) throw new Error(`memoryMb must equal the fixed profile value ${POW_PROFILE_MEMORY_MB}`);
  if (!Number.isFinite(maxAttempts) || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1_000_000) {
    throw new Error('maxAttempts must be an integer between 1 and 1000000');
  }
  const candidate = decodeBlock384(encodeBlock384(block));
  let nonceCounter = candidate.nonce;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    candidate.nonce = nonceCounter;
    attemptsMade = attempt;
    const blockBytes = encodeBlock384(candidate);
    const seed = blockToSeed3072(blockBytes);

    const evalResult = evaluateFullSparsity3072(seed, target, memoryMb);

    if (evalResult.valid) {
      return {
        found: true,
        attempts: attempt,
        seed,
        minedBlock: candidate,
        vectorHex: evalResult.vectorHex,
        leadingZeros: evalResult.leadingZeros,
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
    vectorHex: '',
    leadingZeros: 0,
  };
}
