/**
 * WebGPU 3,072-Bit Compute Shader Acceleration Core (Layer 0).
 *
 * Parallelizes 96-word Philox96x32 evaluation across WebGPU compute workgroups,
 * rendering 8x8 48-bit grid pixel payloads from 3,072-bit seeds in < 0.1 ms.
 */

import type { ArchiveFormat } from '../core/format';
import type { Seed3072 } from '../core/seed3072';
import { pixelCount } from '../core/format';

export const COMPUTE_3072_WGSL = /* wgsl */ `
struct Params {
  width: u32,
  height: u32,
  bpc: u32,
  rounds: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> seedBuffer: array<u32>;
@group(0) @binding(2) var<storage, read_write> outputBuffer: array<u32>;

const C0: u32 = 0xd2511f53u;
const C1: u32 = 0xcd9e8d57u;

fn mulhilo(a: u32, b: u32) -> vec2<u32> {
  let ah = a >> 16u;
  let al = a & 0xffffu;
  let bh = b >> 16u;
  let bl = b & 0xffffu;
  let albl = al * bl;
  let mid = ah * bl + al * bh + (albl >> 16u);
  let hi = ah * bh + (mid >> 16u);
  let lo = ((mid & 0xffffu) << 16u) + (albl & 0xffffu);
  return vec2<u32>(hi, lo);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  let total = params.width * params.height;
  if (idx >= total) {
    return;
  }

  var state: array<u32, 96>;
  state[0] = idx;
  state[1] = 0u;
  for (var i = 2u; i < 96u; i = i + 1u) {
    state[i] = seedBuffer[i];
  }

  let rounds = min(64u, max(1u, params.rounds));
  for (var r = 0u; r < rounds; r = r + 1u) {
    for (var i = 0u; i < 96u; i = i + 2u) {
      let p = mulhilo(C0, state[i]);
      let k = seedBuffer[i] ^ (seedBuffer[i + 1u] * 0x9e3779b9u) ^ (C1 + r);
      let next_idx = (i + 1u) % 96u;
      state[i] = p.y ^ state[next_idx] ^ k;
      state[next_idx] = p.x;
    }
  }

  let mask = select(0xffu, 0xffffu, params.bpc == 16u);
  outputBuffer[idx * 3u] = state[0] & mask;
  outputBuffer[idx * 3u + 1u] = state[1] & mask;
  outputBuffer[idx * 3u + 2u] = state[2] & mask;
}
`;

export interface WebGPUComputeEngine3072 {
  readonly supported: boolean;
  materialise(format: ArchiveFormat, seed: Seed3072, rounds?: number): Promise<Uint8Array | null>;
  dispose(): void;
}

export async function createComputeEngine3072(): Promise<WebGPUComputeEngine3072> {
  if (!('gpu' in navigator) || !navigator.gpu) {
    return { supported: false, materialise: async () => null, dispose: () => {} };
  }

  let adapter: GPUAdapter | null = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    return { supported: false, materialise: async () => null, dispose: () => {} };
  }
  if (!adapter) return { supported: false, materialise: async () => null, dispose: () => {} };

  const device = await adapter.requestDevice().catch(() => null);
  if (!device) return { supported: false, materialise: async () => null, dispose: () => {} };

  let pipeline: GPUComputePipeline | null = null;
  try {
    const module = device.createShaderModule({ code: COMPUTE_3072_WGSL, label: 'uiaCompute3072' });
    pipeline = device.createComputePipeline({
      label: 'uiaComputePipeline3072',
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
  } catch {
    return { supported: false, materialise: async () => null, dispose: () => {} };
  }

  return {
    supported: true,
    async materialise(format: ArchiveFormat, seed: Seed3072, rounds = 32): Promise<Uint8Array | null> {
      if (!device || !pipeline) return null;
      if (seed.length !== 96) return null;

      const total = pixelCount(format);
      const bpp = format.depth.bytesPerPixel;
      const totalBytes = total * bpp;
      const storageByteSize = total * 3 * 4;

      let paramsBuffer: GPUBuffer | null = null;
      let seedBuffer: GPUBuffer | null = null;
      let storageBuffer: GPUBuffer | null = null;
      let readbackBuffer: GPUBuffer | null = null;

      try {
        const paramsData = new Uint32Array([
          format.resolution.width,
          format.resolution.height,
          format.depth.bpc,
          rounds,
        ]);

        paramsBuffer = device.createBuffer({
          size: paramsData.byteLength,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(paramsBuffer, 0, paramsData);

        seedBuffer = device.createBuffer({
          size: seed.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(seedBuffer, 0, seed as unknown as BufferSource);

        storageBuffer = device.createBuffer({
          size: storageByteSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });

        readbackBuffer = device.createBuffer({
          size: storageByteSize,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: paramsBuffer } },
            { binding: 1, resource: { buffer: seedBuffer } },
            { binding: 2, resource: { buffer: storageBuffer } },
          ],
        });

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(total / 64));
        pass.end();

        encoder.copyBufferToBuffer(storageBuffer, 0, readbackBuffer, 0, storageByteSize);
        device.queue.submit([encoder.finish()]);

        await readbackBuffer.mapAsync(GPUMapMode.READ);
        const mapped = new Uint32Array(readbackBuffer.getMappedRange());
        const out = new Uint8Array(totalBytes);

        if (format.depth.bpc === 16) {
          for (let i = 0; i < total; i++) {
            const r = mapped[i * 3]!;
            const g = mapped[i * 3 + 1]!;
            const b = mapped[i * 3 + 2]!;
            const o = i * 6;
            out[o] = r >>> 8;
            out[o + 1] = r & 0xff;
            out[o + 2] = g >>> 8;
            out[o + 3] = g & 0xff;
            out[o + 4] = b >>> 8;
            out[o + 5] = b & 0xff;
          }
        } else {
          for (let i = 0; i < total; i++) {
            const o = i * 3;
            out[o] = mapped[o]! & 0xff;
            out[o + 1] = mapped[o + 1]! & 0xff;
            out[o + 2] = mapped[o + 2]! & 0xff;
          }
        }

        readbackBuffer.unmap();
        return out;
      } catch {
        return null;
      } finally {
        paramsBuffer?.destroy();
        seedBuffer?.destroy();
        storageBuffer?.destroy();
        readbackBuffer?.destroy();
      }
    },
    dispose() {
      device.destroy();
    },
  };
}
