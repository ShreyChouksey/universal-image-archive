/**
 * 3D Volumetric & Gaussian Splatting Stateless Primitive Core.
 *
 * Extends the archive's stateless bijection from 2D pixel matrices to 3D scene
 * representations. Evaluates Philox 4x32 statelessly over 3D Gaussian primitive
 * indices to generate 3D point parameters (Position, Scale, Quaternion, Color).
 */

import { philox4x32, philoxScratch, type Seed } from './philox';
import type { ArchiveFormat } from './format';
import { pixelCount } from './format';

export interface GaussianSplatPrimitive {
  id: number;
  position: [number, number, number];
  scale: [number, number, number];
  rotation: [number, number, number, number]; // [qw, qx, qy, qz]
  color: [number, number, number, number]; // [r, g, b, a] in [0, 1]
}

export interface SplatScene {
  seed: Seed;
  formatKey: string;
  primitives: GaussianSplatPrimitive[];
  count: number;
}

/**
 * Derives a 3D Gaussian Primitive statelessly from a 128-bit seed and primitive index.
 */
export function sampleGaussianSplat(
  seed: Seed,
  index: number,
  rounds = 12,
): GaussianSplatPrimitive {
  const scratch = philoxScratch();
  
  // Pass 1: Position and Scale
  philox4x32(scratch, index >>> 0, (index / 0x100000000) >>> 0, seed[2], seed[3], seed[0], seed[1], rounds);
  const u0 = scratch[0] / 4294967296;
  const u1 = scratch[1] / 4294967296;
  const u2 = scratch[2] / 4294967296;
  const u3 = scratch[3] / 4294967296;

  // Position mapped to [-10, 10]
  const px = (u0 - 0.5) * 20;
  const py = (u1 - 0.5) * 20;
  const pz = (u2 - 0.5) * 20;
  const sx = 0.05 + u3 * 0.95;

  // Pass 2: Scale (sy, sz), Quaternion, and Color
  philox4x32(scratch, (index ^ 0x5a5a5a5a) >>> 0, 1, seed[2], seed[3], seed[0], seed[1], rounds);
  const v0 = scratch[0] / 4294967296;
  const v1 = scratch[1] / 4294967296;
  const v2 = scratch[2] / 4294967296;
  const v3 = scratch[3] / 4294967296;

  const sy = 0.05 + v0 * 0.95;
  const sz = 0.05 + v1 * 0.95;

  // Unit quaternion derivation
  const q0 = (v2 - 0.5) * 2;
  const q1 = (v3 - 0.5) * 2;
  const q2 = (u0 - 0.5) * 2;
  const q3 = (u1 - 0.5) * 2;
  const qlen = Math.hypot(q0, q1, q2, q3) || 1;

  // Pass 3: Colors (r, g, b, alpha)
  philox4x32(scratch, (index ^ 0xa5a5a5a5) >>> 0, 2, seed[2], seed[3], seed[0], seed[1], rounds);
  const cr = (scratch[0] & 0xffff) / 65535;
  const cg = (scratch[1] & 0xffff) / 65535;
  const cb = (scratch[2] & 0xffff) / 65535;
  const ca = 0.2 + ((scratch[3] & 0xff) / 255) * 0.8;

  return {
    id: index,
    position: [px, py, pz],
    scale: [sx, sy, sz],
    rotation: [q0 / qlen, q1 / qlen, q2 / qlen, q3 / qlen],
    color: [cr, cg, cb, ca],
  };
}

/**
 * Generates a complete 3D Gaussian Splatting scene statelessly for a given format and seed.
 */
export function generateSplatScene(
  format: ArchiveFormat,
  seed: Seed,
  maxPrimitives = 1024,
  rounds = 12,
): SplatScene {
  const total = Math.min(maxPrimitives, pixelCount(format));
  const primitives: GaussianSplatPrimitive[] = new Array(total);
  for (let i = 0; i < total; i++) {
    primitives[i] = sampleGaussianSplat(seed, i, rounds);
  }
  return {
    seed,
    formatKey: `${format.resolution.id}.${format.depth.id}`,
    primitives,
    count: total,
  };
}
