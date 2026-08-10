/**
 * PNG writer, 16-bit truecolour.
 *
 * `canvas.toBlob()` can only ever hand back 8 bits per channel, which would
 * throw away half of a 48-bit address on the way out the door. PNG itself has
 * carried 16-bit truecolour since 1996, so the encoder here writes the format
 * directly and leans on `CompressionStream('deflate')` for the zlib layer —
 * that stream produces an RFC 1950 wrapper, which is exactly what IDAT wants.
 *
 * The archive's byte layout was chosen to make this step nearly free: address
 * bytes are already big-endian RGB, row-major, which is byte-for-byte a PNG
 * scanline once a leading filter byte is prepended.
 */

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

export interface DecodedPng {
  width: number;
  height: number;
  bpc: number;
  /** Address-format bytes: row-major, big-endian RGB, no padding, no alpha. */
  pixels: Uint8Array;
}

/**
 * Reads a PNG back to exact bytes.
 *
 * `createImageBitmap` would be shorter, but it hands back 8 bits per channel no
 * matter what the file holds — which silently destroys half of a 48-bit address
 * and, for a plate, destroys the very claim being checked. The archive has to be
 * able to read what it wrote.
 *
 * Scope: truecolour, non-interlaced, 8 or 16 bits. Anything else returns null
 * rather than guessing.
 */
export async function decodePng(buffer: ArrayBuffer): Promise<DecodedPng | null> {
  // The contract is null for anything unreadable. Truncated files, corrupt
  // streams and header rubbish all land in the same try — an earlier version
  // let RangeErrors from the chunk walk escape to the caller, so the interface
  // showed raw exception text for any half-downloaded file.
  try {
    return await decodePngInner(buffer);
  } catch {
    return null;
  }
}

async function decodePngInner(buffer: ArrayBuffer): Promise<DecodedPng | null> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return null;

  const dv = new DataView(buffer);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bpc = 0;
  let colourType = 0;
  let sawEnd = false;
  const idat: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = dv.getUint32(offset, false);
    const body = offset + 8;
    if (body + length + 4 > bytes.length) return null; // chunk runs off the file
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);

    // The CRC is the format's own tamper seal; skipping it would decode a
    // corrupted header into a confidently wrong image.
    if (crc32(bytes.subarray(offset + 4, body + length)) !== dv.getUint32(body + length, false)) {
      return null;
    }

    if (type === 'IHDR') {
      width = dv.getUint32(body, false);
      height = dv.getUint32(body + 4, false);
      bpc = bytes[body + 8];
      colourType = bytes[body + 9];
      if (bytes[body + 10] !== 0 || bytes[body + 12] !== 0) return null; // compression / interlace
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(body, body + length));
    } else if (type === 'IEND') {
      sawEnd = true;
      break;
    }
    offset = body + length + 4;
  }

  // All the pixel data can be present and the file still be cut short: a
  // missing IEND means whatever wrote or copied this stopped early, and a
  // strict reader does not certify it.
  if (!sawEnd) return null;
  if (!width || !height || (bpc !== 8 && bpc !== 16)) return null;
  const channels = colourType === 2 ? 3 : colourType === 6 ? 4 : 0;
  if (channels === 0) return null;

  const sampleBytes = bpc / 8;
  const bpp = channels * sampleBytes; // filter unit
  const rowBytes = width * bpp;
  const expected = height * (rowBytes + 1);
  // Reject impossible geometry before allocating anything for it.
  if (rowBytes > 2 ** 31 || expected > 2 ** 31) return null;

  // Inflate with a ceiling. A small file can declare a tiny image and carry a
  // stream that expands to hundreds of megabytes; reading it through a capped
  // loop means a lying IDAT costs one chunk over budget, not the whole bomb.
  const inflate = new DecompressionStream('deflate') as unknown as ReadableWritablePair<
    Uint8Array,
    Uint8Array
  >;
  const source = new Blob(idat as BlobPart[]).stream() as unknown as ReadableStream<Uint8Array>;
  const reader = source.pipeThrough(inflate).getReader();
  const raw = new Uint8Array(expected);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > expected) {
      void reader.cancel();
      return null; // stream inflates past what the header promises
    }
    raw.set(value, got);
    got += value.length;
  }
  if (got < expected) return null;

  // Undo the per-scanline filters in place, one row at a time.
  const flat = new Uint8Array(height * rowBytes);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    const up = dst - rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? flat[dst + i - bpp] : 0;
      const b = y > 0 ? flat[up + i] : 0;
      const c = y > 0 && i >= bpp ? flat[up + i - bpp] : 0;
      let value: number;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: return null;
      }
      flat[dst + i] = value & 0xff;
    }
  }

  if (channels === 3) return { width, height, bpc, pixels: flat };

  // Drop alpha, keeping the RGB bytes in address order.
  const rgbStride = 3 * sampleBytes;
  const out = new Uint8Array(width * height * rgbStride);
  for (let i = 0, n = width * height; i < n; i++) {
    for (let k = 0; k < rgbStride; k++) out[i * rgbStride + k] = flat[i * bpp + k];
  }
  return { width, height, bpc, pixels: out };
}

export interface PngRequest {
  width: number;
  height: number;
  /** 8 or 16 */
  bpc: number;
  /** Address bytes: row-major, big-endian RGB, no padding. */
  pixels: Uint8Array;
  /** Tag the file as an equirectangular panorama so 360 viewers open it as one. */
  panorama?: boolean;
  onProgress?: (fraction: number) => void;
}

/**
 * The GPano XMP packet, as a PNG iTXt chunk.
 *
 * Metadata only: it sits before IDAT and changes not one pixel byte, so a plate
 * exported as a sphere still verifies exactly. Without it an exported sphere is
 * just a very wide picture; with it, phones and 360 viewers put you inside it.
 */
function panoramaChunk(width: number, height: number): Uint8Array {
  const xmp =
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/" ` +
    `GPano:ProjectionType="equirectangular" ` +
    `GPano:UsePanoramaViewer="True" ` +
    `GPano:CroppedAreaImageWidthPixels="${width}" ` +
    `GPano:CroppedAreaImageHeightPixels="${height}" ` +
    `GPano:FullPanoWidthPixels="${width}" ` +
    `GPano:FullPanoHeightPixels="${height}" ` +
    `GPano:CroppedAreaLeftPixels="0" ` +
    `GPano:CroppedAreaTopPixels="0"/>` +
    `</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

  const keyword = new TextEncoder().encode('XML:com.adobe.xmp');
  const text = new TextEncoder().encode(xmp);
  // keyword \0 compressionFlag compressionMethod language \0 translated \0 text
  const body = new Uint8Array(keyword.length + 5 + text.length);
  body.set(keyword, 0);
  let at = keyword.length;
  body[at++] = 0; // null after keyword
  body[at++] = 0; // uncompressed
  body[at++] = 0; // compression method
  body[at++] = 0; // empty language tag
  body[at++] = 0; // empty translated keyword
  body.set(text, at);
  return chunk('iTXt', body);
}

export async function encodePng(req: PngRequest): Promise<Blob> {
  const { width, height, bpc, pixels } = req;
  const bytesPerPixel = bpc === 16 ? 6 : 3;
  const rowBytes = width * bytesPerPixel;

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = bpc; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Filter type 0 on every row. The archive's contents are incompressible by
  // construction, so predictive filters cost time and buy nothing.
  let row = 0;
  const rawStream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (row >= height) {
        controller.close();
        return;
      }
      // Emit a batch of rows per pull to keep the stream's overhead off the hot path.
      const batch = Math.min(64, height - row);
      const buf = new Uint8Array(batch * (rowBytes + 1));
      for (let i = 0; i < batch; i++) {
        const src = (row + i) * rowBytes;
        const dst = i * (rowBytes + 1);
        buf[dst] = 0;
        buf.set(pixels.subarray(src, src + rowBytes), dst + 1);
      }
      row += batch;
      req.onProgress?.(row / height);
      controller.enqueue(buf);
    },
  });

  // 'deflate' produces an RFC 1950 zlib wrapper, which is exactly what IDAT
  // expects; 'deflate-raw' would omit it and the file would not decode.
  const deflate = new CompressionStream('deflate') as unknown as ReadableWritablePair<
    Uint8Array,
    Uint8Array
  >;
  const compressed = rawStream.pipeThrough(deflate);
  const idatData = new Uint8Array(await new Response(compressed).arrayBuffer());

  // Rendering intent: the archive's channel values are display-encoded codes.
  const srgb = new Uint8Array([0]); // perceptual

  const parts: Uint8Array[] = [SIGNATURE, chunk('IHDR', ihdr), chunk('sRGB', srgb)];
  if (req.panorama) parts.push(panoramaChunk(width, height));
  parts.push(chunk('IDAT', idatData), chunk('IEND', new Uint8Array(0)));
  return new Blob(parts as unknown as BlobPart[], { type: 'image/png' });
}
