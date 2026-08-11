/**
 * Universal Image Archive — Real-Time Telemetry & Hardware Capacity Engine
 *
 * Measures GPU/CPU render latency, frame rates, VRAM/RAM allocation pressure,
 * Philox throughput, and warns when operating near hardware allocation boundaries
 * (e.g. 16K / 32K / 64K grids exceeding WebGPU buffer limits).
 */

import type { ArchiveFormat } from './format';

export interface TelemetrySample {
  fps: number;
  frameTimeMs: number;
  vramBytes: number;
  vramHuman: string;
  jsHeapBytes: number | null;
  jsHeapHuman: string | null;
  throughputMpxPerSec: number;
  hardwareToll: 'optimal' | 'moderate' | 'heavy' | 'extreme';
  tollWarning: string | null;
  gpuAdapter: string;
  maxTextureSize: number;
}

export class TelemetryMonitor {
  #frameCount = 0;
  #lastFpsUpdate = performance.now();
  #currentFps = 60;
  #lastFrameDurationMs = 0.8;
  #adapterName = 'WebGPU (Hardware Accelerated)';
  #maxTextureDimension = 8192;

  constructor() {
    this.#detectBrowserMemory();
  }

  setGpuInfo(adapterName: string, maxTextureDimension: number): void {
    this.#adapterName = adapterName;
    this.#maxTextureDimension = maxTextureDimension;
  }

  recordFrame(renderTimeMs: number): void {
    this.#frameCount++;
    this.#lastFrameDurationMs = Math.max(0.01, renderTimeMs);

    const now = performance.now();
    const elapsed = now - this.#lastFpsUpdate;
    if (elapsed >= 500) {
      this.#currentFps = Math.round((this.#frameCount * 1000) / elapsed);
      this.#frameCount = 0;
      this.#lastFpsUpdate = now;
    }
  }

  sample(format: ArchiveFormat, _rounds: number): TelemetrySample {
    const { width, height } = format.resolution;
    const pixels = width * height;
    const bpc = format.depth.bpc;
    const channels = 4; // RGBA

    // VRAM estimate: texture dimensions * channels * bytes per channel
    const bytesPerChannel = bpc > 8 ? 2 : 1;
    const vramBytes = pixels * channels * bytesPerChannel;

    // Throughput: total pixels generated per second based on render time
    const frameSec = Math.max(0.0001, this.#lastFrameDurationMs / 1000);
    const throughputMpxPerSec = (pixels / 1e6) / frameSec;

    // Evaluate hardware load tier & warning
    let hardwareToll: TelemetrySample['hardwareToll'] = 'optimal';
    let tollWarning: string | null = null;

    if (width > this.#maxTextureDimension || height > this.#maxTextureDimension) {
      hardwareToll = 'extreme';
      tollWarning = `Resolution (${width}×${height}) exceeds GPU hardware texture limit (${this.#maxTextureDimension}px). Browsers cap WebGPU bindings at ${this.#maxTextureDimension}px.`;
    } else if (vramBytes > 2 * 1024 * 1024 * 1024) {
      // > 2 GB single buffer
      hardwareToll = 'extreme';
      tollWarning = `Extreme memory toll (${formatBytes(vramBytes)} per frame). Exceeds typical browser allocation limits even on high-end hardware.`;
    } else if (vramBytes > 500 * 1024 * 1024) {
      // > 500 MB
      hardwareToll = 'heavy';
      tollWarning = `Heavy GPU memory load (${formatBytes(vramBytes)}). Multi-gigapixel compute workload active.`;
    } else if (vramBytes > 50 * 1024 * 1024) {
      // > 50 MB
      hardwareToll = 'moderate';
    }

    const heap = this.#readJsHeap();

    return {
      fps: this.#currentFps,
      frameTimeMs: Number(this.#lastFrameDurationMs.toFixed(2)),
      vramBytes,
      vramHuman: formatBytes(vramBytes),
      jsHeapBytes: heap,
      jsHeapHuman: heap !== null ? formatBytes(heap) : null,
      throughputMpxPerSec: Number(throughputMpxPerSec.toFixed(1)),
      hardwareToll,
      tollWarning,
      gpuAdapter: this.#adapterName,
      maxTextureSize: this.#maxTextureDimension,
    };
  }

  #readJsHeap(): number | null {
    const nav = performance as unknown as { memory?: { usedJSHeapSize?: number } };
    if (nav.memory && typeof nav.memory.usedJSHeapSize === 'number') {
      return nav.memory.usedJSHeapSize;
    }
    return null;
  }

  #detectBrowserMemory(): void {
    // Memory API hook for Chromium browsers if supported
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}
