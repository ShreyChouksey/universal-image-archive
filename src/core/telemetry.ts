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
  throughputHuman: string;
  hardwareToll: 'optimal' | 'moderate' | 'heavy' | 'extreme';
  tollWarning: string | null;
  gpuAdapter: string;
  maxTextureSize: number;
  exceedsHardwareLimit: boolean;
}

export class TelemetryMonitor {
  #frameCount = 0;
  #lastFrameTimestamp = performance.now();
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
    this.#lastFrameTimestamp = performance.now();

    const elapsed = this.#lastFrameTimestamp - this.#lastFpsUpdate;
    if (elapsed >= 500) {
      this.#currentFps = Math.round((this.#frameCount * 1000) / elapsed);
      this.#frameCount = 0;
      this.#lastFpsUpdate = this.#lastFrameTimestamp;
    }
  }

  sample(format: ArchiveFormat, _rounds: number): TelemetrySample {
    const now = performance.now();
    // If no frames rendered in last 1.5s, report idle 60 FPS
    if (now - this.#lastFrameTimestamp > 1500) {
      this.#currentFps = 60;
    }

    const { width, height } = format.resolution;
    const pixels = width * height;
    const bpc = format.depth.bpc;
    const channels = 4; // RGBA

    // VRAM estimate: texture dimensions * channels * bytes per channel
    const bytesPerChannel = bpc > 8 ? 2 : 1;
    const vramBytes = pixels * channels * bytesPerChannel;

    const exceedsHardwareLimit = width > this.#maxTextureDimension || height > this.#maxTextureDimension;

    // Throughput: total pixels generated per second based on real render time.
    // If resolution exceeds GPU max texture dimension, GPU cannot allocate texture, so real throughput is 0.
    let throughputMpxPerSec = 0;
    let throughputHuman = '0.0 Mpx/s';

    if (!exceedsHardwareLimit) {
      const frameSec = Math.max(0.001, this.#lastFrameDurationMs / 1000);
      throughputMpxPerSec = (pixels / 1e6) / frameSec;
      throughputHuman = formatThroughput(throughputMpxPerSec);
    } else {
      throughputHuman = '0.0 Mpx/s (Limit Exceeded)';
    }

    // Evaluate hardware load tier & warning
    let hardwareToll: TelemetrySample['hardwareToll'] = 'optimal';
    let tollWarning: string | null = null;

    if (exceedsHardwareLimit) {
      hardwareToll = 'extreme';
      tollWarning = `Grid (${width}×${height}) exceeds WebGPU single-texture limit (${this.#maxTextureDimension}px).\n• FROZEN: Resolve (Address Materialisation) & .uia Binary Export.\n• FULLY ACTIVE: Seed Browsing (Viewport Shader), PNG Export, Hex & Decimal Exports.`;
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
      throughputHuman,
      hardwareToll,
      tollWarning,
      gpuAdapter: this.#adapterName,
      maxTextureSize: this.#maxTextureDimension,
      exceedsHardwareLimit,
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

export function formatThroughput(mpxPerSec: number): string {
  if (mpxPerSec >= 1000) {
    return `${(mpxPerSec / 1000).toFixed(2)} Gpx/s`;
  }
  return `${mpxPerSec.toFixed(1)} Mpx/s`;
}
