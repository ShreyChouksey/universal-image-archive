/**
 * Experimental account-ledger primitives for the 3,072-bit subsystem.
 *
 * The key derivation and root functions in this file are deterministic prototype
 * constructions, not audited post-quantum signatures, STARKs, or Merkle trees.
 * Transaction authorization is deliberately supplied by the caller and fails
 * closed when no authorizer is configured.
 */

import type { Seed3072 } from './seed3072';
import { randomSeed3072 } from './seed3072';
import type { BlockContainer384 } from './block384';
import { encodeBlock384, UINT64_MAX } from './block384';
import { getBlockSubsidy } from './sparsity';
import { philox96x32 } from './philox96';

export interface QuantumKeypair3072 {
  privateSeed: Seed3072;
  publicKeyHash: Uint8Array; // 32-byte hash commitment
  addressHex: string;
}

/**
 * Derives the legacy experimental key identifier from a random 3,072-bit seed.
 * This is not a signature keypair.
 */
export function generateQuantumKeypair3072(): QuantumKeypair3072 {
  const privateSeed = randomSeed3072();
  const publicKeyHash = derivePublicKeyHash(privateSeed);
  const addressHex = deriveAddressHex(publicKeyHash);

  return {
    privateSeed,
    publicKeyHash,
    addressHex,
  };
}

/**
 * Derives a deterministic 32-byte identifier from a 3,072-bit private seed.
 */
export function derivePublicKeyHash(privateSeed: Seed3072): Uint8Array {
  const scratch = new Uint32Array(96);
  philox96x32(scratch, 0x41444452, 0x4b455930, privateSeed, 32);

  const hash = new Uint8Array(32);
  const view = new DataView(hash.buffer);
  for (let i = 0; i < 8; i++) {
    view.setUint32(i * 4, scratch[i]!, false);
  }
  return hash;
}

/**
 * Formats a 32-byte public key hash as a readable address string.
 */
export function deriveAddressHex(publicKeyHash: Uint8Array): string {
  if (publicKeyHash.length !== 32) throw new Error('publicKeyHash must be 32 bytes');
  let hex = 'uia1';
  for (let i = 0; i < publicKeyHash.length; i++) {
    hex += publicKeyHash[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

export interface Tx384 {
  senderAddress: Uint8Array; // 32 bytes
  recipientAddress: Uint8Array; // 32 bytes
  amount: bigint; // uint64
  fee: bigint; // uint64
  nullifier: Uint8Array; // 32 bytes (spent UTXO tag)
  zkProofHash: Uint8Array; // 32-byte legacy authorization reference; not proof by itself
}

export const TX384_BYTE_SIZE = 144; // 32 + 32 + 8 + 8 + 32 + 32 = 144 bytes

const FINGERPRINT_SEEDS = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;
const FINGERPRINT_PRIMES = [
  0x01000193, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2d,
  0x165667b1, 0x9e3779b9, 0xd2511f53, 0xcd9e8d57,
] as const;

function deterministicFingerprint(chunks: readonly Uint8Array[]): Uint8Array {
  const lanes = Uint32Array.from(FINGERPRINT_SEEDS);
  let position = 0;

  for (const chunk of chunks) {
    const lengthBytes = new Uint8Array(4);
    new DataView(lengthBytes.buffer).setUint32(0, chunk.length, false);
    for (const bytes of [lengthBytes, chunk]) {
      for (const byte of bytes) {
        for (let lane = 0; lane < lanes.length; lane++) {
          lanes[lane] = Math.imul(lanes[lane]! ^ ((byte + position + lane * 17) & 0xff), FINGERPRINT_PRIMES[lane]!) >>> 0;
        }
        position++;
      }
    }
  }

  const output = new Uint8Array(32);
  const view = new DataView(output.buffer);
  for (let lane = 0; lane < lanes.length; lane++) view.setUint32(lane * 4, lanes[lane]!, false);
  return output;
}

function assertUint64(value: bigint, field: string): void {
  if (typeof value !== 'bigint' || value < 0n || value > UINT64_MAX) {
    throw new Error(`${field} must be an unsigned 64-bit integer`);
  }
}

function validateTx384(tx: Tx384): void {
  if (tx.senderAddress.length !== 32) throw new Error('senderAddress must be 32 bytes');
  if (tx.recipientAddress.length !== 32) throw new Error('recipientAddress must be 32 bytes');
  if (tx.nullifier.length !== 32) throw new Error('nullifier must be 32 bytes');
  if (tx.zkProofHash.length !== 32) throw new Error('zkProofHash must be 32 bytes');
  assertUint64(tx.amount, 'amount');
  assertUint64(tx.fee, 'fee');
}

/**
 * Encodes a Tx384 transaction into a 144-byte binary array.
 */
export function encodeTx384(tx: Tx384): Uint8Array {
  validateTx384(tx);

  const out = new Uint8Array(TX384_BYTE_SIZE);
  out.set(tx.senderAddress, 0);
  out.set(tx.recipientAddress, 32);

  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setBigUint64(64, tx.amount, false);
  view.setBigUint64(72, tx.fee, false);

  out.set(tx.nullifier, 80);
  out.set(tx.zkProofHash, 112);

  return out;
}

/**
 * Decodes a 144-byte binary array into a Tx384 transaction.
 */
export function decodeTx384(bytes: Uint8Array): Tx384 {
  if (bytes.length !== TX384_BYTE_SIZE) {
    throw new Error(`Transaction bytes must be exactly ${TX384_BYTE_SIZE} bytes, got ${bytes.length}`);
  }

  const senderAddress = bytes.slice(0, 32);
  const recipientAddress = bytes.slice(32, 64);

  const view = new DataView(bytes.buffer, bytes.byteOffset + 64, 16);
  const amount = view.getBigUint64(0, false);
  const fee = view.getBigUint64(8, false);

  const nullifier = bytes.slice(80, 112);
  const zkProofHash = bytes.slice(112, 144);

  return {
    senderAddress,
    recipientAddress,
    amount,
    fee,
    nullifier,
    zkProofHash,
  };
}

/**
 * Computes a deterministic 32-byte transaction fingerprint.
 *
 * Compatibility note: this is not a cryptographic hash or a Merkle root. The
 * name is retained until the block format is versioned.
 */
export function buildTxMerkleRoot(txs: Tx384[]): Uint8Array {
  if (txs.length === 0) return new Uint8Array(32);
  return deterministicFingerprint(txs.map(encodeTx384));
}

/**
 * Experimental state-transition engine.
 * Manages account balances and spent nullifiers. Consensus validation (chain
 * linkage, PoW, block-body decoding, and root commitments) belongs above this
 * class and is not implied by applyBlock().
 */
export type TransactionAuthorizer3072 = (tx: Readonly<Tx384>) => boolean;

export class ZKStateTree3072 {
  private balances = new Map<string, bigint>();
  private spentNullifiers = new Set<string>();
  private lastAppliedHeight = -1;
  private readonly authorizeTransaction: TransactionAuthorizer3072 | undefined;

  public constructor(authorizeTransaction?: TransactionAuthorizer3072) {
    this.authorizeTransaction = authorizeTransaction;
  }

  public getBalance(addressHex: string): bigint {
    return this.balances.get(addressHex) ?? 0n;
  }

  public isNullifierSpent(nullifierHex: string): boolean {
    return this.spentNullifiers.has(nullifierHex);
  }

  public getLastAppliedHeight(): number {
    return this.lastAppliedHeight;
  }

  /**
   * Computes a deterministic state fingerprint.
   * This compatibility function is not a cryptographic Merkle construction.
   */
  public getStateRoot(customBalances = this.balances, customNullifiers = this.spentNullifiers): Uint8Array {
    const chunks: Uint8Array[] = [];
    const encoder = new TextEncoder();
    const balanceEntries = [...customBalances.entries()].sort(([left], [right]) => left.localeCompare(right));
    for (const [address, balance] of balanceEntries) {
      if (balance < 0n || balance > UINT64_MAX) throw new Error('Ledger balance is outside the unsigned 64-bit range');
      chunks.push(Uint8Array.of(0x01), encoder.encode(address));
      const balanceBytes = new Uint8Array(8);
      new DataView(balanceBytes.buffer).setBigUint64(0, balance, false);
      chunks.push(balanceBytes);
    }
    for (const nullifier of [...customNullifiers].sort()) {
      chunks.push(Uint8Array.of(0x02), encoder.encode(nullifier));
    }
    return chunks.length === 0 ? new Uint8Array(32) : deterministicFingerprint(chunks);
  }

  /**
   * Applies a mined block and its transactions to the ledger state.
   */
  public applyBlock(
    block: BlockContainer384,
    txs: Tx384[],
    minerAddress: Uint8Array,
  ): { success: boolean; stateRoot: Uint8Array; error?: string } {
    try {
      encodeBlock384(block);
    } catch (error) {
      return { success: false, stateRoot: this.getStateRoot(), error: `Invalid block: ${error instanceof Error ? error.message : String(error)}` };
    }

    const expectedHeight = this.lastAppliedHeight + 1;
    if (block.blockHeight !== expectedHeight) {
      return { success: false, stateRoot: this.getStateRoot(), error: `Non-contiguous block height: expected ${expectedHeight}, got ${block.blockHeight}` };
    }

    let minerAddressHex: string;
    try {
      minerAddressHex = deriveAddressHex(minerAddress);
    } catch (error) {
      return { success: false, stateRoot: this.getStateRoot(), error: `Invalid miner address: ${error instanceof Error ? error.message : String(error)}` };
    }

    if (txs.length > 0 && !this.authorizeTransaction) {
      return { success: false, stateRoot: this.getStateRoot(), error: 'Transaction authorization is not configured' };
    }

    // 1. Calculate coinbase reward based on height
    const subsidy = getBlockSubsidy(block.blockHeight);

    // Staging maps for atomic execution
    const pendingBalances = new Map<string, bigint>(this.balances);
    const pendingNullifiers = new Set<string>(this.spentNullifiers);
    const canonicalTxs: Tx384[] = [];

    let totalFees = 0n;

    for (const inputTx of txs) {
      let tx: Tx384;
      try {
        tx = decodeTx384(encodeTx384(inputTx));
      } catch (error) {
        return { success: false, stateRoot: this.getStateRoot(), error: `Invalid transaction: ${error instanceof Error ? error.message : String(error)}` };
      }

      let authorized = false;
      try {
        // Give the authorizer its own copy so it cannot mutate the canonical
        // transaction that will be applied and fingerprinted.
        authorized = this.authorizeTransaction?.(decodeTx384(encodeTx384(tx))) === true;
      } catch {
        authorized = false;
      }
      if (!authorized) {
        return { success: false, stateRoot: this.getStateRoot(), error: 'Transaction authorization failed' };
      }

      const senderHex = deriveAddressHex(tx.senderAddress);
      const recipientHex = deriveAddressHex(tx.recipientAddress);
      const nullifierHex = Array.from(tx.nullifier).map(b => b.toString(16).padStart(2, '0')).join('');

      // Double-spend check
      if (pendingNullifiers.has(nullifierHex)) {
        return { success: false, stateRoot: this.getStateRoot(), error: `Double spend detected: nullifier ${nullifierHex} already spent` };
      }

      // Balance check
      const senderBal = pendingBalances.get(senderHex) ?? 0n;
      const totalDebit = tx.amount + tx.fee;
      if (senderBal < totalDebit) {
        return { success: false, stateRoot: this.getStateRoot(), error: `Insufficient balance for ${senderHex}: has ${senderBal}, needs ${totalDebit}` };
      }

      // Debit sender, credit recipient, track nullifier in staging
      pendingBalances.set(senderHex, senderBal - totalDebit);
      const recipientBal = pendingBalances.get(recipientHex) ?? 0n;
      const recipientNextBalance = recipientBal + tx.amount;
      if (recipientNextBalance > UINT64_MAX) {
        return { success: false, stateRoot: this.getStateRoot(), error: 'Recipient balance exceeds the unsigned 64-bit range' };
      }
      pendingBalances.set(recipientHex, recipientNextBalance);
      pendingNullifiers.add(nullifierHex);
      canonicalTxs.push(tx);

      totalFees += tx.fee;
    }

    // Credit miner coinbase subsidy + transaction fees in staging
    const minerCurrentBal = pendingBalances.get(minerAddressHex) ?? 0n;
    const minerNextBalance = minerCurrentBal + subsidy + totalFees;
    if (minerNextBalance > UINT64_MAX) {
      return { success: false, stateRoot: this.getStateRoot(), error: 'Miner balance exceeds the unsigned 64-bit range' };
    }
    pendingBalances.set(minerAddressHex, minerNextBalance);

    // Compute roots BEFORE atomic state assignment
    const stateRoot = this.getStateRoot(pendingBalances, pendingNullifiers);
    const txMerkleRoot = buildTxMerkleRoot(canonicalTxs);

    block.stateRoot.set(stateRoot);
    block.txMerkleRoot.set(txMerkleRoot);

    // Atomic commit
    this.balances = pendingBalances;
    this.spentNullifiers = pendingNullifiers;
    this.lastAppliedHeight = block.blockHeight;

    return { success: true, stateRoot };
  }
}
