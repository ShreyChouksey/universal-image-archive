/**
 * Experimental Provenance Plate Helper (v0 Demo).
 *
 * Provides basic statement commitment hashing and local claim structuring.
 * This prototype helper does not provide zero-knowledge proofs or cryptographic
 * non-malleability; see docs/protocol/charter-000.md for the protocol roadmap.
 */

import type { ArchiveFormat } from './format';
import type { Seed } from './philox';
import { seedToHex } from './philox';
import { normaliseStatement } from './plate';
import { DECIMAL_MODULUS } from './address';

export interface ZkPlateClaim {
  readonly version: 'zk-v1';
  readonly layoutId: string;
  readonly statement: string;
  readonly commitmentHash: string;
  readonly proofTimestamp: number;
  readonly proof: {
    readonly r0: string;
    readonly r1: string;
    readonly modulus: number;
    readonly verified: boolean;
  };
}

/**
 * Bespoke 128-bit non-cryptographic rolling checksum over seed and statement.
 * Not SHA-256, not 256-bit, not collision-resistant, and not a commitment.
 */
function computeCommitmentHash(seedHex: string, statement: string): string {
  const input = `ZKP:${seedHex}:${statement}:MOD10E15`;
  let h0 = 0x811c9dc5 >>> 0;
  let h1 = 0x01000193 >>> 0;
  let h2 = 0x9e3779b9 >>> 0;
  let h3 = 0x85ebca6b >>> 0;

  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);

  for (let i = 0; i < bytes.length; i++) {
    h0 = Math.imul(h0 ^ bytes[i], 0x01000193) >>> 0;
    h1 = Math.imul(h1 ^ bytes[i], 0x85ebca6b) >>> 0;
    h2 = Math.imul(h2 ^ bytes[i], 0xc2b2ae35) >>> 0;
    h3 = Math.imul(h3 ^ bytes[i], 0x27d4eb2d) >>> 0;
  }

  const hex = (v: number) => v.toString(16).padStart(8, '0');
  return `${hex(h0)}${hex(h1)}${hex(h2)}${hex(h3)}`;
}

/**
 * Builds a local provenance claim record. Not a proof and not zero-knowledge.
 */
export function mintZkPlateClaim(
  _format: ArchiveFormat,
  seed: Seed,
  statementRaw: string,
  layoutId = 'I',
): ZkPlateClaim {
  const statement = normaliseStatement(statementRaw);
  const seedHex = seedToHex(seed);
  const commitmentHash = computeCommitmentHash(seedHex, statement);

  // WARNING: r0/r1 publish seed[0]^seed[2] and seed[1]^seed[3] after XOR with
  // numTarget, which is recoverable from claim.statement. This is not Schnorr
  // and not zero-knowledge.
  const numTarget = Number(BigInt(statement) % BigInt(DECIMAL_MODULUS));
  const r0 = ((seed[0] ^ seed[2] ^ numTarget) >>> 0).toString(16).padStart(8, '0');
  const r1 = ((seed[1] ^ seed[3] ^ numTarget) >>> 0).toString(16).padStart(8, '0');

  return {
    version: 'zk-v1',
    layoutId,
    statement,
    commitmentHash,
    proofTimestamp: Date.now(),
    proof: {
      r0,
      r1,
      modulus: DECIMAL_MODULUS,
      // Legacy demo flag only. verifyZkPlateClaim does not trust this field.
      verified: true,
    },
  };
}

/**
 * Checks record shape and recomputes the bespoke checksum when a seed is
 * supplied. It does not validate r0/r1 or prove provenance.
 */
export function verifyZkPlateClaim(claim: ZkPlateClaim, seed?: Seed): boolean {
  if (claim.version !== 'zk-v1') return false;
  if (!claim.statement || claim.statement.length !== 15) return false;
  if (!claim.commitmentHash || claim.commitmentHash.length !== 32) return false;
  if (claim.proof.modulus !== DECIMAL_MODULUS) return false;
  if (!claim.proof.r0 || !claim.proof.r1) return false;

  if (!seed) {
    // The checksum cannot be recomputed without the seed. No public proof exists,
    // so fail closed instead of trusting the legacy claim.proof.verified flag.
    return false;
  }

  const seedHex = seedToHex(seed);
  const expected = computeCommitmentHash(seedHex, claim.statement);
  return claim.commitmentHash === expected;
}
