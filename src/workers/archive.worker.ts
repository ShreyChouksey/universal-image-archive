/**
 * The heavy end of the archive.
 *
 * Everything here is measured in tens of megabytes: materialising a 47.5 MiB
 * address, promoting an uploaded photograph into one, turning one into a PNG.
 * None of it belongs on the thread that has to stay at 60 fps, so all of it
 * lives behind this worker and comes back as transferables.
 *
 * The worker owns exactly one address at a time. Seeded images do not need it —
 * the GPU derives those from the seed — so the buffer is only allocated when
 * someone asks to export, inspect, or search.
 */

import {
  bumpAddress,
  hexSlice,
  materialiseSeed,
  packAddressFile,
  readAddress,
} from '../core/address';
import { composePlate, verifyPlate, type PlateReport, type PlateVerdict } from '../core/plate';
import type { ArchiveFormat } from '../core/format';
import { encodePng } from '../core/png';
import { philox4x32_10, philoxScratch, type Seed } from '../core/philox';
import { directionOfTexel } from '../core/sphere';

export type FitMode = 'cover' | 'contain' | 'stretch';
export type FlipMode = 'none' | 'horizontal' | 'vertical' | 'both';
export type LowBits = 'replicate' | 'noise';

export interface SearchOptions {
  fit: FitMode;
  flip: FlipMode;
  /** CSS colour for the surround, or 'archive' to fill it with the archive itself. */
  fill: string;
  frame: number;
  lowBits: LowBits;
  /** Sphere geometry: horizontal field of view the supplied image is placed at. */
  placementFovDeg: number;
}

export type Request =
  | { id: number; kind: 'materialise'; format: ArchiveFormat; seed: number[] }
  | {
      id: number;
      kind: 'search';
      format: ArchiveFormat;
      bitmap: ImageBitmap;
      options: SearchOptions;
      seed: number[];
    }
  | { id: number; kind: 'adopt'; format: ArchiveFormat; bytes: ArrayBuffer }
  | { id: number; kind: 'step'; delta: number }
  | { id: number; kind: 'slice'; from: number; count: number }
  | { id: number; kind: 'entropy' }
  | { id: number; kind: 'decimal' }
  | { id: number; kind: 'hexFile' }
  | { id: number; kind: 'plate'; format: ArchiveFormat; seed: number[]; statement: string; layoutId: string }
  | { id: number; kind: 'verify'; format: ArchiveFormat }
  | { id: number; kind: 'texture' }
  | { id: number; kind: 'readout' }
  | { id: number; kind: 'png' }
  | { id: number; kind: 'addressFile' }
  | { id: number; kind: 'release' };

export type Response =
  | { id: number; kind: 'ok' }
  | { id: number; kind: 'error'; message: string }
  | { id: number; kind: 'progress'; label: string; fraction: number }
  | { id: number; kind: 'texture'; width: number; height: number; data: Uint16Array }
  | { id: number; kind: 'readout'; readout: ReturnType<typeof readAddress> }
  | { id: number; kind: 'blob'; blob: Blob; filename: string }
  | { id: number; kind: 'plate'; report: PlateReport }
  | { id: number; kind: 'verdict'; verdict: PlateVerdict }
  | { id: number; kind: 'slice'; from: number; bytes: Uint8Array }
  | { id: number; kind: 'entropy'; report: EntropyReport };

export interface EntropyReport {
  /** Shannon entropy of the whole address, bits per byte. 8 is the ceiling. */
  bitsPerByte: number;
  /** Compressed size over original, on a sample. Above 1 means incompressible. */
  compressionRatio: number;
  sampleBytes: number;
  /** Distribution of byte values, for the histogram. */
  histogram: Uint32Array;
}

let current: { format: ArchiveFormat; bytes: Uint8Array } | null = null;

const post = (msg: Response, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

/** Address bytes -> RGBA16 texels for the GPU. Alpha is unused but keeps rows aligned. */
function toTexture(format: ArchiveFormat, bytes: Uint8Array): Uint16Array {
  const { width, height } = format.resolution;
  const out = new Uint16Array(width * height * 4);
  const n = width * height;
  if (format.depth.bpc === 16) {
    for (let i = 0; i < n; i++) {
      const s = i * 6;
      const d = i * 4;
      out[d] = (bytes[s] << 8) | bytes[s + 1];
      out[d + 1] = (bytes[s + 2] << 8) | bytes[s + 3];
      out[d + 2] = (bytes[s + 4] << 8) | bytes[s + 5];
      out[d + 3] = 65535;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const s = i * 3;
      const d = i * 4;
      out[d] = bytes[s];
      out[d + 1] = bytes[s + 1];
      out[d + 2] = bytes[s + 2];
      out[d + 3] = 255;
    }
  }
  return out;
}

function drawToArchive(
  format: ArchiveFormat,
  bitmap: ImageBitmap,
  options: SearchOptions,
): Uint8ClampedArray {
  const { width, height } = format.resolution;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'display-p3' })
    ?? canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context available in this worker');

  // 'archive' is painted after readback, straight into the address bytes, so it
  // is the archive's own noise rather than a canvas approximation of it.
  ctx.fillStyle = options.fill === 'archive' ? '#000000' : options.fill;
  ctx.fillRect(0, 0, width, height);

  const inset = Math.max(0, Math.min(options.frame, Math.floor(Math.min(width, height) / 2) - 1));
  const boxW = width - inset * 2;
  const boxH = height - inset * 2;

  const scale =
    options.fit === 'stretch'
      ? null
      : options.fit === 'cover'
        ? Math.max(boxW / bitmap.width, boxH / bitmap.height)
        : Math.min(boxW / bitmap.width, boxH / bitmap.height);

  const drawW = scale === null ? boxW : bitmap.width * scale;
  const drawH = scale === null ? boxH : bitmap.height * scale;
  const dx = inset + (boxW - drawW) / 2;
  const dy = inset + (boxH - drawH) / 2;

  ctx.save();
  const flipX = options.flip === 'horizontal' || options.flip === 'both';
  const flipY = options.flip === 'vertical' || options.flip === 'both';
  ctx.translate(flipX ? width : 0, flipY ? height : 0);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, dx, dy, drawW, drawH);
  ctx.restore();

  return ctx.getImageData(0, 0, width, height).data;
}

/**
 * Places a flat photograph into an equirectangular field.
 *
 * For every texel of the sphere, take the direction it faces and ask whether the
 * camera that took the photograph could have seen it. Where it could, sample the
 * photograph; where it could not, the texel is surround. That is the honest
 * relationship between a picture and a standpoint: a photograph is a fragment of
 * a sphere, and the archive already holds every way the rest of it could have
 * looked.
 *
 * `mask` marks which texels the photograph reached, so the surround can be
 * filled afterwards without guessing.
 */
function drawToSphere(
  format: ArchiveFormat,
  bitmap: ImageBitmap,
  options: SearchOptions,
  onProgress: (fraction: number) => void,
): { rgba: Uint8ClampedArray; mask: Uint8Array } {
  const { width, height } = format.resolution;
  const src = new OffscreenCanvas(bitmap.width, bitmap.height);
  const sctx = src.getContext('2d', { willReadFrequently: true });
  if (!sctx) throw new Error('no 2d context available in this worker');

  const flipX = options.flip === 'horizontal' || options.flip === 'both';
  const flipY = options.flip === 'vertical' || options.flip === 'both';
  sctx.save();
  sctx.translate(flipX ? bitmap.width : 0, flipY ? bitmap.height : 0);
  sctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  sctx.drawImage(bitmap, 0, 0);
  sctx.restore();
  const source = sctx.getImageData(0, 0, bitmap.width, bitmap.height).data;

  const out = new Uint8ClampedArray(width * height * 4);
  const mask = new Uint8Array(width * height);

  const aspect = bitmap.width / bitmap.height;
  const fovH = (options.placementFovDeg * Math.PI) / 180;
  const tanHalfH = Math.tan(fovH / 2);
  const tanHalfV = tanHalfH / aspect;

  for (let y = 0; y < height; y++) {
    if ((y & 255) === 0) onProgress(y / height);
    for (let x = 0; x < width; x++) {
      const dir = directionOfTexel(x, y, width, height);
      // The camera looks down +z; anything behind it is surround.
      if (dir[2] <= 1e-6) continue;
      const ndcX = dir[0] / dir[2] / tanHalfH;
      const ndcY = dir[1] / dir[2] / tanHalfV;
      if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) continue;

      const fx = ((ndcX + 1) / 2) * (bitmap.width - 1);
      const fy = ((1 - ndcY) / 2) * (bitmap.height - 1);
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(bitmap.width - 1, x0 + 1);
      const y1 = Math.min(bitmap.height - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;

      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = source[(y0 * bitmap.width + x0) * 4 + c];
        const b = source[(y0 * bitmap.width + x1) * 4 + c];
        const d = source[(y1 * bitmap.width + x0) * 4 + c];
        const e = source[(y1 * bitmap.width + x1) * 4 + c];
        out[i + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
      out[i + 3] = 255;
      mask[y * width + x] = 1;
    }
  }
  return { rgba: out, mask };
}

/**
 * Fills everything the photograph did not reach with the archive's own noise,
 * at the given coordinate. You supply what you saw; the archive supplies the
 * rest of what could have been seen from there.
 */
function fillSurroundFromArchive(
  format: ArchiveFormat,
  seed: Seed,
  bytes: Uint8Array,
  mask: Uint8Array | null,
): void {
  const n = format.resolution.width * format.resolution.height;
  const scratch = philoxScratch();
  const wide = format.depth.bpc === 16;
  for (let i = 0; i < n; i++) {
    if (mask && mask[i]) continue;
    philox4x32_10(scratch, i >>> 0, (i / 0x100000000) >>> 0, seed[2], seed[3], seed[0], seed[1]);
    if (wide) {
      const o = i * 6;
      const r = scratch[0] & 0xffff;
      const g = scratch[1] & 0xffff;
      const b = scratch[2] & 0xffff;
      bytes[o] = r >>> 8; bytes[o + 1] = r & 0xff;
      bytes[o + 2] = g >>> 8; bytes[o + 3] = g & 0xff;
      bytes[o + 4] = b >>> 8; bytes[o + 5] = b & 0xff;
    } else {
      const o = i * 3;
      bytes[o] = scratch[0] & 0xff;
      bytes[o + 1] = scratch[1] & 0xff;
      bytes[o + 2] = scratch[2] & 0xff;
    }
  }
}

/**
 * 8-bit RGBA -> address bytes at the archive's depth.
 *
 * Promoting 8 bits to 16 by multiplying by 257 maps 0->0 and 255->65535 exactly,
 * which is the correct expansion. The low byte is then fully determined by the
 * high one — the image lands at a very unusual address, one of the vanishingly
 * few whose bytes repeat in pairs. `lowBits: 'noise'` instead seeds the low byte
 * from the archive itself, which leaves the picture visually identical and puts
 * it somewhere far more typical.
 */
function encodeAddress(format: ArchiveFormat, rgba: Uint8ClampedArray, lowBits: LowBits): Uint8Array {
  const n = format.resolution.width * format.resolution.height;
  const out = new Uint8Array(n * format.depth.bytesPerPixel);

  if (format.depth.bpc === 8) {
    for (let i = 0; i < n; i++) {
      out[i * 3] = rgba[i * 4];
      out[i * 3 + 1] = rgba[i * 4 + 1];
      out[i * 3 + 2] = rgba[i * 4 + 2];
    }
    return out;
  }

  if (lowBits === 'replicate') {
    for (let i = 0; i < n; i++) {
      const s = i * 4;
      const d = i * 6;
      out[d] = rgba[s];
      out[d + 1] = rgba[s];
      out[d + 2] = rgba[s + 1];
      out[d + 3] = rgba[s + 1];
      out[d + 4] = rgba[s + 2];
      out[d + 5] = rgba[s + 2];
    }
  } else {
    const scratch = philoxScratch();
    for (let i = 0; i < n; i++) {
      philox4x32_10(scratch, i >>> 0, 0, 0, 0, 0x9e3779b9, 0x85ebca6b);
      const s = i * 4;
      const d = i * 6;
      out[d] = rgba[s];
      out[d + 1] = scratch[0] & 0xff;
      out[d + 2] = rgba[s + 1];
      out[d + 3] = scratch[1] & 0xff;
      out[d + 4] = rgba[s + 2];
      out[d + 5] = scratch[2] & 0xff;
    }
  }
  return out;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data;
  try {
    switch (req.kind) {
      case 'materialise': {
        const bytes = new Uint8Array(
          req.format.resolution.width * req.format.resolution.height * req.format.depth.bytesPerPixel,
        );
        const seed = Uint32Array.from(req.seed) as Seed;
        const total = req.format.resolution.width * req.format.resolution.height;
        const chunkSize = 262144;
        for (let from = 0; from < total; from += chunkSize) {
          materialiseSeed(req.format, seed, bytes, { from, to: Math.min(from + chunkSize, total) });
          if ((from / chunkSize) % 8 === 0) {
            post({ id: req.id, kind: 'progress', label: 'Materialising address', fraction: from / total });
          }
        }
        current = { format: req.format, bytes };
        post({ id: req.id, kind: 'ok' });
        break;
      }

      case 'search': {
        const sphere = req.format.resolution.geometry === 'sphere';
        let rgba: Uint8ClampedArray;
        let mask: Uint8Array | null = null;

        if (sphere) {
          const placed = drawToSphere(req.format, req.bitmap, req.options, (fraction) =>
            post({ id: req.id, kind: 'progress', label: 'Projecting onto the sphere', fraction }),
          );
          rgba = placed.rgba;
          mask = placed.mask;
        } else {
          post({ id: req.id, kind: 'progress', label: 'Resampling to archive format', fraction: 0.1 });
          rgba = drawToArchive(req.format, req.bitmap, req.options);
        }
        req.bitmap.close();

        post({ id: req.id, kind: 'progress', label: 'Computing address', fraction: 0.7 });
        const bytes = encodeAddress(req.format, rgba, req.options.lowBits);
        if (req.options.fill === 'archive') {
          fillSurroundFromArchive(req.format, Uint32Array.from(req.seed) as Seed, bytes, mask);
        }
        current = { format: req.format, bytes };
        post({ id: req.id, kind: 'ok' });
        break;
      }

      case 'adopt': {
        current = { format: req.format, bytes: new Uint8Array(req.bytes) };
        post({ id: req.id, kind: 'ok' });
        break;
      }

      case 'plate': {
        const bytes = new Uint8Array(
          req.format.resolution.width * req.format.resolution.height * req.format.depth.bytesPerPixel,
        );
        post({ id: req.id, kind: 'progress', label: 'Composing plate', fraction: 0.2 });
        const report = composePlate(
          req.format,
          { seed: Uint32Array.from(req.seed) as Seed, statement: req.statement, layoutId: req.layoutId },
          bytes,
        );
        // A plate is an ordinary loaded address, so export, step and the loupe
        // all keep working on it without knowing what it is.
        current = { format: req.format, bytes };
        post({ id: req.id, kind: 'plate', report });
        break;
      }

      case 'verify': {
        if (!current) throw new Error('no address is loaded');
        post({ id: req.id, kind: 'verdict', verdict: verifyPlate(req.format, current.bytes) });
        break;
      }

      case 'slice': {
        if (!current) throw new Error('no address is loaded');
        const from = Math.max(0, Math.min(current.bytes.length, req.from));
        const to = Math.min(current.bytes.length, from + req.count);
        // Copied, not subarray'd: the caller may hold it while the address moves.
        const bytes = current.bytes.slice(from, to);
        post({ id: req.id, kind: 'slice', from, bytes }, [bytes.buffer]);
        break;
      }

      case 'entropy': {
        if (!current) throw new Error('no address is loaded');
        const bytes = current.bytes;
        const histogram = new Uint32Array(256);
        for (let i = 0; i < bytes.length; i++) histogram[bytes[i]]++;
        let bitsPerByte = 0;
        for (let i = 0; i < 256; i++) {
          if (!histogram[i]) continue;
          const p = histogram[i] / bytes.length;
          bitsPerByte -= p * Math.log2(p);
        }
        // Compression is the claim people actually believe, so measure it rather
        // than inferring it from the entropy figure.
        const sampleBytes = Math.min(bytes.length, 4 * 1024 * 1024);
        const sample = bytes.subarray(0, sampleBytes);
        const gz = new CompressionStream('gzip') as unknown as ReadableWritablePair<
          Uint8Array,
          Uint8Array
        >;
        const stream = new Blob([sample as BufferSource]).stream() as unknown as ReadableStream<Uint8Array>;
        const compressed = await new Response(stream.pipeThrough(gz)).arrayBuffer();
        post({
          id: req.id,
          kind: 'entropy',
          report: {
            bitsPerByte,
            compressionRatio: compressed.byteLength / sampleBytes,
            sampleBytes,
            histogram,
          },
        });
        break;
      }

      case 'hexFile': {
        if (!current) throw new Error('no address is loaded');
        // Built in chunks: one 95-million-character string would be a spike
        // nobody needs, and Blob stitches the pieces for free.
        const bytes = current.bytes;
        const parts: string[] = [];
        const CHUNK = 1 << 20;
        for (let at = 0; at < bytes.length; at += CHUNK) {
          parts.push(hexSlice(bytes, at, Math.min(CHUNK, bytes.length - at)));
          if ((at / CHUNK) % 8 === 0) {
            post({ id: req.id, kind: 'progress', label: 'Writing hexadecimal', fraction: at / bytes.length });
          }
        }
        post({
          id: req.id,
          kind: 'blob',
          blob: new Blob(parts, { type: 'text/plain' }),
          filename: `uia-${current.format.resolution.width}x${current.format.resolution.height}-address.hex.txt`,
        });
        break;
      }

      case 'decimal': {
        if (!current) throw new Error('no address is loaded');
        const bytes = current.bytes;
        post({ id: req.id, kind: 'progress', label: 'Reading the address as one integer', fraction: 0.15 });

        const parts: string[] = [];
        const CHUNK = 1 << 20;
        for (let at = 0; at < bytes.length; at += CHUNK) {
          parts.push(hexSlice(bytes, at, Math.min(CHUNK, bytes.length - at)));
        }
        const value = BigInt('0x' + parts.join(''));

        // BigInt's base conversion cannot report progress, so the label has to
        // carry the wait instead of a bar that would sit still.
        post({ id: req.id, kind: 'progress', label: 'Converting to base ten', fraction: 0.45 });
        const decimal = value.toString(10);

        post({
          id: req.id,
          kind: 'blob',
          blob: new Blob([decimal], { type: 'text/plain' }),
          filename: `uia-${current.format.resolution.width}x${current.format.resolution.height}-address.dec.txt`,
        });
        break;
      }

      case 'step': {
        if (!current) throw new Error('no address is loaded');
        bumpAddress(current.bytes, req.delta);
        post({ id: req.id, kind: 'ok' });
        break;
      }

      case 'texture': {
        if (!current) throw new Error('no address is loaded');
        const data = toTexture(current.format, current.bytes);
        post(
          {
            id: req.id,
            kind: 'texture',
            width: current.format.resolution.width,
            height: current.format.resolution.height,
            data,
          },
          [data.buffer],
        );
        break;
      }

      case 'readout': {
        if (!current) throw new Error('no address is loaded');
        post({ id: req.id, kind: 'readout', readout: readAddress(current.bytes) });
        break;
      }

      case 'png': {
        if (!current) throw new Error('no address is loaded');
        const { format, bytes } = current;
        const blob = await encodePng({
          width: format.resolution.width,
          height: format.resolution.height,
          bpc: format.depth.bpc,
          pixels: bytes,
          panorama: format.resolution.geometry === 'sphere',
          onProgress: (fraction) =>
            post({ id: req.id, kind: 'progress', label: 'Encoding PNG', fraction }),
        });
        post({
          id: req.id,
          kind: 'blob',
          blob,
          filename: `uia-${format.resolution.geometry}-${format.resolution.width}x${format.resolution.height}-${format.depth.bpc}bpc.png`,
        });
        break;
      }

      case 'addressFile': {
        if (!current) throw new Error('no address is loaded');
        post({
          id: req.id,
          kind: 'blob',
          blob: packAddressFile(current.format, current.bytes),
          filename: `uia-${current.format.resolution.geometry}-${current.format.resolution.width}x${current.format.resolution.height}.uia`,
        });
        break;
      }

      case 'release': {
        current = null;
        post({ id: req.id, kind: 'ok' });
        break;
      }
    }
  } catch (error) {
    post({ id: req.id, kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
