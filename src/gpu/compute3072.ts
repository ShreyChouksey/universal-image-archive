/**
 * WebGPU 3,072-Bit Compute Shader Acceleration Core (Layer 0).
 *
 * Parallelizes 96-word Philox96x32 evaluation across WebGPU compute workgroups.
 * Performance and capacity depend on the selected adapter and format.
 */

import type { ArchiveFormat } from '../core/format';
import type { Seed3072 } from '../core/seed3072';
import { pixelCount } from '../core/format';
import { normalisePhiloxRounds3072 } from '../core/philox96';

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

const PHILOX_CONSTANTS = array<u32, 8>(
  0xd2511f53u, 0xcd9e8d57u, 0x9e3779b9u, 0xbb67ae85u,
  0x85ebca6bu, 0xc2b2ae35u, 0x27d4eb2du, 0x165667b1u
);

fn mulhilo(a: u32, b: u32) -> vec2<u32> {
  let ah = a >> 16u;
  let al = a & 0xffffu;
  let bh = b >> 16u;
  let bl = b & 0xffffu;
  let albl = al * bl;
  let w1 = ah * bl + (albl >> 16u);
  let w2 = al * bh + (w1 & 0xffffu);
  let hi = ah * bh + (w1 >> 16u) + (w2 >> 16u);
  let lo = ((w2 & 0xffffu) << 16u) | (albl & 0xffffu);
  return vec2<u32>(hi, lo);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  let y = global_id.y;
  if (x >= params.width || y >= params.height) {
    return;
  }
  let idx = y * params.width + x;

  var state: array<u32, 96>;
  state[0] = idx;
  state[1] = 0u;
  for (var i = 2u; i < 96u; i = i + 1u) {
    state[i] = seedBuffer[i];
  }

  let rounds = min(64u, max(1u, params.rounds));
  for (var r = 0u; r < rounds; r = r + 1u) {
    let c0 = PHILOX_CONSTANTS[r % 8u];
    let c1 = PHILOX_CONSTANTS[(r + 1u) % 8u];
    for (var i = 0u; i < 96u; i = i + 2u) {
      let src = (i + r * 3u) % 96u;
      let p = mulhilo(c0, state[i]);
      let k = seedBuffer[src] ^ (seedBuffer[(src + 1u) % 96u] * 0x9e3779b9u) ^ (c1 + r);
      let next_idx = (i + 1u) % 96u;
      state[i] = p.y ^ state[next_idx] ^ k;
      state[next_idx] = p.x ^ state[(i + 3u) % 96u];
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
  if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
    return { supported: false, materialise: async () => null, dispose: () => {} };
  }

  let adapter: GPUAdapter | null = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    return { supported: false, materialise: async () => null, dispose: () => {} };
  }
  if (!adapter) return { supported: false, materialise: async () => null, dispose: () => {} };

  const device = await adapter.requestDevice({
    requiredLimits: {
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    },
  }).catch(() => null);
  if (!device) return { supported: false, materialise: async () => null, dispose: () => {} };

  let pipeline: GPUComputePipeline | null = null;
  try {
    const module = device.createShaderModule({ code: COMPUTE_3072_WGSL, label: 'uiaCompute3072' });
    pipeline = await device.createComputePipelineAsync({
      label: 'uiaComputePipeline3072',
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
  } catch {
    device.destroy();
    return { supported: false, materialise: async () => null, dispose: () => {} };
  }

  return {
    supported: true,
    async materialise(format: ArchiveFormat, seed: Seed3072, rounds = 32): Promise<Uint8Array | null> {
      if (!device || !pipeline) return null;
      if (seed.length !== 96) return null;

      const width = format.resolution.width;
      const height = format.resolution.height;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null;
      const validDepth = (format.depth.bpc === 8 && format.depth.bytesPerPixel === 3)
        || (format.depth.bpc === 16 && format.depth.bytesPerPixel === 6);
      if (!validDepth) return null;
      const total = pixelCount(format);
      if (!Number.isSafeInteger(total) || total > 0xffff_ffff) return null;
      const bpp = format.depth.bytesPerPixel;
      const totalBytes = total * bpp;
      const storageByteSize = total * 3 * 4;
      const dispatchX = Math.ceil(width / 64);
      const dispatchY = height;
      const maxDispatch = device.limits.maxComputeWorkgroupsPerDimension;

      if (dispatchX > maxDispatch || dispatchY > maxDispatch) return null;
      if (storageByteSize > device.limits.maxBufferSize) return null;
      if (storageByteSize > device.limits.maxStorageBufferBindingSize) return null;

      let paramsBuffer: GPUBuffer | null = null;
      let seedBuffer: GPUBuffer | null = null;
      let storageBuffer: GPUBuffer | null = null;
      let readbackBuffer: GPUBuffer | null = null;

      try {
        const paramsData = new Uint32Array([
          format.resolution.width,
          format.resolution.height,
          format.depth.bpc,
          normalisePhiloxRounds3072(rounds),
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
        pass.dispatchWorkgroups(dispatchX, dispatchY);
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
