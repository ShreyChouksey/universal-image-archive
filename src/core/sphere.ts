/**
 * The sphere.
 *
 * A plane grid is a window: an address is everything visible through a frame
 * pointed one way. A sphere grid is a standpoint: the same bytes read as a full
 * 360° × 180° equirectangular field, so an address is not a picture you look at
 * but a place you look *from*, and every byte of it is somewhere around you.
 *
 * The bytes are unchanged — same row-major order, same big-endian channels, same
 * bijection. Only the reading of the grid differs, which is why geometry belongs
 * to the format and not to the address.
 *
 * This module is the single normative projection. The WGSL and GLSL ports are
 * transcriptions of it, and `probeSphere()` in the renderer reads pixels back off
 * the GPU and checks them against this code — because a wrong projection over a
 * field of noise looks exactly like a right one.
 */

export interface Look {
  /** Radians, 0 = +z, increasing to the right. */
  yaw: number;
  /** Radians, positive is up, clamped to ±π/2. */
  pitch: number;
  /** Vertical field of view, radians. */
  fov: number;
}

export const DEFAULT_FOV = Math.PI / 2; // 90°, a natural standing view
export const MIN_FOV = 0.5 * (Math.PI / 180); // 0.5°, deep into one texel
export const MAX_FOV = 140 * (Math.PI / 180);

/**
 * Direction a screen position looks in.
 *
 * `ndcX`/`ndcY` are in [-1, 1] with y up. The camera looks down +z at identity,
 * x to the right, y up.
 */
export function directionFor(
  ndcX: number,
  ndcY: number,
  aspect: number,
  look: Look,
): [number, number, number] {
  const tanHalf = Math.tan(look.fov / 2);
  let x = ndcX * aspect * tanHalf;
  let y = ndcY * tanHalf;
  let z = 1;

  const inv = 1 / Math.hypot(x, y, z);
  x *= inv;
  y *= inv;
  z *= inv;

  // Pitch about x, then yaw about y.
  const cp = Math.cos(look.pitch);
  const sp = Math.sin(look.pitch);
  const y1 = y * cp - z * sp;
  const z1 = y * sp + z * cp;

  const cy = Math.cos(look.yaw);
  const sy = Math.sin(look.yaw);
  return [x * cy + z1 * sy, y1, -x * sy + z1 * cy];
}

/** Equirectangular texel a direction lands on. Longitude wraps, latitude clamps. */
export function texelFor(
  dir: readonly [number, number, number],
  width: number,
  height: number,
): { x: number; y: number; lon: number; lat: number } {
  const lon = Math.atan2(dir[0], dir[2]); // [-π, π]
  const lat = Math.asin(Math.max(-1, Math.min(1, dir[1]))); // [-π/2, π/2]

  let x = Math.floor(((lon + Math.PI) / (2 * Math.PI)) * width);
  let y = Math.floor(((Math.PI / 2 - lat) / Math.PI) * height);
  x = ((x % width) + width) % width;
  y = Math.max(0, Math.min(height - 1, y));
  return { x, y, lon, lat };
}

/** Screen position (device pixels) to the equirect texel under it. */
export function screenToTexel(
  px: number,
  py: number,
  viewW: number,
  viewH: number,
  width: number,
  height: number,
  look: Look,
): { x: number; y: number; lon: number; lat: number } {
  const ndcX = ((px + 0.5) / viewW) * 2 - 1;
  const ndcY = 1 - ((py + 0.5) / viewH) * 2;
  return texelFor(directionFor(ndcX, ndcY, viewW / viewH, look), width, height);
}

/** Centre of an equirect texel, as a unit direction. Inverse of `texelFor`. */
export function directionOfTexel(
  x: number,
  y: number,
  width: number,
  height: number,
): [number, number, number] {
  const lon = ((x + 0.5) / width) * 2 * Math.PI - Math.PI;
  const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI;
  const cl = Math.cos(lat);
  return [cl * Math.sin(lon), Math.sin(lat), cl * Math.cos(lon)];
}

// ---------------------------------------------------------------------------
// What a sphere costs, in the units people actually care about
// ---------------------------------------------------------------------------

/** Arcminutes per texel along the equator, where the grid is densest in angle. */
export function arcminPerTexel(width: number): number {
  return (360 / width) * 60;
}

/**
 * The projection's debit.
 *
 * Equirectangular samples at a density proportional to 1/cos(latitude), so rows
 * near the poles carry far more texels per unit of solid angle than rows at the
 * equator. Integrating cos over the sphere against a uniform grid gives
 * (1/π)∫cos φ dφ = 2/π: only about 64% of an address is doing distinct work, and
 * the rest is the projection's redundancy rather than the archive's content.
 *
 * Stated plainly here, and printed in the interface, because hiding it would make
 * the sphere look like a free upgrade when it is a trade.
 */
export const EQUAL_AREA_EFFICIENCY = 2 / Math.PI;

/** Angular resolution of a flat frame, for the comparison the UI has to make. */
export function planeArcminPerPixel(width: number, horizontalFov = DEFAULT_FOV): number {
  return ((horizontalFov * 180) / Math.PI / width) * 60;
}
