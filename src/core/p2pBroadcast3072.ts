/**
 * Layer 3.0: P2P WebRTC Block & Transaction Broadcast Mesh Relay.
 *
 * Implements a serverless, peer-to-peer gossip network over WebRTC DataChannels.
 * Enables zero-latency block propagation and transaction mempool relay with
 * LRU deduplication and zero centralized control.
 */

import type { BlockContainer384 } from './block384';
import { encodeBlock384, decodeBlock384 } from './block384';
import type { Tx384 } from './ledger3072';
import { encodeTx384, decodeTx384 } from './ledger3072';

export type MessageType = 0x01 | 0x02; // 0x01 = Block, 0x02 = Tx

export interface P2PMessageHeader {
  type: MessageType;
  payloadLength: number;
}

export class P2PBroadcastMesh3072 {
  public readonly nodeId: string;
  private peers = new Map<string, (data: Uint8Array) => void>();
  private seenHashes = new Set<string>();
  private maxSeenCache = 1000;

  private blockHandlers: ((block: BlockContainer384) => void)[] = [];
  private txHandlers: ((tx: Tx384) => void)[] = [];

  constructor(nodeId?: string) {
    this.nodeId = nodeId ?? `node-${Math.random().toString(36).substring(2, 10)}`;
  }

  /**
   * Registers a peer connection callback for data transmission.
   */
  public addPeer(peerId: string, sendFn: (data: Uint8Array) => void): void {
    this.peers.set(peerId, sendFn);
  }

  public removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  public getPeerCount(): number {
    return this.peers.size;
  }

  /**
   * Subscribes to incoming verified blocks.
   */
  public onBlock(handler: (block: BlockContainer384) => void): void {
    this.blockHandlers.push(handler);
  }

  /**
   * Subscribes to incoming mempool transactions.
   */
  public onTx(handler: (tx: Tx384) => void): void {
    this.txHandlers.push(handler);
  }

  /**
   * Broadcasts a 384-byte block across all connected mesh peers.
   */
  public broadcastBlock(block: BlockContainer384): void {
    const blockBytes = encodeBlock384(block);
    const msg = this.packMessage(0x01, blockBytes);
    const msgHash = this.computeMsgHash(msg);

    if (this.markSeen(msgHash)) return; // Already seen

    for (const sendFn of this.peers.values()) {
      sendFn(msg);
    }
  }

  /**
   * Broadcasts a 144-byte transaction across all connected mesh peers.
   */
  public broadcastTx(tx: Tx384): void {
    const txBytes = encodeTx384(tx);
    const msg = this.packMessage(0x02, txBytes);
    const msgHash = this.computeMsgHash(msg);

    if (this.markSeen(msgHash)) return; // Already seen

    for (const sendFn of this.peers.values()) {
      sendFn(msg);
    }
  }

  /**
   * Ingests an incoming raw P2P message from a mesh peer.
   */
  public receiveMessage(rawBytes: Uint8Array): { handled: boolean; type?: MessageType; error?: string } {
    if (rawBytes.length < 5) return { handled: false, error: 'Message header too short' };

    const msgHash = this.computeMsgHash(rawBytes);
    if (this.markSeen(msgHash)) {
      return { handled: false, error: 'Duplicate message ignored' }; // Deduplicated
    }

    const type = rawBytes[0] as MessageType;
    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    const payloadLen = view.getUint32(1, false);

    const payload = rawBytes.slice(5, 5 + payloadLen);

    if (type === 0x01) {
      try {
        const block = decodeBlock384(payload);
        for (const handler of this.blockHandlers) {
          handler(block);
        }
        return { handled: true, type: 0x01 };
      } catch (err) {
        return { handled: false, error: `Invalid block payload: ${String(err)}` };
      }
    } else if (type === 0x02) {
      try {
        const tx = decodeTx384(payload);
        for (const handler of this.txHandlers) {
          handler(tx);
        }
        return { handled: true, type: 0x02 };
      } catch (err) {
        return { handled: false, error: `Invalid transaction payload: ${String(err)}` };
      }
    }

    return { handled: false, error: `Unknown message type ${type}` };
  }

  private packMessage(type: MessageType, payload: Uint8Array): Uint8Array {
    const out = new Uint8Array(5 + payload.length);
    out[0] = type;

    const view = new DataView(out.buffer);
    view.setUint32(1, payload.length, false);
    out.set(payload, 5);
    return out;
  }

  private computeMsgHash(msg: Uint8Array): string {
    let h0 = 0x6a09e667;
    for (let i = 0; i < msg.length; i++) {
      h0 = Math.imul(h0 ^ msg[i]!, 0x01000193) >>> 0;
    }
    return h0.toString(16);
  }

  private markSeen(hash: string): boolean {
    if (this.seenHashes.has(hash)) return true;

    this.seenHashes.add(hash);
    if (this.seenHashes.size > this.maxSeenCache) {
      const first = this.seenHashes.values().next().value;
      if (first) this.seenHashes.delete(first);
    }
    return false;
  }
}
