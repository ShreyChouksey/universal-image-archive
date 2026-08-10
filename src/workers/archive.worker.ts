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
  BIGINT_MAX_BYTES,
  DECIMAL_MODULUS,
  bumpAddress,
  decimalDigitCount,
  hexSlice,
  materialiseSeed,
  packAddressFile,
  residueMod10e15,
} from '../core/address';
import {
  composePlate,
  plateSelfTest,
  verifyPlate,
  type PlateReport,
  type PlateVerdict,
} from '../core/plate';
import type { ArchiveFormat } from '../core/format';
import { encodePng } from '../core/png';
import { type Seed } from '../core/philox';
import { directionOfTexel } from '../core/sphere';
import { encodeAddress, fillSurroundFromArchive, toTexture, type LowBits } from '../core/raster';

export type FitMode = 'cover' | 'contain' | 'stretch';
export type FlipMode = 'none' | 'horizontal' | 'vertical' | 'both';
export type { LowBits } from '../core/raster';

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
  | { id: number; kind: 'importDecimal'; text: string; formats: ArchiveFormat[] }
  | { id: number; kind: 'step'; delta: number }
  | { id: number; kind: 'slice'; from: number; count: number }
  | { id: number; kind: 'textureRows'; y0: number; rows: number }
  | { id: number; kind: 'entropy' }
  | { id: number; kind: 'decimal' }
  | { id: number; kind: 'hexFile' }
  | { id: number; kind: 'plate'; format: ArchiveFormat; seed: number[]; statement: string; layoutId: string }
  | { id: number; kind: 'verify'; format: ArchiveFormat }
  | { id: number; kind: 'selfcheck'; format: ArchiveFormat; seed: number[] }
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
  | { id: number; kind: 'readout'; readout: ReturnType<typeof currentReadout> }
  | { id: number; kind: 'blob'; blob: Blob; filename: string }
  | { id: number; kind: 'plate'; report: PlateReport }
  | { id: number; kind: 'verdict'; verdict: PlateVerdict }
  | { id: number; kind: 'slice'; from: number; bytes: Uint8Array }
  | { id: number; kind: 'entropy'; report: EntropyReport }
  | { id: number; kind: 'stepped'; changedFrom: number }
  | { id: number; kind: 'textureRows'; y0: number; rows: number; data: Uint16Array }
  | { id: number; kind: 'imported'; format: ArchiveFormat };

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

/**
 * The two figures in the readout that cost a pass over the whole address.
 *
 * Recomputing them after every step meant streaming 47 MB to move one byte,
 * which is most of what made stepping feel heavy. Both can be carried forward
 * instead: the residue mod 10^15 of address+delta is (residue+delta) mod 10^15
 * exactly, and the digit count cannot change unless the carry reached the
 * leading bytes. When it does reach them, the cache is dropped and rebuilt.
 */
let readoutCache: { residue: number; digits: number } | null = null;

function currentReadout() {
  if (!current) throw new Error('no address is loaded');
  const bytes = current.bytes;
  if (!readoutCache) {
    readoutCache = { residue: residueMod10e15(bytes), digits: decimalDigitCount(bytes) };
  }
  return {
    head: hexSlice(bytes, 0, 16),
    tail: hexSlice(bytes, Math.max(0, bytes.length - 16), 16),
    bytes: bytes.length,
    digitCount: readoutCache.digits,
    trailingDecimal: String(readoutCache.residue).padStart(15, '0').slice(-12),
  };
}

/** Replaces the loaded address, dropping anything derived from the old one. */
function load(format: ArchiveFormat, bytes: Uint8Array): void {
  current = { format, bytes };
  readoutCache = null;
}

const post = (msg: Response, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

/** Same colour-managed context for every read, or one image gets two addresses. */
function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx =
    canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'display-p3' }) ??
    canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context available in this worker');
  return ctx;
}

/** A CSS colour as 8-bit RGB, resolved by the canvas so named colours work too. */
function parseColour(css: string): [number, number, number] {
  const c = new OffscreenCanvas(1, 1);
  const ctx = context2d(c);
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

function drawToArchive(
  format: ArchiveFormat,
  bitmap: ImageBitmap,
  options: SearchOptions,
): { rgba: Uint8ClampedArray; mask: Uint8Array } {
  const { width, height } = format.resolution;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = context2d(canvas);

  // 'archive' surround is painted after readback, straight into the address
  // bytes, guided by the mask built below.
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
  // The margin is a promise: under Cover the overflow would paint across it,
  // so the box is also the clip.
  ctx.beginPath();
  ctx.rect(inset, inset, boxW, boxH);
  ctx.clip();
  const flipX = options.flip === 'horizontal' || options.flip === 'both';
  const flipY = options.flip === 'vertical' || options.flip === 'both';
  ctx.translate(flipX ? width : 0, flipY ? height : 0);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, dx, dy, drawW, drawH);
  ctx.restore();

  // Where the photograph actually landed: its draw rectangle clipped to the
  // box. The rectangle is centred, so the flips do not move it.
  const x0 = Math.max(inset, Math.floor(dx));
  const y0 = Math.max(inset, Math.floor(dy));
  const x1 = Math.min(inset + boxW, Math.ceil(dx + drawW));
  const y1 = Math.min(inset + boxH, Math.ceil(dy + drawH));
  const mask = new Uint8Array(width * height);
  for (let y = y0; y < y1; y++) mask.fill(1, y * width + x0, y * width + x1);

  return { rgba: ctx.getImageData(0, 0, width, height).data, mask };
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
  // The same colour-managed read as the plane path, or the two geometries
  // would assign one photograph two different addresses.
  const sctx = context2d(src);

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

  // The surround the user chose. 'archive' stays black here; it is painted
  // into the address bytes afterwards, guided by the mask.
  if (options.fill !== 'archive' && options.fill !== '#000000') {
    const [fr, fg, fb] = parseColour(options.fill);
    for (let i = 0; i < width * height; i++) {
      out[i * 4] = fr;
      out[i * 4 + 1] = fg;
      out[i * 4 + 2] = fb;
      out[i * 4 + 3] = 255;
    }
  }

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
        load(req.format, bytes);
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
          const placed = drawToArchive(req.format, req.bitmap, req.options);
          rgba = placed.rgba;
          mask = placed.mask;
        }
        req.bitmap.close();

        post({ id: req.id, kind: 'progress', label: 'Computing address', fraction: 0.7 });
        const bytes = encodeAddress(req.format, rgba, req.options.lowBits);
        if (req.options.fill === 'archive') {
          fillSurroundFromArchive(req.format, Uint32Array.from(req.seed) as Seed, bytes, mask);
        }
        load(req.format, bytes);
        post({ id: req.id, kind: 'ok' });
        break;
      }

      case 'adopt': {
        load(req.format, new Uint8Array(req.bytes));
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
        load(req.format, bytes);
        post({ id: req.id, kind: 'plate', report });
        break;
      }

      case 'verify': {
        if (!current) throw new Error('no address is loaded');
        post({ id: req.id, kind: 'verdict', verdict: verifyPlate(req.format, current.bytes) });
        break;
      }

      case 'selfcheck': {
        // Composing and reading back a full plate takes seconds — main-thread
        // work it used to do during boot, freezing first paint. Here it costs
        // nobody anything.
        const check = plateSelfTest(req.format, Uint32Array.from(req.seed) as Seed);
        if (!check.ok) throw new Error(check.detail);
        post({ id: req.id, kind: 'ok' });
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
        if (bytes.length > BIGINT_MAX_BYTES) {
          throw new Error(
            `The engine's integers stop at ${(BIGINT_MAX_BYTES / 1048576).toFixed(0)} MiB and this address is ` +
              `${(bytes.length / 1048576).toFixed(0)} MiB. Hexadecimal carries the full number exactly.`,
          );
        }
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

      case 'importDecimal': {
        // The number IS the image, so typing it back in must return the image.
        // Parsing a hundred-million-digit integer takes tens of seconds, which
        // is why it happens here and not on the thread that draws frames.
        const digits = req.text.replace(/[\s,._']/g, '');
        if (!/^\d+$/.test(digits)) {
          throw new Error('That file does not read as a decimal number.');
        }
        post({ id: req.id, kind: 'progress', label: 'Reading the number', fraction: 0.1 });
        const value = BigInt(digits);

        // The number alone does not say which grid it was written for — leading
        // zeros vanish in decimal. Take the smallest offered format the value
        // fits, which recovers every export whose image was not mostly black.
        post({ id: req.id, kind: 'progress', label: 'Finding the grid it fits', fraction: 0.45 });
        const fit = req.formats
          .slice()
          .sort(
            (a, b) =>
              a.resolution.width * a.resolution.height * a.depth.bytesPerPixel -
              b.resolution.width * b.resolution.height * b.depth.bytesPerPixel,
          )
          .find((f) => {
            const bytes =
              f.resolution.width * f.resolution.height * f.depth.bytesPerPixel;
            return bytes <= BIGINT_MAX_BYTES && value >> BigInt(bytes * 8) === 0n;
          });
        if (!fit) {
          throw new Error(
            'That number is larger than any grid this archive can resolve, or needs one past the 128 MiB integer ceiling.',
          );
        }

        post({ id: req.id, kind: 'progress', label: 'Writing the bytes', fraction: 0.7 });
        const total =
          fit.resolution.width * fit.resolution.height * fit.depth.bytesPerPixel;
        let hex = value.toString(16);
        if (hex.length % 2) hex = '0' + hex;
        const out = new Uint8Array(total); // leading zeros restored by the pad
        const start = total - hex.length / 2;
        for (let i = 0; i < hex.length / 2; i++) {
          out[start + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
        load(fit, out);
        post({ id: req.id, kind: 'imported', format: fit });
        break;
      }

      case 'step': {
        if (!current) throw new Error('no address is loaded');
        // Report how far the carry reached, so the caller can repaint just that
        // much instead of the whole picture.
        const changedFrom = bumpAddress(current.bytes, req.delta);
        if (readoutCache) {
          if (changedFrom <= 16) {
            // The carry reached the leading bytes, so the digit count may have
            // moved and the address may have wrapped. Rebuild from scratch.
            readoutCache = null;
          } else {
            const m = DECIMAL_MODULUS;
            readoutCache.residue = (((readoutCache.residue + (req.delta % m)) % m) + m) % m;
          }
        }
        post({ id: req.id, kind: 'stepped', changedFrom });
        break;
      }

      case 'textureRows': {
        if (!current) throw new Error('no address is loaded');
        const { width } = current.format.resolution;
        const bpp = current.format.depth.bytesPerPixel;
        const y0 = Math.max(0, Math.min(current.format.resolution.height - 1, req.y0));
        const rows = Math.max(1, Math.min(current.format.resolution.height - y0, req.rows));
        const data = new Uint16Array(width * rows * 4);
        const wide = current.format.depth.bpc === 16;
        for (let i = 0; i < width * rows; i++) {
          const s = (y0 * width + i) * bpp;
          const d = i * 4;
          if (wide) {
            data[d] = (current.bytes[s] << 8) | current.bytes[s + 1];
            data[d + 1] = (current.bytes[s + 2] << 8) | current.bytes[s + 3];
            data[d + 2] = (current.bytes[s + 4] << 8) | current.bytes[s + 5];
            data[d + 3] = 65535;
          } else {
            data[d] = current.bytes[s];
            data[d + 1] = current.bytes[s + 1];
            data[d + 2] = current.bytes[s + 2];
            data[d + 3] = 255;
          }
        }
        post({ id: req.id, kind: 'textureRows', y0, rows, data }, [data.buffer]);
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
        post({ id: req.id, kind: 'readout', readout: currentReadout() });
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
        readoutCache = null;
        post({ id: req.id, kind: 'ok' });
        break;
      }
    }
  } catch (error) {
    post({ id: req.id, kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
