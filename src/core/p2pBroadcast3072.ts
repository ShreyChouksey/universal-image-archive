/**
 * Transport-agnostic block and transaction gossip core.
 *
 * Peers are callback adapters; this class does not implement WebRTC, consensus
 * validation, a mempool, source authentication, or transport backpressure.
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
  private peers = new Map<string, (data: Uint8Array) => void | Promise<void>>();
  private seenMessages = new Map<string, true>();
  private maxSeenCache = 1000;

  private blockHandlers: ((block: BlockContainer384) => void | Promise<void>)[] = [];
  private txHandlers: ((tx: Tx384) => void | Promise<void>)[] = [];

  constructor(nodeId?: string) {
    this.nodeId = nodeId ?? `node-${Math.random().toString(36).substring(2, 10)}`;
  }

  /**
   * Registers a peer connection callback for data transmission.
   */
  public addPeer(peerId: string, sendFn: (data: Uint8Array) => void | Promise<void>): void {
    this.peers.set(peerId, sendFn);
  }

  public removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  public getPeerCount(): number {
    return this.peers.size;
  }

  /**
   * Subscribes to structurally decoded blocks. Consensus validation is the
   * subscriber's responsibility.
   */
  public onBlock(handler: (block: BlockContainer384) => void | Promise<void>): void {
    this.blockHandlers.push(handler);
  }

  /**
   * Subscribes to structurally decoded transactions. Authorization and mempool
   * policy are the subscriber's responsibility.
   */
  public onTx(handler: (tx: Tx384) => void | Promise<void>): void {
    this.txHandlers.push(handler);
  }

  /**
   * Broadcasts a 384-byte block across all connected mesh peers.
   */
  public broadcastBlock(block: BlockContainer384): void {
    const blockBytes = encodeBlock384(block);
    const msg = this.packMessage(0x01, blockBytes);
    const msgKey = this.computeMsgKey(msg);

    if (this.markSeen(msgKey)) return;

    let delivered = false;
    for (const sendFn of this.peers.values()) {
      delivered = this.sendToPeer(sendFn, msg) || delivered;
    }
    if (!delivered) this.seenMessages.delete(msgKey);
  }

  /**
   * Broadcasts a 144-byte transaction across all connected mesh peers.
   */
  public broadcastTx(tx: Tx384): void {
    const txBytes = encodeTx384(tx);
    const msg = this.packMessage(0x02, txBytes);
    const msgKey = this.computeMsgKey(msg);

    if (this.markSeen(msgKey)) return;

    let delivered = false;
    for (const sendFn of this.peers.values()) {
      delivered = this.sendToPeer(sendFn, msg) || delivered;
    }
    if (!delivered) this.seenMessages.delete(msgKey);
  }

  /**
   * Ingests an incoming raw P2P message from a mesh peer.
   */
  public receiveMessage(rawBytes: Uint8Array, senderPeerId?: string): { handled: boolean; type?: MessageType; error?: string } {
    if (rawBytes.length < 5) return { handled: false, error: 'Message header too short' };

    const type = rawBytes[0] as MessageType;
    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    const payloadLen = view.getUint32(1, false);

    if (rawBytes.length !== 5 + payloadLen) {
      return { handled: false, error: `Invalid frame length: expected ${5 + payloadLen} bytes, got ${rawBytes.length}` };
    }

    const payload = rawBytes.slice(5, 5 + payloadLen);
    let block: BlockContainer384 | null = null;
    let tx: Tx384 | null = null;

    if (type === 0x01) {
      try {
        block = decodeBlock384(payload);
      } catch (err) {
        return { handled: false, error: `Invalid block payload: ${String(err)}` };
      }
    } else if (type === 0x02) {
      try {
        tx = decodeTx384(payload);
      } catch (err) {
        return { handled: false, error: `Invalid transaction payload: ${String(err)}` };
      }
    } else {
      return { handled: false, error: `Unknown message type ${type}` };
    }

    // Cache only structurally valid frames. The exact-byte key avoids introducing
    // collision semantics into the bounded in-memory deduplication cache.
    const msgKey = this.computeMsgKey(rawBytes);
    if (this.markSeen(msgKey)) return { handled: false, error: 'Duplicate message ignored' };

    if (block) {
      for (const handler of this.blockHandlers) {
        try {
          const result = handler(decodeBlock384(payload));
          if (result && typeof result.then === 'function') void result.catch(() => { /* isolate async handlers */ });
        } catch { /* isolate synchronous handlers */ }
      }
    } else if (tx) {
      for (const handler of this.txHandlers) {
        try {
          const result = handler(decodeTx384(payload));
          if (result && typeof result.then === 'function') void result.catch(() => { /* isolate async handlers */ });
        } catch { /* isolate synchronous handlers */ }
      }
    }

    // Forward structurally valid messages to every peer except the asserted
    // source. A transport adapter must bind senderPeerId to its connection.
    for (const [peerId, sendFn] of this.peers.entries()) {
      if (peerId !== senderPeerId) {
        this.sendToPeer(sendFn, rawBytes);
      }
    }

    return { handled: true, type };
  }

  private packMessage(type: MessageType, payload: Uint8Array): Uint8Array {
    const out = new Uint8Array(5 + payload.length);
    out[0] = type;

    const view = new DataView(out.buffer);
    view.setUint32(1, payload.length, false);
    out.set(payload, 5);
    return out;
  }

  private computeMsgKey(msg: Uint8Array): string {
    let key = '';
    for (let i = 0; i < msg.length; i++) {
      key += msg[i]!.toString(16).padStart(2, '0');
    }
    return key;
  }

  private markSeen(key: string): boolean {
    if (this.seenMessages.has(key)) {
      this.seenMessages.delete(key);
      this.seenMessages.set(key, true);
      return true;
    }

    this.seenMessages.set(key, true);
    if (this.seenMessages.size > this.maxSeenCache) {
      const first = this.seenMessages.keys().next().value;
      if (first !== undefined) this.seenMessages.delete(first);
    }
    return false;
  }

  private sendToPeer(
    sendFn: (data: Uint8Array) => void | Promise<void>,
    message: Uint8Array,
  ): boolean {
    try {
      const result = sendFn(message.slice());
      if (result && typeof result.then === 'function') {
        void result.catch(() => { /* transport adapters own retry policy */ });
      }
      return true;
    } catch {
      return false;
    }
  }
}
