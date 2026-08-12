/**
 * Peer-to-Peer WebRTC Address Mesh Relay Core.
 *
 * Enables direct browser-to-browser P2P streaming of 47.5 MiB address slices
 * and .uia binary containers over WebRTC RTCDataChannels, bypassing server
 * hosting bandwidth for high-resolution grid sharing.
 */

export interface MeshChunkMessage {
  type: 'request-chunk' | 'chunk-data' | 'ping' | 'pong';
  chunkId: string;
  from: number;
  count: number;
  data?: ArrayBuffer;
}

export interface P2PMeshNode {
  readonly nodeId: string;
  readonly peerCount: number;
  connectPeer(signalingOffer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit>;
  requestSlice(from: number, count: number): Promise<Uint8Array | null>;
  broadcastSlice(chunkId: string, from: number, bytes: Uint8Array): void;
  close(): void;
}

export function createP2PMeshNode(nodeId?: string): P2PMeshNode {
  const id = nodeId ?? `node-${Math.random().toString(36).slice(2, 10)}`;
  const peers = new Map<string, RTCPeerConnection>();
  const channels = new Map<string, RTCDataChannel>();
  const pendingRequests = new Map<string, (data: Uint8Array | null) => void>();

  return {
    get nodeId() {
      return id;
    },
    get peerCount() {
      return peers.size;
    },
    async connectPeer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
      if (typeof RTCPeerConnection === 'undefined') {
        throw new Error('WebRTC is not supported in this environment');
      }

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      const peerId = `peer-${peers.size + 1}`;
      peers.set(peerId, pc);

      pc.ondatachannel = (event) => {
        const dc = event.channel;
        channels.set(peerId, dc);

        dc.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
          if (typeof e.data === 'string') {
            try {
              const msg = JSON.parse(e.data) as MeshChunkMessage;
              if (msg.type === 'ping') {
                dc.send(JSON.stringify({ type: 'pong', chunkId: msg.chunkId }));
              }
            } catch {}
          } else if (e.data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(e.data);
            const req = pendingRequests.get(peerId);
            if (req) {
              req(bytes);
              pendingRequests.delete(peerId);
            }
          }
        };
      };

      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      return answer;
    },
    async requestSlice(from: number, count: number): Promise<Uint8Array | null> {
      if (channels.size === 0) return null;

      const [firstPeerId, channel] = Array.from(channels.entries())[0]!;
      if (channel.readyState !== 'open') return null;

      return new Promise<Uint8Array | null>((resolve) => {
        const timeout = setTimeout(() => {
          pendingRequests.delete(firstPeerId);
          resolve(null);
        }, 3000);

        pendingRequests.set(firstPeerId, (data) => {
          clearTimeout(timeout);
          resolve(data);
        });

        channel.send(
          JSON.stringify({
            type: 'request-chunk',
            chunkId: `${from}-${count}`,
            from,
            count,
          }),
        );
      });
    },
    broadcastSlice(_chunkId: string, _from: number, bytes: Uint8Array): void {
      for (const channel of channels.values()) {
        if (channel.readyState === 'open') {
          try {
            channel.send(bytes.buffer as unknown as ArrayBuffer);
          } catch {}
        }
      }
    },
    close() {
      for (const channel of channels.values()) channel.close();
      for (const pc of peers.values()) pc.close();
      channels.clear();
      peers.clear();
      pendingRequests.clear();
    },
  };
}
