/**
 * Experimental secret-derived transcript helpers.
 *
 * This module does not implement a STARK, a zero-knowledge proof, or a public
 * signature scheme. The historical API names are retained for compatibility,
 * but public verification deliberately fails closed. Use a reviewed signature
 * or proof system for transaction authorization.
 */

import type { Seed3072 } from './seed3072';
import type { Tx384 } from './ledger3072';
import { derivePublicKeyHash, encodeTx384 } from './ledger3072';
import { philox96x32 } from './philox96';

export interface ZKProof3072 {
  traceCommitment: Uint8Array; // 32-byte experimental transcript field
  friQueryCommitment: Uint8Array; // 32-byte experimental transcript field
  evalProof: Uint8Array; // 64-byte experimental transcript field
}

export const ZKPROOF3072_BYTE_SIZE = 128; // 32 + 32 + 64 = 128 bytes

/**
 * Generates a deterministic secret-derived transcript for research and test
 * vectors. This is not a publicly verifiable proof.
 */
export function generateSTARKProof3072(privateSeed: Seed3072, tx: Tx384): ZKProof3072 {
  const pubKeyHash = derivePublicKeyHash(privateSeed);

  if (tx.senderAddress.length !== 32 || !bytesEqual(pubKeyHash, tx.senderAddress)) {
    throw new Error('Transaction senderAddress does not match the private seed');
  }

  // Bind every unsigned transaction field. zkProofHash is excluded to avoid a
  // circular commitment because it is derived from the resulting transcript.
  const boundTx = encodeTx384({ ...tx, zkProofHash: new Uint8Array(32) });
  const traceScratch = new Uint32Array(96);
  let payloadHashLow = 0x5a4b5354;
  let payloadHashHigh = 0x54584e33;
  for (let i = 0; i < boundTx.length; i++) {
    const byte = boundTx[i]!;
    payloadHashLow = Math.imul(payloadHashLow ^ byte, 0x01000193) >>> 0;
    payloadHashHigh = Math.imul(payloadHashHigh ^ byte ^ i, 0x85ebca6b) >>> 0;
  }

  philox96x32(traceScratch, payloadHashLow, payloadHashHigh, privateSeed, 32);

  const traceCommitment = new Uint8Array(32);
  const traceView = new DataView(traceCommitment.buffer);
  for (let i = 0; i < 8; i++) {
    traceView.setUint32(i * 4, traceScratch[i]!, false);
  }

  // Derive two additional transcript fields from the private seed.
  const friScratch = new Uint32Array(96);
  philox96x32(friScratch, traceScratch[0]!, traceScratch[1]!, privateSeed, 16);

  const friQueryCommitment = new Uint8Array(32);
  const friView = new DataView(friQueryCommitment.buffer);
  for (let i = 0; i < 8; i++) {
    friView.setUint32(i * 4, friScratch[i]!, false);
  }

  const respKey = new Uint8Array(32);
  const respScratch = new Uint32Array(96);
  philox96x32(respScratch, traceScratch[2]!, friScratch[2]!, privateSeed, 24);
  const respView = new DataView(respKey.buffer);
  for (let i = 0; i < 8; i++) {
    respView.setUint32(i * 4, respScratch[i]!, false);
  }

  const evalProof = new Uint8Array(64);
  evalProof.set(pubKeyHash, 0);
  for (let i = 0; i < 32; i++) {
    evalProof[32 + i] = traceCommitment[i]! ^ friQueryCommitment[i]! ^ respKey[i]! ^ tx.nullifier[i]!;
  }

  return {
    traceCommitment,
    friQueryCommitment,
    evalProof,
  };
}

/**
 * Historical public-verifier entry point. It always fails closed because this
 * bespoke transcript has no sound public verification relation.
 *
 * @deprecated Replace this with a reviewed signature/proof verifier.
 */
export function verifySTARKProof3072(
  _proof: ZKProof3072,
  _senderAddress: Uint8Array,
  _nullifier: Uint8Array,
): boolean {
  return false;
}

/**
 * Checks an experimental transcript by regenerating it with the private seed.
 * This is useful for deterministic test vectors only; it is not public
 * verification and must not be used to authorize network transactions.
 */
export function verifyPrivateTranscript3072(
  proof: ZKProof3072,
  privateSeed: Seed3072,
  tx: Tx384,
): boolean {
  if (proof.traceCommitment.length !== 32 || proof.friQueryCommitment.length !== 32 || proof.evalProof.length !== 64) {
    return false;
  }

  try {
    const expected = generateSTARKProof3072(privateSeed, tx);
    return bytesEqual(proof.traceCommitment, expected.traceCommitment)
      && bytesEqual(proof.friQueryCommitment, expected.friQueryCommitment)
      && bytesEqual(proof.evalProof, expected.evalProof);
  } catch {
    return false;
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i]! ^ right[i]!;
  return difference === 0;
}

/**
 * Derives a deterministic 32-byte transcript fingerprint. This bespoke rolling
 * hash is not a cryptographic proof commitment.
 */
export function proofToHash32(proof: ZKProof3072): Uint8Array {
  if (proof.traceCommitment.length !== 32 || proof.friQueryCommitment.length !== 32 || proof.evalProof.length !== 64) {
    throw new Error('Experimental transcript fields must have lengths 32, 32, and 64 bytes');
  }
  const hash = new Uint8Array(32);
  let h0 = 0x6a09e667 >>> 0;
  let h1 = 0xbb67ae85 >>> 0;
  let h2 = 0x3c6ef372 >>> 0;
  let h3 = 0xa54ff53a >>> 0;
  let h4 = 0x510e527f >>> 0;
  let h5 = 0x9b05688c >>> 0;
  let h6 = 0x1f83d9ab >>> 0;
  let h7 = 0x5be0cd19 >>> 0;

  for (let i = 0; i < 32; i++) {
    const t = proof.traceCommitment[i]!;
    const f = proof.friQueryCommitment[i]!;
    const e0 = proof.evalProof[i]!;
    const e1 = proof.evalProof[32 + i]!;

    h0 = Math.imul(h0 ^ t, 0x01000193) >>> 0;
    h1 = Math.imul(h1 ^ f, 0x85ebca6b) >>> 0;
    h2 = Math.imul(h2 ^ e0, 0xc2b2ae35) >>> 0;
    h3 = Math.imul(h3 ^ e1, 0x27d4eb2d) >>> 0;
    h4 = Math.imul(h4 ^ (t ^ e0), 0x165667b1) >>> 0;
    h5 = Math.imul(h5 ^ (f ^ e1), 0x9e3779b9) >>> 0;
    h6 = Math.imul(h6 ^ (t ^ f), 0xd2511f53) >>> 0;
    h7 = Math.imul(h7 ^ (e0 ^ e1), 0xcd9e8d57) >>> 0;
  }

  const view = new DataView(hash.buffer);
  view.setUint32(0, h0, false);
  view.setUint32(4, h1, false);
  view.setUint32(8, h2, false);
  view.setUint32(12, h3, false);
  view.setUint32(16, h4, false);
  view.setUint32(20, h5, false);
  view.setUint32(24, h6, false);
  view.setUint32(28, h7, false);
  return hash;
}
