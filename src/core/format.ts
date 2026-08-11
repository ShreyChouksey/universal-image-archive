/**
 * Archive formats.
 *
 * An archive is defined by a pixel grid and a colour alphabet. Both must be
 * finite and byte-aligned for the address<->image map to be a clean bijection,
 * so channel depth is 8 or 16 bits — 16 being the deepest well-defined integer
 * colour any mainstream still-image format (PNG, TIFF, EXR-as-half) can carry.
 */

/**
 * How the grid is read.
 *
 * 'plane' is a window — the address is what is visible through a frame pointed
 * one way. 'sphere' is a standpoint — the same bytes read as a 360° × 180°
 * equirectangular field, so the address is everything visible from somewhere.
 * The bytes and the bijection are identical; only the reading differs.
 */
export type Geometry = 'plane' | 'sphere';

export interface Resolution {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly width: number;
  readonly height: number;
  readonly geometry: Geometry;
}

export const RESOLUTIONS: readonly Resolution[] = [
  { id: 'uhd16k', label: '16K', note: '15360 × 8640', width: 15360, height: 8640, geometry: 'plane' },
  { id: 'uhd8k', label: '8K UHD', note: '7680 × 4320', width: 7680, height: 4320, geometry: 'plane' },
  { id: 'uhd5k', label: '5K', note: '5120 × 2880', width: 5120, height: 2880, geometry: 'plane' },
  { id: 'uhd4k', label: '4K UHD', note: '3840 × 2160', width: 3840, height: 2160, geometry: 'plane' },
  { id: 'dci4k', label: 'DCI 4K', note: '4096 × 2160', width: 4096, height: 2160, geometry: 'plane' },
  { id: 'qhd', label: '1440p', note: '2560 × 1440', width: 2560, height: 1440, geometry: 'plane' },
  { id: 'fhd', label: '1080p', note: '1920 × 1080', width: 1920, height: 1080, geometry: 'plane' },
  { id: 'hd', label: '720p', note: '1280 × 720', width: 1280, height: 720, geometry: 'plane' },
  { id: 'sd', label: '480p', note: '854 × 480', width: 854, height: 480, geometry: 'plane' },
  { id: 'px512', label: '512 × 512', note: '262,144 px · 1:1 square', width: 512, height: 512, geometry: 'plane' },
  { id: 'px256', label: '256 × 256', note: '65,536 px · 1:1 square', width: 256, height: 256, geometry: 'plane' },
  { id: 'px128', label: '128 × 128', note: '16,384 px · 1:1 square', width: 128, height: 128, geometry: 'plane' },
  { id: 'px64', label: '64 × 64', note: '4,096 px · 1:1 square', width: 64, height: 64, geometry: 'plane' },
  { id: 'px32', label: '32 × 32', note: '1,024 px · 1:1 square', width: 32, height: 32, geometry: 'plane' },
  { id: 'px16', label: '16 × 16', note: '256 px · 1:1 square', width: 16, height: 16, geometry: 'plane' },
  { id: 'px8', label: '8 × 8', note: '64 px · 1:1 square', width: 8, height: 8, geometry: 'plane' },
  { id: 'px4', label: '4 × 4', note: '16 px · 1:1 square', width: 4, height: 4, geometry: 'plane' },
  { id: 'px2', label: '2 × 2', note: '4 px · 1:1 square', width: 2, height: 2, geometry: 'plane' },

  // Equirectangular, always 2:1 — a full turn of longitude against half a turn
  // of latitude. 8192 is not arbitrary: it is WebGPU's guaranteed
  // maxTextureDimension2D, so it is the largest sphere a conforming device is
  // required to be able to resolve.
  { id: 'sph8k', label: 'Sphere 8K', note: '8192 × 4096', width: 8192, height: 4096, geometry: 'sphere' },
  { id: 'sph6k', label: 'Sphere 6K', note: '6144 × 3072', width: 6144, height: 3072, geometry: 'sphere' },
  { id: 'sph4k', label: 'Sphere 4K', note: '4096 × 2048', width: 4096, height: 2048, geometry: 'sphere' },
  { id: 'sph2k', label: 'Sphere 2K', note: '2048 × 1024', width: 2048, height: 1024, geometry: 'sphere' },
];

export const GEOMETRIES: ReadonlyArray<{ id: Geometry; label: string; note: string }> = [
  { id: 'plane', label: 'Plane', note: 'framed window view' },
  { id: 'sphere', label: 'Sphere', note: '360° standpoint view' },
];

export function resolutionsFor(geometry: Geometry): readonly Resolution[] {
  return RESOLUTIONS.filter((r) => r.geometry === geometry);
}

/**
 * The pixel index is a 32-bit Philox counter word, so a grid may not exceed
 * 2^32 pixels. That is 65536 x 65536 — four orders of magnitude past anything
 * a browser could materialise — but the bound is real, so it is stated.
 */
export const MAX_PIXELS = 2 ** 32;

export interface Depth {
  readonly id: string;
  /** Bits per channel. */
  readonly bpc: 8 | 16;
  readonly label: string;
  readonly note: string;
  /** Bytes of address per pixel (3 channels). */
  readonly bytesPerPixel: 3 | 6;
  /** Largest value a channel can hold. */
  readonly maxChannel: number;
}

export const DEPTHS: readonly Depth[] = [
  {
    id: 'd48',
    bpc: 16,
    label: '48-bit',
    note: '281.47 trillion colours',
    bytesPerPixel: 6,
    maxChannel: 65535,
  },
  {
    id: 'd24',
    bpc: 8,
    label: '24-bit',
    note: '16.78 million colours',
    bytesPerPixel: 3,
    maxChannel: 255,
  },
];

export interface ArchiveFormat {
  readonly resolution: Resolution;
  readonly depth: Depth;
}

/** Named explicitly rather than by index, so reordering the list cannot move it. */
const DEFAULT_RESOLUTION = RESOLUTIONS.find((r) => r.id === 'hd')!;
const DEFAULT_SPHERE = RESOLUTIONS.find((r) => r.id === 'sph4k')!;

export const DEFAULT_FORMAT: ArchiveFormat = {
  resolution: DEFAULT_RESOLUTION,
  depth: DEPTHS[0],
};

/**
 * The grid to land on when switching geometry, or when an id does not resolve.
 */
export function defaultResolutionFor(geometry: Geometry): Resolution {
  return geometry === 'sphere' ? DEFAULT_SPHERE : DEFAULT_RESOLUTION;
}

/**
 * A grid cut to measure. The archive concept is parameterised by its grid, so a
 * picture whose dimensions match nothing listed can simply carry its own — the
 * complete archive of every image at exactly those dimensions. All the
 * arithmetic downstream (cardinality, capacity, addresses, exports) is already
 * generic over width and height; this only gives such a grid a name.
 */
export function customResolution(width: number, height: number): Resolution {
  return {
    id: `c${width}x${height}`,
    label: 'Custom',
    note: `${width} × ${height}`,
    width,
    height,
    geometry: 'plane',
  };
}

const CUSTOM_ID = /^c(\d{1,5})x(\d{1,5})$/;

export function resolutionById(id: string, geometry?: Geometry): Resolution {
  const found = RESOLUTIONS.find((r) => r.id === id);
  if (found && (!geometry || found.geometry === geometry)) return found;

  // Custom grids survive the URL round trip: c900x1600 names the archive of
  // every 900 x 1600 image.
  const custom = CUSTOM_ID.exec(id);
  if (custom && (!geometry || geometry === 'plane')) {
    const width = Number(custom[1]);
    const height = Number(custom[2]);
    if (width > 0 && height > 0 && width * height <= MAX_PIXELS) {
      return customResolution(width, height);
    }
  }
  return defaultResolutionFor(geometry ?? found?.geometry ?? 'plane');
}

export function depthById(id: string): Depth {
  return DEPTHS.find((d) => d.id === id) ?? DEPTHS[0];
}

/** Pixels in one image. */
export function pixelCount(f: ArchiveFormat): number {
  return f.resolution.width * f.resolution.height;
}

/** Bytes in one address. */
export function addressBytes(f: ArchiveFormat): number {
  return pixelCount(f) * f.depth.bytesPerPixel;
}

/** Bits in one address — the log2 of the archive's size. */
export function addressBits(f: ArchiveFormat): number {
  return addressBytes(f) * 8;
}

export function formatKey(f: ArchiveFormat): string {
  return `${f.resolution.id}.${f.depth.id}`;
}

// ---------------------------------------------------------------------------
// What a browser will actually carry
// ---------------------------------------------------------------------------

/**
 * Browsing and materialising have wildly different costs, and only one of them
 * has a ceiling.
 *
 * Browsing costs one shader evaluation per *viewport* pixel. The grid could be
 * a hundred gigapixels and the frame would take the same 1.7 ms, because the
 * image is never allocated — measured flat from 64×64 to 16K UHD.
 *
 * Materialising is where the limits live. An address has to exist as bytes, and
 * showing it needs an RGBA16 texture, and both have to fit:
 *   - neither axis may exceed the GPU's maxTextureDimension2D (16384 in Chrome)
 *   - a single ArrayBuffer tops out near 2 GB
 *   - the tab's heap tops out at 4 GB, and it has to hold both at once
 *
 * Measured on this machine: 4K materialises in 0.6 s, 8K in 2.2 s, 16K UHD in
 * 8.7 s using about 1 GB. Past roughly 250 megapixels there is no headroom left.
 */
export const LIMITS = {
  /** Leave room under the ~2 GB single-ArrayBuffer cap. */
  maxSingleAllocation: 1_800_000_000,
  /** Address bytes plus texture bytes must both fit in the heap at once. */
  maxCombined: 3_000_000_000,
  /** Fallback when the backend does not report one. */
  defaultMaxTextureDimension: 16384,
} as const;

export interface FormatCapacity {
  /** False when this grid can be browsed but never resolved to an address. */
  materialisable: boolean;
  /** Why not, in words a person can act on. Empty when materialisable. */
  reason: string;
  addressBytes: number;
  textureBytes: number;
}

export function formatCapacity(f: ArchiveFormat, maxTextureDimension: number): FormatCapacity {
  const px = pixelCount(f);
  const address = addressBytes(f);
  const texture = px * 8; // RGBA16
  const longestAxis = Math.max(f.resolution.width, f.resolution.height);

  let reason = '';
  if (px > MAX_PIXELS) {
    reason = `A grid may not exceed ${MAX_PIXELS.toLocaleString()} pixels.`;
  } else if (longestAxis > maxTextureDimension) {
    reason = `Resolving needs a texture, and this GPU stops at ${maxTextureDimension.toLocaleString()} pixels on an axis. Browsing is unaffected.`;
  } else if (address > LIMITS.maxSingleAllocation || texture > LIMITS.maxSingleAllocation) {
    reason = 'Resolving would need a single allocation larger than a browser will grant. Browsing is unaffected.';
  } else if (address + texture > LIMITS.maxCombined) {
    reason = 'Resolving would exceed the memory this tab can hold. Browsing is unaffected.';
  }

  return { materialisable: reason === '', reason, addressBytes: address, textureBytes: texture };
}
