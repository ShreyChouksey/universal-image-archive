/**
 * 384-Byte Block Container & Transaction Payload Core (Layer 1).
 *
 * Implements exact 384-byte (3,072-bit) block container serialization, unpacking,
 * and 1-to-1 conversion with Seed3072 vectors under the Satoshi 2026 specification.
 */

import type { Seed3072 } from './seed3072';

export const BLOCK384_BYTE_SIZE = 384;

export interface BlockContainer384 {
  prevBlockHash: Uint8Array; // 32 Bytes
  stateRoot: Uint8Array; // 32 Bytes (ZK-STARK State Root)
  txMerkleRoot: Uint8Array; // 32 Bytes (Transaction Merkle Root)
  timestamp: bigint; // 8 Bytes (64-bit uint Unix epoch ms)
  blockHeight: number; // 4 Bytes (32-bit uint sequence height)
  targetBits: number; // 4 Bytes (32-bit uint compact difficulty)
  nonce: bigint; // 8 Bytes (64-bit uint miner search nonce)
  txPayload: Uint8Array; // 257 Bytes (Compact transaction array)
  solvedTail: Uint8Array; // 7 Bytes (56-bit Mod 10^15 residue tail)
}

export function createEmptyBlock384(): BlockContainer384 {
  return {
    prevBlockHash: new Uint8Array(32),
    stateRoot: new Uint8Array(32),
    txMerkleRoot: new Uint8Array(32),
    timestamp: BigInt(Date.now()),
    blockHeight: 0,
    targetBits: 16,
    nonce: 0n,
    txPayload: new Uint8Array(257),
    solvedTail: new Uint8Array(7),
  };
}

/**
 * Encodes a BlockContainer384 into an exact 384-byte ArrayBuffer.
 */
export function encodeBlock384(block: BlockContainer384): Uint8Array {
  const out = new Uint8Array(BLOCK384_BYTE_SIZE);

  if (block.prevBlockHash.length !== 32) throw new Error('prevBlockHash must be 32 bytes');
  if (block.stateRoot.length !== 32) throw new Error('stateRoot must be 32 bytes');
  if (block.txMerkleRoot.length !== 32) throw new Error('txMerkleRoot must be 32 bytes');
  if (block.txPayload.length !== 257) throw new Error('txPayload must be 257 bytes');
  if (block.solvedTail.length !== 7) throw new Error('solvedTail must be 7 bytes');

  out.set(block.prevBlockHash, 0);
  out.set(block.stateRoot, 32);
  out.set(block.txMerkleRoot, 64);

  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setBigUint64(96, block.timestamp, false); // Big endian
  view.setUint32(104, block.blockHeight, false);
  view.setUint32(108, block.targetBits, false);
  view.setBigUint64(112, block.nonce, false);

  out.set(block.txPayload, 120);
  out.set(block.solvedTail, 377);

  return out;
}

/**
 * Decodes a 384-byte array into a structured BlockContainer384 object.
 */
export function decodeBlock384(bytes: Uint8Array): BlockContainer384 {
  if (bytes.length !== BLOCK384_BYTE_SIZE) {
    throw new Error(`Invalid block byte length: expected 384, got ${bytes.length}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return {
    prevBlockHash: bytes.slice(0, 32),
    stateRoot: bytes.slice(32, 64),
    txMerkleRoot: bytes.slice(64, 96),
    timestamp: view.getBigUint64(96, false),
    blockHeight: view.getUint32(104, false),
    targetBits: view.getUint32(108, false),
    nonce: view.getBigUint64(112, false),
    txPayload: bytes.slice(120, 377),
    solvedTail: bytes.slice(377, 384),
  };
}

/**
 * Converts a 384-byte packed block container directly into a Seed3072 (Uint32Array(96))
 * for 1-to-1 Philox96x32 rendering.
 */
export function blockToSeed3072(bytes: Uint8Array): Seed3072 {
  if (bytes.length !== BLOCK384_BYTE_SIZE) {
    throw new Error(`Invalid block byte length: expected 384, got ${bytes.length}`);
  }
  const seed = new Uint32Array(96);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 96; i++) {
    seed[i] = view.getUint32(i * 4, false); // Big endian word packing
  }
  return seed;
}

/**
 * Converts a Seed3072 (Uint32Array(96)) back into a 384-byte array.
 */
export function seed3072ToBlockBytes(seed: Seed3072): Uint8Array {
  if (seed.length !== 96) {
    throw new Error(`Invalid Seed3072 length: expected 96, got ${seed.length}`);
  }
  const bytes = new Uint8Array(BLOCK384_BYTE_SIZE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 96; i++) {
    view.setUint32(i * 4, seed[i]!, false);
  }
  return bytes;
}
