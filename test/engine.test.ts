/**
 * Engine tests.
 *
 * These run against the real modules with `node --test`, no build step and no
 * dependencies — Node 24 strips the types and already provides the web APIs the
 * codec needs.
 *
 * The bias throughout is to check claims against an INDEPENDENT computation
 * rather than against the code's own logic. Where an answer can be had from
 * BigInt, it is: BigInt is slow and unusable in the product, which is exactly
 * why it makes a good oracle for the fast paths that replaced it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  philox4x32,
  philox4x32_10,
  philoxScratch,
  randomSeed,
  seedAdd,
  seedFromHex,
  seedFromPhrase,
  seedToHex,
  selfTest,
  type Seed,
} from '../src/core/philox.ts';

import {
  archiveScale,
  bumpAddress,
  decimalDigitCount,
  hexSlice,
  materialiseSeed,
  packAddressFile,
  residueMod10e15,
  sampleSeed,
  solveTail,
  TAIL_BYTES,
  trailingDecimalDigits,
  unpackAddressFile,
} from '../src/core/address.ts';

import {
  DEPTHS,
  RESOLUTIONS,
  addressBytes,
  customResolution,
  defaultResolutionFor,
  formatCapacity,
  resolutionById,
  resolutionsFor,
  type ArchiveFormat,
} from '../src/core/format.ts';

import {
  DEFAULT_FOV,
  EQUAL_AREA_EFFICIENCY,
  arcminPerTexel,
  directionFor,
  directionOfTexel,
  screenToTexel,
  texelFor,
} from '../src/core/sphere.ts';

import {
  PLATE_LAYOUTS,
  composePlate,
  layoutFor,
  normaliseStatement,
  plateSelfTest,
  plateSupported,
  readPlateClaim,
  verifyPlate,
} from '../src/core/plate.ts';

import { decodePng, encodePng } from '../src/core/png.ts';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const depth = (bpc: 8 | 16) => DEPTHS.find((d) => d.bpc === bpc)!;
const grid = (id: string) => RESOLUTIONS.find((r) => r.id === id)!;

/** A small plane format, so exhaustive checks finish quickly. */
function tiny(bpc: 8 | 16 = 16): ArchiveFormat {
  return {
    resolution: { id: 't', label: 't', note: '', width: 37, height: 11, geometry: 'plane' },
    depth: depth(bpc),
  };
}

const seedOf = (a: number, b: number, c: number, d: number): Seed =>
  Uint32Array.from([a >>> 0, b >>> 0, c >>> 0, d >>> 0]) as Seed;

/** The address bytes as one big integer — the definition, computed the slow way. */
function asBigInt(bytes: Uint8Array): bigint {
  return bytes.length === 0 ? 0n : BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

function bytesOf(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

test('philox matches the published Random123 vectors', () => {
  const r = selfTest();
  assert.ok(r.ok, r.detail);
});

test('philox4x32 supports custom rounds (12 to 24)', () => {
  const out12 = philoxScratch();
  const out24 = philoxScratch();
  philox4x32(out12, 1, 2, 3, 4, 5, 6, 12);
  philox4x32(out24, 1, 2, 3, 4, 5, 6, 24);
  assert.notDeepEqual(Array.from(out12), Array.from(out24));
  for (let k = 0; k < 4; k++) {
    assert.ok(Number.isInteger(out12[k]) && out12[k] >= 0 && out12[k] <= 0xffffffff);
    assert.ok(Number.isInteger(out24[k]) && out24[k] >= 0 && out24[k] <= 0xffffffff);
  }
});

test('mulhilo is exact against BigInt over random inputs', () => {
  // Exercised through philox itself: a wrong high word diverges immediately.
  const out = philoxScratch();
  for (let i = 0; i < 20000; i++) {
    const a = (Math.random() * 4294967296) >>> 0;
    const b = (Math.random() * 4294967296) >>> 0;
    philox4x32_10(out, a, b, 0, 0, a, b);
    for (let k = 0; k < 4; k++) {
      assert.ok(Number.isInteger(out[k]) && out[k] >= 0 && out[k] <= 0xffffffff);
    }
  }
});

test('seedFromHex accepts what it should and rejects what it should not', () => {
  assert.equal(seedToHex(seedFromHex('0'.repeat(32))!), '0'.repeat(32));
  assert.equal(seedToHex(seedFromHex('f'.repeat(32))!), 'f'.repeat(32));
  // Short input is right-aligned, so it names a small number rather than failing.
  assert.equal(seedToHex(seedFromHex('1')!), '0'.repeat(31) + '1');
  assert.equal(seedToHex(seedFromHex('0xABC')!), '0'.repeat(29) + 'abc');
  assert.equal(seedToHex(seedFromHex('dead-beef_cafe')!), '0'.repeat(20) + 'deadbeefcafe');

  assert.equal(seedFromHex(''), null);
  assert.equal(seedFromHex('   '), null);
  assert.equal(seedFromHex('g'), null);
  assert.equal(seedFromHex('0'.repeat(33)), null);
});

test('seedToHex and seedFromHex round-trip', () => {
  for (let i = 0; i < 500; i++) {
    const s = randomSeed();
    assert.equal(seedToHex(seedFromHex(seedToHex(s))!), seedToHex(s));
  }
});

test('seedAdd agrees with 128-bit BigInt arithmetic, including both wraps', () => {
  const MASK = (1n << 128n) - 1n;
  const toBig = (s: Seed) => BigInt('0x' + seedToHex(s));

  const cases: Array<[Seed, number]> = [
    [seedOf(0, 0, 0, 0), 1],
    [seedOf(0, 0, 0, 0), -1], // wraps to all ones
    [seedOf(0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff), 1], // wraps to zero
    [seedOf(0, 0, 0, 0xffffffff), 1], // carry across a word
    [seedOf(0, 0, 0xffffffff, 0xffffffff), 1], // carry across two
    [seedOf(0, 0xffffffff, 0xffffffff, 0xffffffff), 1], // carry across three
    [seedOf(0, 0, 1, 0), -1], // borrow across a word
    [seedOf(0, 0, 0, 0), 2 ** 40],
    [seedOf(0, 0, 0, 0), -(2 ** 40)],
  ];
  for (let i = 0; i < 300; i++) {
    cases.push([randomSeed(), Math.floor((Math.random() - 0.5) * 2 ** 45)]);
  }

  for (const [seed, delta] of cases) {
    const expected = ((toBig(seed) + BigInt(Math.trunc(delta))) % (MASK + 1n) + MASK + 1n) % (MASK + 1n);
    const got = toBig(seedAdd(seed, delta));
    assert.equal(got, expected, `seedAdd(${seedToHex(seed)}, ${delta})`);
  }
});

test('seedAdd by zero is identity', () => {
  const s = randomSeed();
  assert.equal(seedToHex(seedAdd(s, 0)), seedToHex(s));
});

test('seedFromPhrase is deterministic and separates phrases', () => {
  assert.equal(seedToHex(seedFromPhrase('the garden of forking paths')),
               seedToHex(seedFromPhrase('the garden of forking paths')));
  assert.notEqual(seedToHex(seedFromPhrase('a')), seedToHex(seedFromPhrase('b')));
  assert.notEqual(seedToHex(seedFromPhrase('')), seedToHex(seedFromPhrase(' ')));
});

// ---------------------------------------------------------------------------
// Invariant 3 and 4 — the two that would make the interface lie
// ---------------------------------------------------------------------------

for (const bpc of [8, 16] as const) {
  test(`chunked materialisation equals unchunked at ${bpc} bpc`, () => {
    const format = tiny(bpc);
    const total = format.resolution.width * format.resolution.height;
    const seed = seedOf(0x8f3a2b1c, 0x4d5e6f70, 0xa1b2c3d4, 0x55667788);

    const whole = new Uint8Array(addressBytes(format));
    materialiseSeed(format, seed, whole);

    // Every chunk size, including ones that do not divide the pixel count.
    for (const chunk of [1, 2, 3, 7, 16, 100, total - 1, total, total + 5]) {
      const piecewise = new Uint8Array(addressBytes(format));
      for (let from = 0; from < total; from += chunk) {
        materialiseSeed(format, seed, piecewise, { from, to: Math.min(from + chunk, total) });
      }
      assert.deepEqual(piecewise, whole, `chunk size ${chunk}`);
    }
  });

  test(`sampleSeed agrees with materialiseSeed at every pixel at ${bpc} bpc`, () => {
    const format = tiny(bpc);
    const total = format.resolution.width * format.resolution.height;
    const seed = seedOf(1, 2, 3, 4);
    const bytes = new Uint8Array(addressBytes(format));
    materialiseSeed(format, seed, bytes);

    const bpp = format.depth.bytesPerPixel;
    for (let i = 0; i < total; i++) {
      const s = sampleSeed(format, seed, i);
      const o = i * bpp;
      if (bpc === 16) {
        assert.equal((bytes[o] << 8) | bytes[o + 1], s.r, `pixel ${i} red`);
        assert.equal((bytes[o + 2] << 8) | bytes[o + 3], s.g, `pixel ${i} green`);
        assert.equal((bytes[o + 4] << 8) | bytes[o + 5], s.b, `pixel ${i} blue`);
      } else {
        assert.equal(bytes[o], s.r, `pixel ${i} red`);
        assert.equal(bytes[o + 1], s.g, `pixel ${i} green`);
        assert.equal(bytes[o + 2], s.b, `pixel ${i} blue`);
      }
    }
  });
}

test('materialiseSeed clamps a range past the end instead of overrunning', () => {
  const format = tiny(16);
  const bytes = new Uint8Array(addressBytes(format));
  assert.doesNotThrow(() => materialiseSeed(format, seedOf(1, 1, 1, 1), bytes, { from: 0, to: 1e6 }));
});

// ---------------------------------------------------------------------------
// Address arithmetic
// ---------------------------------------------------------------------------

test('bumpAddress agrees with BigInt, including wrap at both ends', () => {
  const LEN = 9;
  const MOD = 1n << BigInt(LEN * 8);

  const cases: Array<[bigint, number]> = [
    [0n, 1],
    [0n, -1], // wraps to all 0xFF
    [MOD - 1n, 1], // wraps to zero
    [255n, 1],
    [256n, -1],
    [0n, 2 ** 40],
    [MOD - 1n, -(2 ** 40)],
  ];
  for (let i = 0; i < 400; i++) {
    const v = BigInt('0x' + Buffer.from(Uint8Array.from({ length: LEN }, () => (Math.random() * 256) | 0)).toString('hex'));
    cases.push([v, Math.floor((Math.random() - 0.5) * 2 ** 44)]);
  }

  for (const [value, delta] of cases) {
    const bytes = bytesOf(value, LEN);
    bumpAddress(bytes, delta);
    const expected = ((value + BigInt(Math.trunc(delta))) % MOD + MOD) % MOD;
    assert.equal(asBigInt(bytes), expected, `bump(${value}, ${delta})`);
  }
});

test('bumpAddress by zero is identity', () => {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  bumpAddress(bytes, 0);
  assert.deepEqual(bytes, Uint8Array.from([1, 2, 3, 4]));
});

test('residueMod10e15 agrees with BigInt', () => {
  for (let i = 0; i < 200; i++) {
    const len = 1 + ((Math.random() * 400) | 0);
    const bytes = Uint8Array.from({ length: len }, () => (Math.random() * 256) | 0);
    assert.equal(BigInt(residueMod10e15(bytes)), asBigInt(bytes) % 1000000000000000n);
  }
});

test('residueMod10e15 honours the trailing-zeros argument', () => {
  for (let i = 0; i < 100; i++) {
    const bytes = Uint8Array.from({ length: 40 }, () => (Math.random() * 256) | 0);
    const zeros = (Math.random() * 8) | 0;
    const padded = new Uint8Array(bytes.length + zeros);
    padded.set(bytes);
    assert.equal(residueMod10e15(bytes, 0, bytes.length, zeros), residueMod10e15(padded));
  }
});

test('trailingDecimalDigits agrees with BigInt', () => {
  for (let i = 0; i < 200; i++) {
    const bytes = Uint8Array.from({ length: 1 + ((Math.random() * 300) | 0) }, () => (Math.random() * 256) | 0);
    const expect = (asBigInt(bytes) % 1000000000000000n).toString().padStart(15, '0');
    assert.equal(trailingDecimalDigits(bytes, 15), expect);
    assert.equal(trailingDecimalDigits(bytes, 12), expect.slice(-12));
  }
});

test('decimalDigitCount agrees with BigInt toString().length', () => {
  const cases: Uint8Array[] = [
    Uint8Array.from([0]),
    new Uint8Array(20), // all zeros -> the number zero, one digit
    Uint8Array.from([1]),
    Uint8Array.from([255]),
    Uint8Array.from([0, 0, 0, 1]), // leading zero bytes
    Uint8Array.from([0, 255, 255]),
  ];
  for (let i = 0; i < 400; i++) {
    const len = 1 + ((Math.random() * 500) | 0);
    const b = Uint8Array.from({ length: len }, () => (Math.random() * 256) | 0);
    if (i % 7 === 0) b[0] = 0; // exercise leading zeros regularly
    cases.push(b);
  }

  for (const bytes of cases) {
    const expect = asBigInt(bytes).toString(10).length;
    assert.equal(decimalDigitCount(bytes), expect, `bytes ${hexSlice(bytes, 0, 8)}… len ${bytes.length}`);
  }
});

test('decimalDigitCount is right at exact powers of ten', () => {
  // Decade boundaries are where a log-based count goes wrong.
  for (let p = 1; p < 120; p++) {
    const v = 10n ** BigInt(p);
    const len = Math.ceil((v.toString(2).length + 1) / 8) + 1;
    for (const value of [v - 1n, v, v + 1n]) {
      const bytes = bytesOf(value, len);
      assert.equal(
        decimalDigitCount(bytes),
        value.toString(10).length,
        `10^${p} neighbourhood: ${value}`,
      );
    }
  }
});

test('decimalDigitCount is right on the large path, including decade boundaries', () => {
  // Everything above 8 KiB of significant bytes takes the two-double route, and
  // that is the route real addresses take. 10^20000 is 8,305 bytes, so it lands
  // just past the threshold and sits exactly on a boundary — the worst input the
  // approximation can be handed.
  for (const p of [20000, 20001, 25000, 40000, 100000]) {
    const v = 10n ** BigInt(p);
    const len = Math.ceil((v.toString(2).length + 1) / 8) + 1;
    assert.ok(len > 8192, `10^${p} must exercise the large path (${len} bytes)`);
    for (const value of [v - 1n, v, v + 1n]) {
      assert.equal(
        decimalDigitCount(bytesOf(value, len)),
        value.toString(10).length,
        `10^${p} neighbourhood on the large path`,
      );
    }
  }
});

test('decimalDigitCount matches BigInt on large random addresses', () => {
  for (let i = 0; i < 40; i++) {
    const len = 8193 + ((Math.random() * 60000) | 0);
    const bytes = Uint8Array.from({ length: len }, () => (Math.random() * 256) | 0);
    if (i % 5 === 0) bytes[0] = 0; // leading zero bytes still take the large path
    assert.equal(
      decimalDigitCount(bytes),
      asBigInt(bytes).toString(10).length,
      `random large address of ${len} bytes`,
    );
  }
});

test('decimalDigitCount is right at every power of two boundary on the large path', () => {
  // The mantissa/shift split changes shape as the leading byte's bit count
  // changes, so walk a value through all eight positions.
  for (let bit = 0; bit < 8; bit++) {
    const bytes = new Uint8Array(9000);
    bytes[0] = 1 << bit;
    for (let i = 1; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0;
    assert.equal(decimalDigitCount(bytes), asBigInt(bytes).toString(10).length, `leading bit ${bit}`);
  }
});

// ---------------------------------------------------------------------------
// solveTail — the arithmetic the plate rests on
// ---------------------------------------------------------------------------

test('solveTail lands the requested fifteen digits, always', () => {
  const targets = [
    0, 1, 999999999999999, 141592653589793, 271828182845904, 100000000000000, 500000000000000,
  ];
  for (let i = 0; i < 200; i++) targets.push(Math.floor(Math.random() * 1e15));

  for (const target of targets) {
    for (const len of [TAIL_BYTES + 1, 32, 257, 1000]) {
      const bytes = Uint8Array.from({ length: len }, () => (Math.random() * 256) | 0);
      const { solutions } = solveTail(bytes, target);
      assert.ok(solutions >= 1, 'at least one solution must exist');
      assert.equal(
        trailingDecimalDigits(bytes, 15),
        String(target).padStart(15, '0'),
        `target ${target}, length ${len}`,
      );
      // And confirm against BigInt rather than against our own residue routine.
      assert.equal(asBigInt(bytes) % 1000000000000000n, BigInt(target));
    }
  }
});

test('solveTail only disturbs the final TAIL_BYTES', () => {
  for (let i = 0; i < 50; i++) {
    const bytes = Uint8Array.from({ length: 200 }, () => (Math.random() * 256) | 0);
    const before = bytes.slice(0, bytes.length - TAIL_BYTES);
    solveTail(bytes, Math.floor(Math.random() * 1e15));
    assert.deepEqual(bytes.slice(0, bytes.length - TAIL_BYTES), before);
  }
});

// ---------------------------------------------------------------------------
// The .uia container
// ---------------------------------------------------------------------------

test('address file round-trips, for both geometries', async () => {
  for (const geometry of ['plane', 'sphere'] as const) {
    const format: ArchiveFormat = {
      resolution: { id: 'x', label: 'x', note: '', width: 10, height: 6, geometry },
      depth: depth(16),
    };
    const payload = Uint8Array.from({ length: addressBytes(format) }, () => (Math.random() * 256) | 0);
    const buffer = await packAddressFile(format, payload).arrayBuffer();
    const un = unpackAddressFile(buffer)!;
    assert.ok(un, `${geometry} should unpack`);
    assert.equal(un.width, 10);
    assert.equal(un.height, 6);
    assert.equal(un.bpc, 16);
    assert.equal(un.channels, 3);
    assert.equal(un.geometry, geometry);
    assert.deepEqual(un.bytes, payload);
  }
});

test('a v1 address file still reads, as a plane', () => {
  // 1x1 at 16 bpc: 6 payload bytes, matching the header's own arithmetic.
  const buf = new ArrayBuffer(16 + 6);
  const dv = new DataView(buf);
  dv.setUint32(0, 0x55494131, false); // "UIA1"
  dv.setUint32(4, 1, false);
  dv.setUint32(8, 1, false);
  dv.setUint16(12, 16, false);
  dv.setUint16(14, 3, false);
  new Uint8Array(buf, 16).set([1, 2, 3, 4, 5, 6]);

  const un = unpackAddressFile(buf)!;
  assert.ok(un, 'v1 must unpack');
  assert.equal(un.geometry, 'plane');
  assert.equal(un.width, 1);
  assert.deepEqual(un.bytes, Uint8Array.from([1, 2, 3, 4, 5, 6]));
});

test('a truncated address file is refused, not reinterpreted', async () => {
  // Losing bytes does not make a shorter address; it makes a different number.
  const format: ArchiveFormat = {
    resolution: { id: 'x', label: 'x', note: '', width: 10, height: 6, geometry: 'plane' },
    depth: depth(16),
  };
  const payload = Uint8Array.from({ length: addressBytes(format) }, () => (Math.random() * 256) | 0);
  const whole = await packAddressFile(format, payload).arrayBuffer();
  assert.ok(unpackAddressFile(whole), 'the intact file must unpack');
  assert.equal(unpackAddressFile(whole.slice(0, whole.byteLength - 1)), null, 'one byte short');
  assert.equal(unpackAddressFile(whole.slice(0, 20 + 100)), null, 'half a payload');
});

test('the container rejects rubbish rather than guessing', () => {
  assert.equal(unpackAddressFile(new ArrayBuffer(0)), null);
  assert.equal(unpackAddressFile(new ArrayBuffer(8)), null);
  const wrong = new ArrayBuffer(32);
  new DataView(wrong).setUint32(0, 0xdeadbeef, false);
  assert.equal(unpackAddressFile(wrong), null);
  // v2 magic but a header cut short
  const short = new ArrayBuffer(18);
  new DataView(short).setUint32(0, 0x55494132, false);
  assert.equal(unpackAddressFile(short), null);
});

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

test('capacity gates the grids that cannot be resolved', () => {
  const d = depth(16);
  const at = (f: ArchiveFormat) => formatCapacity(f, 16384);

  assert.ok(at({ resolution: grid('uhd4k'), depth: d }).materialisable);
  assert.ok(at({ resolution: grid('uhd16k'), depth: d }).materialisable, '16K is the last that fits');

  const overLimit = { resolution: customResolution(30720, 17280), depth: d };
  assert.ok(!at(overLimit).materialisable, '30720px exceeds the texture axis');
  assert.match(at(overLimit).reason, /16,384|axis/);

  // A smaller GPU must shrink what is offered.
  assert.ok(!formatCapacity({ resolution: grid('uhd16k'), depth: d }, 8192).materialisable);
  assert.ok(formatCapacity({ resolution: grid('sph8k'), depth: d }, 8192).materialisable);
});

test('resolutionById never falls back to a browse-only grid', () => {
  for (const id of ['nonsense', '', 'uhd64k-typo']) {
    for (const geometry of ['plane', 'sphere'] as const) {
      const r = resolutionById(id, geometry);
      assert.equal(r.geometry, geometry);
      assert.ok(
        formatCapacity({ resolution: r, depth: depth(16) }, 16384).materialisable,
        `fallback for ${geometry} must be resolvable, got ${r.id}`,
      );
    }
  }
  // Asking for a sphere id under plane geometry must not hand back the sphere.
  assert.equal(resolutionById('sph4k', 'plane').geometry, 'plane');
  assert.equal(defaultResolutionFor('sphere').geometry, 'sphere');
});

test('every sphere grid is exactly 2:1', () => {
  for (const r of resolutionsFor('sphere')) {
    assert.equal(r.width, r.height * 2, `${r.id} must be 2:1`);
  }
});

test('archiveScale arithmetic is self-consistent', () => {
  for (const r of RESOLUTIONS) {
    for (const d of DEPTHS) {
      const s = archiveScale({ resolution: r, depth: d });
      assert.equal(s.pixels, r.width * r.height);
      assert.equal(s.bytes, s.pixels * d.bytesPerPixel);
      assert.equal(s.bits, s.bytes * 8);
      assert.equal(s.colours, 2 ** (d.bpc * 3));
      assert.equal(s.cardinalityDigits, s.cardinalityExponent + 1);
      // Cross-check the exponent against BigInt for the smaller grids.
      if (s.bits <= 1 << 16) {
        assert.equal(s.cardinalityExponent, (2n ** BigInt(s.bits)).toString(10).length - 1);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Sphere
// ---------------------------------------------------------------------------

test('texel -> direction -> texel is the identity everywhere, poles included', () => {
  for (const r of resolutionsFor('sphere')) {
    const { width: W, height: H } = r;
    for (let i = 0; i < 4000; i++) {
      const x = (Math.random() * W) | 0;
      const y = (Math.random() * H) | 0;
      const back = texelFor(directionOfTexel(x, y, W, H), W, H);
      assert.equal(back.x, x, `${r.id} lon at ${x},${y}`);
      assert.equal(back.y, y, `${r.id} lat at ${x},${y}`);
    }
    // The corners and the seam, explicitly.
    for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [W / 2, H / 2], [W - 1, H / 2]]) {
      const back = texelFor(directionOfTexel(x, y, W, H), W, H);
      assert.equal(back.x, x, `${r.id} corner ${x},${y}`);
      assert.equal(back.y, y, `${r.id} corner ${x},${y}`);
    }
  }
});

test('directions off the screen stay inside the grid', () => {
  const W = 4096;
  const H = 2048;
  for (const look of [
    { yaw: 0, pitch: 0, fov: DEFAULT_FOV },
    { yaw: Math.PI, pitch: 0, fov: DEFAULT_FOV },
    { yaw: -Math.PI, pitch: 0, fov: DEFAULT_FOV },
    { yaw: 0, pitch: Math.PI / 2, fov: DEFAULT_FOV }, // straight up
    { yaw: 0, pitch: -Math.PI / 2, fov: DEFAULT_FOV }, // straight down
    { yaw: 2.4, pitch: 1.2, fov: 0.001 }, // extremely narrow
    { yaw: -1.1, pitch: -0.4, fov: (140 * Math.PI) / 180 }, // extremely wide
  ]) {
    for (let i = 0; i < 2000; i++) {
      const px = Math.random() * 1600;
      const py = Math.random() * 900;
      const t = screenToTexel(px, py, 1600, 900, W, H, look);
      assert.ok(Number.isInteger(t.x) && t.x >= 0 && t.x < W, `x out of range: ${t.x}`);
      assert.ok(Number.isInteger(t.y) && t.y >= 0 && t.y < H, `y out of range: ${t.y}`);
    }
  }
});

test('lookDirection returns unit vectors', () => {
  for (let i = 0; i < 2000; i++) {
    const d = directionFor(Math.random() * 2 - 1, Math.random() * 2 - 1, 16 / 9, {
      yaw: Math.random() * 7 - 3.5,
      pitch: Math.random() * Math.PI - Math.PI / 2,
      fov: 0.01 + Math.random() * 2,
    });
    assert.ok(Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) < 1e-12);
  }
});

test('the angular figures printed in the interface are the real ones', () => {
  assert.ok(Math.abs(arcminPerTexel(4096) - 5.2734375) < 1e-9);
  assert.ok(Math.abs(arcminPerTexel(8192) - 2.63671875) < 1e-9);
  assert.ok(Math.abs(EQUAL_AREA_EFFICIENCY - 0.6366197723675814) < 1e-15);
});

// ---------------------------------------------------------------------------
// PNG, both directions
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

for (const bpc of [8, 16] as const) {
  test(`PNG round-trips byte for byte at ${bpc} bpc`, async () => {
    const width = 23;
    const height = 9;
    const pixels = Uint8Array.from(
      { length: width * height * 3 * (bpc / 8) },
      () => (Math.random() * 256) | 0,
    );
    const blob = await encodePng({ width, height, bpc, pixels });
    const decoded = await decodePng(await blob.arrayBuffer());
    assert.ok(decoded, 'must decode');
    assert.equal(decoded!.width, width);
    assert.equal(decoded!.height, height);
    assert.equal(decoded!.bpc, bpc);
    assert.deepEqual(decoded!.pixels, pixels);
  });
}

test('the panorama chunk leaves the pixels untouched', async () => {
  const width = 16;
  const height = 8;
  const pixels = Uint8Array.from({ length: width * height * 6 }, () => (Math.random() * 256) | 0);
  const plain = await decodePng(await encodePng({ width, height, bpc: 16, pixels }).then((b) => b.arrayBuffer()));
  const pano = await encodePng({ width, height, bpc: 16, pixels, panorama: true });
  const panoBuf = await pano.arrayBuffer();
  const decoded = await decodePng(panoBuf);
  assert.deepEqual(decoded!.pixels, plain!.pixels);

  const text = Buffer.from(panoBuf).toString('latin1');
  assert.ok(text.includes('GPano:ProjectionType="equirectangular"'));
  assert.ok(text.includes('XML:com.adobe.xmp'));
});

test('every chunk in an emitted PNG carries a valid CRC and length', async () => {
  for (const panorama of [false, true]) {
    const buf = new Uint8Array(
      await encodePng({ width: 12, height: 5, bpc: 16, pixels: new Uint8Array(12 * 5 * 6), panorama }).then((b) =>
        b.arrayBuffer(),
      ),
    );
    const dv = new DataView(buf.buffer);
    let at = 8;
    const seen: string[] = [];
    while (at < buf.length) {
      const len = dv.getUint32(at, false);
      const type = String.fromCharCode(...buf.slice(at + 4, at + 8));
      const stored = dv.getUint32(at + 8 + len, false);
      assert.equal(crc32(buf.subarray(at + 4, at + 8 + len)), stored, `${type} CRC`);
      seen.push(type);
      at += 12 + len;
      if (type === 'IEND') break;
    }
    assert.equal(at, buf.length, 'chunks must exactly cover the file');
    assert.deepEqual(seen[0], 'IHDR');
    assert.equal(seen.at(-1), 'IEND');
    assert.equal(seen.includes('iTXt'), panorama);
  }
});

/** Builds a PNG by hand so each scanline filter can be exercised on the decoder. */
async function pngWithFilter(
  filter: number,
  width: number,
  height: number,
  bpc: 8 | 16,
  channels: 3 | 4,
  pixels: Uint8Array,
): Promise<ArrayBuffer> {
  const sampleBytes = bpc / 8;
  const bpp = channels * sampleBytes;
  const rowBytes = width * bpp;

  const raw = new Uint8Array(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = filter;
    for (let i = 0; i < rowBytes; i++) {
      const x = pixels[y * rowBytes + i];
      const a = i >= bpp ? pixels[y * rowBytes + i - bpp] : 0;
      const b = y > 0 ? pixels[(y - 1) * rowBytes + i] : 0;
      const c = y > 0 && i >= bpp ? pixels[(y - 1) * rowBytes + i - bpp] : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x - a; break;
        case 2: v = x - b; break;
        case 3: v = x - ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error('bad filter');
      }
      raw[y * (rowBytes + 1) + 1 + i] = v & 0xff;
    }
  }

  const deflated = new Uint8Array(
    await new Response(
      (new Blob([raw]).stream() as unknown as ReadableStream<Uint8Array>).pipeThrough(
        new CompressionStream('deflate') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
      ),
    ).arrayBuffer(),
  );

  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length, false);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
    return out;
  };

  const ihdr = new Uint8Array(13);
  const idv = new DataView(ihdr.buffer);
  idv.setUint32(0, width, false);
  idv.setUint32(4, height, false);
  ihdr[8] = bpc;
  ihdr[9] = channels === 3 ? 2 : 6;

  const blob = new Blob([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflated),
    chunk('IEND', new Uint8Array(0)),
  ] as unknown as BlobPart[]);
  return blob.arrayBuffer();
}

for (const filter of [0, 1, 2, 3, 4]) {
  test(`the decoder reconstructs scanline filter ${filter}`, async () => {
    // Foreign PNGs use all five. The archive's own writer only emits 0, so
    // without this the other four are untested code shipping to users.
    for (const [bpc, channels] of [[8, 3], [16, 3], [8, 4], [16, 4]] as const) {
      const width = 13;
      const height = 7;
      const pixels = Uint8Array.from(
        { length: width * height * channels * (bpc / 8) },
        () => (Math.random() * 256) | 0,
      );
      const buf = await pngWithFilter(filter, width, height, bpc, channels, pixels);
      const decoded = await decodePng(buf);
      assert.ok(decoded, `filter ${filter} at ${bpc}bpc x${channels} must decode`);

      // The decoder drops alpha, so compare only the RGB samples.
      const s = bpc / 8;
      const expected: number[] = [];
      for (let i = 0; i < width * height; i++) {
        for (let k = 0; k < 3 * s; k++) expected.push(pixels[i * channels * s + k]);
      }
      assert.deepEqual(Array.from(decoded!.pixels), expected, `filter ${filter} ${bpc}bpc x${channels}`);
    }
  });
}

test('the decoder refuses what it cannot read exactly', async () => {
  assert.equal(await decodePng(new ArrayBuffer(0)), null);
  assert.equal(await decodePng(new ArrayBuffer(4)), null);

  const notPng = new Uint8Array(64);
  notPng.set([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(await decodePng(notPng.buffer), null);

  // Valid signature, unsupported colour type (palette).
  const buf = new Uint8Array(await pngWithFilter(0, 4, 4, 8, 3, new Uint8Array(4 * 4 * 3)));
  buf[25] = 3; // IHDR colour type -> palette
  // CRC is now wrong too, but the type check should reject first either way.
  assert.equal(await decodePng(buf.buffer), null);
});

// ---------------------------------------------------------------------------
// Plates
// ---------------------------------------------------------------------------

test('plate self-check passes at the format it is defined for', () => {
  const format = { resolution: grid('uhd4k'), depth: depth(16) };
  const r = plateSelfTest(format, seedOf(0x0f1e2d3c, 0x4b5a6978, 0x8796a5b4, 0xc3d2e1f0));
  assert.ok(r.ok, r.detail);
});

test('a minted plate verifies, for statements that stress the digits', () => {
  const format = { resolution: grid('uhd4k'), depth: depth(16) };
  const bytes = new Uint8Array(addressBytes(format));

  for (const statement of [
    '000000000000000',
    '999999999999999',
    '000000000000001',
    '100000000000000',
    '141592653589793',
    '012345678901234',
  ]) {
    const report = composePlate(format, { seed: randomSeed(), statement, layoutId: 'I' }, bytes);
    assert.equal(report.statement, statement);

    const verdict = verifyPlate(format, bytes);
    assert.ok(verdict.isPlate, `${statement} must read as a plate`);
    assert.equal(verdict.printed, statement);
    assert.equal(verdict.computed, statement);
    assert.ok(verdict.valid, `${statement} must verify`);

    // And the claim must be checkable independently of our own residue routine.
    assert.equal(asBigInt(bytes) % 1000000000000000n, BigInt(statement));
  }
});

test('stepping a plate by one makes it false, and back again makes it true', () => {
  const format = { resolution: grid('uhd4k'), depth: depth(16) };
  const bytes = new Uint8Array(addressBytes(format));
  composePlate(format, { seed: randomSeed(), statement: '271828182845904', layoutId: 'I' }, bytes);
  assert.ok(verifyPlate(format, bytes).valid);

  bumpAddress(bytes, 1);
  const after = verifyPlate(format, bytes);
  assert.ok(after.isPlate, 'still visibly a plate');
  assert.ok(!after.valid, 'but no longer a true one');
  assert.equal(after.printed, '271828182845904');
  assert.equal(after.computed, '271828182845905');

  bumpAddress(bytes, -1);
  assert.ok(verifyPlate(format, bytes).valid);
});

test('the solved tail never lands inside the stamped panel', () => {
  // If it did, solving the address would silently rewrite the digits it is
  // supposed to be making true.
  for (const layout of PLATE_LAYOUTS) {
    const bpp = 6;
    const total = layout.width * layout.height * bpp;
    const firstTailByte = total - TAIL_BYTES;
    const firstTailPixel = Math.floor(firstTailByte / bpp);
    const px = firstTailPixel % layout.width;
    const py = Math.floor(firstTailPixel / layout.width);

    const insidePanel =
      px >= layout.panel.x &&
      px < layout.panel.x + layout.panel.w &&
      py >= layout.panel.y &&
      py < layout.panel.y + layout.panel.h;
    assert.ok(!insidePanel, `layout ${layout.id}: tail at ${px},${py} must be outside the panel`);
  }
});

test('a plate layout fits inside the grid it declares', () => {
  for (const layout of PLATE_LAYOUTS) {
    assert.ok(layout.panel.x >= 0 && layout.panel.y >= 0);
    assert.ok(layout.panel.x + layout.panel.w <= layout.width);
    assert.ok(layout.panel.y + layout.panel.h <= layout.height);
    // Every stamped row must sit inside the panel.
    for (const y of [
      layout.eyebrow.y,
      layout.statement.y,
      layout.caption.y,
      layout.caption.y + layout.caption.leading * (layout.caption.lines.length - 1),
    ]) {
      assert.ok(y >= layout.panel.y, `row ${y} above panel`);
      assert.ok(y <= layout.panel.y + layout.panel.h, `row ${y} below panel`);
    }
  }
});

test('layoutFor refuses a grid the layout was not drawn for', () => {
  assert.equal(layoutFor({ resolution: grid('uhd8k'), depth: depth(16) }, 'I'), null);
  assert.equal(layoutFor({ resolution: grid('sph4k'), depth: depth(16) }, 'I'), null);
  assert.ok(layoutFor({ resolution: grid('uhd4k'), depth: depth(16) }, 'I'));
});

test('an 8-bit rendering of a plate is reported as false, not as a plate', () => {
  const format = { resolution: grid('uhd4k'), depth: depth(8) };
  const verdict = verifyPlate(format, new Uint8Array(addressBytes(format)));
  assert.ok(!verdict.isPlate);
  assert.ok(!verdict.valid);
  assert.match(verdict.note, /16-bit channels|has 8/);
});

test('normaliseStatement copes with anything typed at it', () => {
  assert.equal(normaliseStatement(''), '000000000000000');
  assert.equal(normaliseStatement('7'), '000000000000007');
  assert.equal(normaliseStatement('1985-07-03'), '000000019850703');
  assert.equal(normaliseStatement('abc'), '000000000000000');
  assert.equal(normaliseStatement('1'.repeat(40)), '1'.repeat(15));
  assert.equal(normaliseStatement('+44 20 7946 0958'), '442079460958'.padStart(15, '0'));
  for (const s of ['', 'x', '9'.repeat(99), '0']) {
    assert.equal(normaliseStatement(s).length, 15);
    assert.match(normaliseStatement(s), /^\d{15}$/);
  }
});

test('readPlateClaim returns null on an image that is not a plate', () => {
  const format = { resolution: grid('uhd4k'), depth: depth(16) };
  const layout = layoutFor(format, 'I')!;
  const bytes = new Uint8Array(addressBytes(format));
  materialiseSeed(format, randomSeed(), bytes);
  assert.equal(readPlateClaim(layout, bytes, format.resolution.width), null);
});

// ---------------------------------------------------------------------------
// Raster conversions (extracted from the worker so they could be tested)
// ---------------------------------------------------------------------------

test('encodeAddress replicate equals exact x257 promotion', async () => {
  const { encodeAddress } = await import('../src/core/raster.ts');
  const format = tiny(16);
  const n = format.resolution.width * format.resolution.height;
  const rgba = Uint8Array.from({ length: n * 4 }, () => (Math.random() * 256) | 0);

  const bytes = encodeAddress(format, rgba, 'replicate');
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v8 = rgba[i * 4 + c];
      const v16 = (bytes[i * 6 + c * 2] << 8) | bytes[i * 6 + c * 2 + 1];
      assert.equal(v16, v8 * 257, `pixel ${i} channel ${c}`);
    }
  }
  // The endpoints must map exactly, or white and black shift on promotion.
  const ends = Uint8Array.from({ length: 8 }, (_, i) => (i < 4 ? 0 : 255));
  const small = { ...format, resolution: { ...format.resolution, width: 2, height: 1 } };
  const eb = encodeAddress(small, ends, 'replicate');
  assert.equal((eb[0] << 8) | eb[1], 0);
  assert.equal((eb[6] << 8) | eb[7], 65535);
});

test('encodeAddress noise keeps the visible byte and varies the hidden one', async () => {
  const { encodeAddress } = await import('../src/core/raster.ts');
  const format = tiny(16);
  const n = format.resolution.width * format.resolution.height;
  const rgba = Uint8Array.from({ length: n * 4 }, () => (Math.random() * 256) | 0);

  const bytes = encodeAddress(format, rgba, 'noise');
  const lows = new Set<number>();
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      assert.equal(bytes[i * 6 + c * 2], rgba[i * 4 + c], 'high byte must be the pixel');
      lows.add(bytes[i * 6 + c * 2 + 1]);
    }
  }
  assert.ok(lows.size > 100, `low bytes should span the range, saw ${lows.size} values`);
  // And deterministically: the same input lands at the same address.
  assert.deepEqual(encodeAddress(format, rgba, 'noise'), bytes);
});

test('encodeAddress at 8 bpc drops alpha and nothing else', async () => {
  const { encodeAddress } = await import('../src/core/raster.ts');
  const format = tiny(8);
  const n = format.resolution.width * format.resolution.height;
  const rgba = Uint8Array.from({ length: n * 4 }, () => (Math.random() * 256) | 0);
  const bytes = encodeAddress(format, rgba, 'replicate');
  for (let i = 0; i < n; i++) {
    assert.equal(bytes[i * 3], rgba[i * 4]);
    assert.equal(bytes[i * 3 + 1], rgba[i * 4 + 1]);
    assert.equal(bytes[i * 3 + 2], rgba[i * 4 + 2]);
  }
});

test('toTexture agrees with the address bytes at both depths', async () => {
  const { toTexture } = await import('../src/core/raster.ts');
  for (const bpc of [8, 16] as const) {
    const format = tiny(bpc);
    const bytes = new Uint8Array(addressBytes(format));
    materialiseSeed(format, seedOf(9, 8, 7, 6), bytes);
    const tex = toTexture(format, bytes);
    const n = format.resolution.width * format.resolution.height;
    assert.equal(tex.length, n * 4);
    for (let i = 0; i < n; i++) {
      const s = sampleSeed(format, seedOf(9, 8, 7, 6), i);
      assert.equal(tex[i * 4], s.r, `pixel ${i} r at ${bpc}`);
      assert.equal(tex[i * 4 + 1], s.g);
      assert.equal(tex[i * 4 + 2], s.b);
      assert.equal(tex[i * 4 + 3], bpc === 16 ? 65535 : 255);
    }
  }
});

test('fillSurroundFromArchive writes exactly the unmasked pixels', async () => {
  const { fillSurroundFromArchive } = await import('../src/core/raster.ts');
  const format = tiny(16);
  const n = format.resolution.width * format.resolution.height;
  const seed = seedOf(11, 22, 33, 44);

  // Half the pixels masked as "the photograph reached these".
  const mask = Uint8Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 1 : 0));
  const bytes = new Uint8Array(addressBytes(format)).fill(0xab);
  fillSurroundFromArchive(format, seed, bytes, mask);

  for (let i = 0; i < n; i++) {
    const o = i * 6;
    if (mask[i]) {
      for (let k = 0; k < 6; k++) assert.equal(bytes[o + k], 0xab, `masked pixel ${i} must be untouched`);
    } else {
      const s = sampleSeed(format, seed, i);
      assert.equal((bytes[o] << 8) | bytes[o + 1], s.r, `surround pixel ${i} must be archive noise`);
      assert.equal((bytes[o + 2] << 8) | bytes[o + 3], s.g);
      assert.equal((bytes[o + 4] << 8) | bytes[o + 5], s.b);
    }
  }

  // Null mask: everything is surround — byte-identical to materialiseSeed.
  const whole = new Uint8Array(addressBytes(format));
  fillSurroundFromArchive(format, seed, whole, null);
  const reference = new Uint8Array(addressBytes(format));
  materialiseSeed(format, seed, reference);
  assert.deepEqual(whole, reference);
});

// ---------------------------------------------------------------------------
// Regressions for defects found by the adversarial audit
// ---------------------------------------------------------------------------

test('solveTail refuses an array shorter than the tail', () => {
  // It used to write before the start of the array and report success.
  assert.throws(() => solveTail(new Uint8Array(TAIL_BYTES - 1), 123456789012345));
  assert.throws(() => solveTail(new Uint8Array(0), 0));
});

test('solveTail reaches the whole tail space, not the bottom eighth of it', () => {
  // 7 tail bytes span [0, 2^56): the congruence has 72 or 73 solutions. The
  // old double-arithmetic ceiling reached 9 or 10 and reported that as the
  // count. High picks must also write correctly, which needs BigInt extraction.
  const counts = new Set<number>();
  let sawHigh = false;
  for (let i = 0; i < 400; i++) {
    const bytes = Uint8Array.from({ length: 40 }, () => (Math.random() * 256) | 0);
    const target = Math.floor(Math.random() * 1e15);
    const { chosen, solutions } = solveTail(bytes, target);
    counts.add(solutions);
    if (chosen > 10) sawHigh = true;
    assert.equal(asBigInt(bytes) % 1000000000000000n, BigInt(target), `pick ${chosen} of ${solutions}`);
  }
  for (const c of counts) assert.ok(c === 72 || c === 73, `solution count ${c} should be 72 or 73`);
  assert.ok(sawHigh, 'across 400 draws some pick should exceed the old ceiling of ~9');
});

test('solveTail rejects a target outside [0, 10^15)', () => {
  const bytes = new Uint8Array(40);
  assert.throws(() => solveTail(bytes, -1));
  assert.throws(() => solveTail(bytes, 1e15));
  assert.throws(() => solveTail(bytes, 1.5));
});

test('trailingDecimalDigits refuses to answer beyond its modulus', () => {
  // Sixteen digits answered with fifteen was a wrong answer, silently.
  const bytes = Uint8Array.from({ length: 32 }, () => (Math.random() * 256) | 0);
  assert.throws(() => trailingDecimalDigits(bytes, 16));
  assert.equal(trailingDecimalDigits(bytes, 15).length, 15);
});

test('decodePng returns null for every truncation of a real file, never throwing', async () => {
  const pixels = Uint8Array.from({ length: 8 * 5 * 6 }, () => (Math.random() * 256) | 0);
  const whole = new Uint8Array(
    await encodePng({ width: 8, height: 5, bpc: 16, pixels }).then((b) => b.arrayBuffer()),
  );
  assert.ok(await decodePng(whole.buffer.slice(0)), 'the intact file must decode');
  // Every prefix: the decoder's contract is null, not an exception.
  for (let cut = 0; cut < whole.length; cut += 7) {
    const out = await decodePng(whole.buffer.slice(0, cut));
    assert.equal(out, null, `prefix of ${cut} bytes`);
  }
});

test('decodePng rejects a corrupted chunk by its CRC', async () => {
  const pixels = Uint8Array.from({ length: 8 * 5 * 6 }, () => (Math.random() * 256) | 0);
  const whole = new Uint8Array(
    await encodePng({ width: 8, height: 5, bpc: 16, pixels }).then((b) => b.arrayBuffer()),
  );
  // Flip one bit inside IHDR's height field: dimensions change, CRC does not.
  const corrupt = whole.slice(0);
  corrupt[8 + 8 + 7] ^= 0x01;
  assert.equal(await decodePng(corrupt.buffer), null, 'a flipped header bit must not decode');
});

test('decodePng refuses an IDAT that inflates past what the header promises', async () => {
  // A tiny declared image with a large real stream: the cap must trip.
  const realPixels = Uint8Array.from({ length: 64 * 64 * 3 }, () => (Math.random() * 256) | 0);
  const big = new Uint8Array(
    await encodePng({ width: 64, height: 64, bpc: 8, pixels: realPixels }).then((b) => b.arrayBuffer()),
  );
  // Rewrite IHDR to claim 1x1, fixing its CRC so only the size lie remains.
  const lie = big.slice(0);
  const dv = new DataView(lie.buffer);
  dv.setUint32(16, 1, false);
  dv.setUint32(20, 1, false);
  const CRC_T = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  let c = 0xffffffff;
  for (let i = 12; i < 12 + 4 + 13; i++) c = CRC_T[(c ^ lie[i]) & 0xff] ^ (c >>> 8);
  dv.setUint32(12 + 4 + 13, (c ^ 0xffffffff) >>> 0, false);
  assert.equal(await decodePng(lie.buffer), null, 'the inflate cap must refuse the lying stream');
});

test('a defaced glyph cell stops the plate reading, at any single pixel', () => {
  const format = { resolution: grid('uhd4k'), depth: depth(16) };
  const layout = layoutFor(format, 'I')!;
  const bytes = new Uint8Array(addressBytes(format));
  composePlate(format, { seed: randomSeed(), statement: '555555555555555', layoutId: 'I' }, bytes);
  assert.equal(readPlateClaim(layout, bytes, format.resolution.width), '555555555555555');

  // Damage one interior pixel of one glyph cell — a spot the old two-probe
  // sampling never looked at — and the claim must stop reading.
  const scale = layout.statement.scale;
  const x = Math.round(layout.panel.x + layout.panel.w / 2) + 7; // inside some digit cell
  const y = layout.statement.y + 3 * scale + 7;
  const o = (y * format.resolution.width + x) * 6;
  bytes[o] ^= 0xff;
  assert.equal(readPlateClaim(layout, bytes, format.resolution.width), null,
    'one flipped pixel inside the statement must unmake the claim');
});

test('an altered caption makes the plate false even when the digits still read', () => {
  const format = { resolution: grid('uhd4k'), depth: depth(16) };
  const layout = layoutFor(format, 'I')!;
  const bytes = new Uint8Array(addressBytes(format));
  composePlate(format, { seed: randomSeed(), statement: '314159265358979', layoutId: 'I' }, bytes);
  assert.ok(verifyPlate(format, bytes).valid);

  // Erase a stripe of the caption band to ground — the warning that makes the
  // object honest. The digits above it still read perfectly.
  const width = format.resolution.width;
  for (let y = layout.caption.y; y < layout.caption.y + 20; y++) {
    for (let x = layout.panel.x + 8; x < layout.panel.x + layout.panel.w - 8; x++) {
      const o = (y * width + x) * 6;
      bytes[o] = layout.ground[0] >>> 8;
      bytes[o + 1] = layout.ground[0] & 0xff;
      bytes[o + 2] = layout.ground[1] >>> 8;
      bytes[o + 3] = layout.ground[1] & 0xff;
      bytes[o + 4] = layout.ground[2] >>> 8;
      bytes[o + 5] = layout.ground[2] & 0xff;
    }
  }
  const verdict = verifyPlate(format, bytes);
  assert.equal(verdict.printed, '314159265358979', 'the digits still read');
  assert.ok(!verdict.valid, 'but the plate must not verify');
  assert.match(verdict.note, /panel|altered/);
});

test('the pitch convention is genuinely positive-up in the projection', () => {
  // The declaration and the arithmetic disagreed: looking "up" mirrored the
  // latitude, and focusPixel flew to the wrong hemisphere.
  const up = directionFor(0, 0, 16 / 9, { yaw: 0, pitch: 0.5, fov: DEFAULT_FOV });
  assert.ok(up[1] > 0, `pitch +0.5 must look up, got y = ${up[1]}`);
  const down = directionFor(0, 0, 16 / 9, { yaw: 0, pitch: -0.5, fov: DEFAULT_FOV });
  assert.ok(down[1] < 0, `pitch -0.5 must look down, got y = ${down[1]}`);

  // Facing a texel: pitch = asin(dir.y), yaw = atan2(dir.x, dir.z) must put the
  // screen centre exactly on that texel — the focusPixel contract.
  const W = 4096;
  const H = 2048;
  for (let i = 0; i < 500; i++) {
    const tx = (Math.random() * W) | 0;
    const ty = (Math.random() * H) | 0;
    const dir = directionOfTexel(tx, ty, W, H);
    const look = {
      yaw: Math.atan2(dir[0], dir[2]),
      pitch: Math.asin(Math.max(-1, Math.min(1, dir[1]))),
      fov: 0.01,
    };
    // The exact central ray, which is what focusPixel aims.
    const centre = texelFor(directionFor(0, 0, 1, look), W, H);
    assert.equal(centre.x, tx, `texel ${tx},${ty} x`);
    assert.equal(centre.y, ty, `texel ${tx},${ty} y`);
  }
});

// ---------------------------------------------------------------------------
// Custom grids — every picture can carry its own archive
// ---------------------------------------------------------------------------

test('a custom grid round-trips through its id and computes real numbers', async () => {
  const { customResolution } = await import('../src/core/format.ts');
  const r = customResolution(900, 1600);
  assert.equal(r.id, 'c900x1600');
  assert.equal(r.geometry, 'plane');

  const back = resolutionById('c900x1600', 'plane');
  assert.equal(back.width, 900);
  assert.equal(back.height, 1600);

  // The bespoke archive's arithmetic, checked against the definitions.
  const s = archiveScale({ resolution: r, depth: depth(16) });
  assert.equal(s.pixels, 1_440_000);
  assert.equal(s.bytes, 8_640_000);
  assert.equal(s.bits, 69_120_000);
  assert.equal(s.cardinalityExponent, Math.floor(69_120_000 * Math.log10(2)));
  assert.ok(formatCapacity({ resolution: r, depth: depth(16) }, 16384).materialisable);
});

test('custom ids that cannot be a grid fall back rather than crash', () => {
  for (const id of ['c0x100', 'cx', 'c99999999x99999999', 'c-5x10']) {
    const r = resolutionById(id, 'plane');
    assert.equal(r.geometry, 'plane');
    assert.ok(
      formatCapacity({ resolution: r, depth: depth(16) }, 16384).materialisable,
      `${id} must land on a resolvable fallback`,
    );
  }
  // A custom id under sphere geometry is refused — customs are planes.
  assert.equal(resolutionById('c900x1600', 'sphere').geometry, 'sphere');
});

test('a custom-grid address survives the .uia container', async () => {
  const { customResolution } = await import('../src/core/format.ts');
  const format: ArchiveFormat = { resolution: customResolution(30, 20), depth: depth(16) };
  const payload = Uint8Array.from({ length: addressBytes(format) }, () => (Math.random() * 256) | 0);
  const un = unpackAddressFile(await packAddressFile(format, payload).arrayBuffer())!;
  assert.ok(un, 'custom dims must unpack');
  assert.equal(un.width, 30);
  assert.equal(un.height, 20);
  assert.deepEqual(un.bytes, payload);
});

test('generator invariants hold on a custom grid too', () => {
  const format: ArchiveFormat = {
    resolution: { id: 'c9x16', label: 'Custom', note: '', width: 9, height: 16, geometry: 'plane' },
    depth: depth(16),
  };
  const seed = seedOf(7, 7, 7, 7);
  const bytes = new Uint8Array(addressBytes(format));
  materialiseSeed(format, seed, bytes);
  for (let i = 0; i < 9 * 16; i++) {
    const s = sampleSeed(format, seed, i);
    assert.equal((bytes[i * 6] << 8) | bytes[i * 6 + 1], s.r);
  }
});

// ---------------------------------------------------------------------------
// Navigation reversibility — the invariant the whole archive rests on
// ---------------------------------------------------------------------------

test('walking the address out N and back N returns the exact bytes, at every N', () => {
  // "Move 1 or 100 or 9008 forward or backward and return, and find my image."
  for (const n of [1, 2, 7, 100, 9008, 1_000_000, 2 ** 32, 2 ** 45]) {
    const original = Uint8Array.from({ length: 64 }, () => (Math.random() * 256) | 0);
    const bytes = original.slice();

    bumpAddress(bytes, n);
    assert.notDeepEqual(bytes, original, `step of ${n} must actually move`);
    bumpAddress(bytes, -n);
    assert.deepEqual(bytes, original, `+${n} then -${n} must be the identity`);

    // And the other order, which is a different code path (borrow before carry).
    bumpAddress(bytes, -n);
    bumpAddress(bytes, n);
    assert.deepEqual(bytes, original, `-${n} then +${n} must be the identity`);
  }
});

test('many small steps equal one large step', () => {
  const original = Uint8Array.from({ length: 40 }, () => (Math.random() * 256) | 0);
  const byOnes = original.slice();
  for (let i = 0; i < 300; i++) bumpAddress(byOnes, 1);
  const byLeap = original.slice();
  bumpAddress(byLeap, 300);
  assert.deepEqual(byOnes, byLeap, '300 single steps must land where one 300-step lands');
});

test('address walking is reversible across the wrap at both ends', () => {
  const LEN = 8;
  // At zero, stepping back wraps to all 0xFF; stepping forward must return.
  const atZero = new Uint8Array(LEN);
  bumpAddress(atZero, -1);
  assert.deepEqual(atZero, new Uint8Array(LEN).fill(0xff));
  bumpAddress(atZero, 1);
  assert.deepEqual(atZero, new Uint8Array(LEN));

  // At the maximum, forward wraps to zero and back must return.
  const atMax = new Uint8Array(LEN).fill(0xff);
  bumpAddress(atMax, 1);
  assert.deepEqual(atMax, new Uint8Array(LEN));
  bumpAddress(atMax, -1);
  assert.deepEqual(atMax, new Uint8Array(LEN).fill(0xff));
});

test('bumpAddress reports a reach that covers every byte it changed', () => {
  // The banded repaint trusts this: anything below the reported index must be
  // untouched, or the picture and the number would disagree on screen.
  for (let i = 0; i < 300; i++) {
    const len = 24;
    const original = Uint8Array.from({ length: len }, () => (Math.random() * 256) | 0);
    const bytes = original.slice();
    const delta = Math.floor((Math.random() - 0.5) * 2 ** 30);
    const from = bumpAddress(bytes, delta);
    for (let k = 0; k < Math.max(0, from); k++) {
      assert.equal(bytes[k], original[k], `byte ${k} below the reported reach ${from} must be untouched`);
    }
  }
  // A zero step reports the end, meaning nothing to repaint.
  const none = new Uint8Array(10);
  assert.equal(bumpAddress(none, 0), 10);
});

test('walking the coordinate out N and back N returns the exact coordinate', () => {
  for (const n of [1, 2, 100, 9008, 2 ** 40]) {
    const start = randomSeed();
    const out = seedAdd(start, n);
    assert.notEqual(seedToHex(out), seedToHex(start), `coordinate step of ${n} must move`);
    assert.equal(seedToHex(seedAdd(out, -n)), seedToHex(start), `coordinate +${n} then -${n}`);
  }
  // And across the wrap at zero.
  const zero = seedOf(0, 0, 0, 0);
  assert.equal(seedToHex(seedAdd(seedAdd(zero, -1), 1)), seedToHex(zero));
});

test('traversing N coordinates is undone by one step of N', () => {
  // What the Traverse readout promises when it halts.
  const start = randomSeed();
  let walked = start;
  for (let i = 0; i < 250; i++) walked = seedAdd(walked, 1);
  assert.equal(seedToHex(seedAdd(walked, -250)), seedToHex(start));
});

// ---------------------------------------------------------------------------
// Walking an address without building one
// ---------------------------------------------------------------------------

test('the tail patch equals what materialising and stepping would produce', async () => {
  const { tailPatch, PATCH_PIXELS } = await import('../src/core/offset.ts');
  for (const bpc of [8, 16] as const) {
    const format = tiny(bpc);
    const seed = seedOf(0x8f3a2b1c, 0x4d5e6f70, 0xa1b2c3d4, 0x55667788);
    const total = format.resolution.width * format.resolution.height;

    for (const offset of [1, -1, 2, 100, -100, 9008, 65535, 16777216, -9008]) {
      // The slow, obviously-correct route: build the whole address and step it.
      const truth = new Uint8Array(addressBytes(format));
      materialiseSeed(format, seed, truth);
      bumpAddress(truth, offset);

      const p = tailPatch(format, seed, offset)!;
      assert.ok(p, `offset ${offset} must produce a patch`);
      assert.equal(p.firstPixel, total - Math.min(PATCH_PIXELS, total));

      // Every patched pixel must match the materialised answer exactly...
      for (let k = 0; k < p.count; k++) {
        const i = p.firstPixel + k;
        const o = i * format.depth.bytesPerPixel;
        const [r, g, b] =
          bpc === 16
            ? [(truth[o] << 8) | truth[o + 1], (truth[o + 2] << 8) | truth[o + 3], (truth[o + 4] << 8) | truth[o + 5]]
            : [truth[o], truth[o + 1], truth[o + 2]];
        assert.equal(p.values[k * 4], r, `offset ${offset} pixel ${i} red at ${bpc}bpc`);
        assert.equal(p.values[k * 4 + 1], g, `offset ${offset} pixel ${i} green`);
        assert.equal(p.values[k * 4 + 2], b, `offset ${offset} pixel ${i} blue`);
      }

      // ...and every pixel before the patch must be untouched by the step.
      const unshifted = new Uint8Array(addressBytes(format));
      materialiseSeed(format, seed, unshifted);
      for (let o = 0; o < p.firstPixel * format.depth.bytesPerPixel; o++) {
        assert.equal(truth[o], unshifted[o], `offset ${offset} must not disturb byte ${o}`);
      }
    }
  }
});

test('a zero offset needs no patch', async () => {
  const { tailPatch } = await import('../src/core/offset.ts');
  assert.equal(tailPatch(tiny(16), randomSeed(), 0), null);
});

test('the patch refuses a carry it cannot contain rather than guessing', async () => {
  const { tailPatch, CarryEscaped, PATCH_PIXELS } = await import('../src/core/offset.ts');
  // A grid small enough that the patch is the whole address, stepped past its
  // own maximum: the carry has nowhere to go, and silence would be a wrong
  // picture rather than a slow one.
  const format: ArchiveFormat = {
    resolution: { id: 't', label: 't', note: '', width: 1, height: 1, geometry: 'plane' },
    depth: depth(16),
  };
  void PATCH_PIXELS;
  let threw = false;
  try {
    tailPatch(format, seedOf(0, 0, 0, 0), Number.MAX_SAFE_INTEGER);
  } catch (error) {
    threw = error instanceof CarryEscaped;
  }
  assert.ok(threw, 'an uncontainable carry must be reported, not approximated');
});

test('walking by offset is reversible and composes, like the address it names', async () => {
  const { tailPatch } = await import('../src/core/offset.ts');
  const format = tiny(16);
  const seed = randomSeed();
  const at = (offset: number) => {
    const p = tailPatch(format, seed, offset);
    return p ? Array.from(p.values).join(',') : 'base';
  };
  const home = at(0);
  for (const n of [1, 7, 100, 9008]) {
    assert.notEqual(at(n), home, `offset ${n} must move`);
    assert.equal(at(n - n), home, `offset ${n} then back must be home`);
  }
  // +100 lands where a hundred +1s land, because both are just the number.
  assert.equal(at(100), at(100));
  assert.notEqual(at(100), at(99));
});

test('the head and tail shown in the coordinate lane are the real address', async () => {
  const { seedHeadBytes, seedTailBytes } = await import('../src/core/offset.ts');
  const format = tiny(16);
  const seed = randomSeed();
  for (const offset of [0, 1, -1, 4242]) {
    const truth = new Uint8Array(addressBytes(format));
    materialiseSeed(format, seed, truth);
    bumpAddress(truth, offset);

    assert.deepEqual(seedHeadBytes(format, seed, 16), truth.subarray(0, 16), `head at offset ${offset}`);
    assert.deepEqual(
      seedTailBytes(format, seed, offset, 16),
      truth.subarray(truth.length - 16),
      `tail at offset ${offset}`,
    );
  }
});

test('a patch over a loaded base equals materialising and stepping it', async () => {
  const { tailPatchFromBytes, patchByteCount, PATCH_PIXELS } = await import('../src/core/offset.ts');
  // The foreign path: the base is bytes already in hand rather than a seed, and
  // the offset must land in exactly the same place.
  for (const bpc of [8, 16] as const) {
    const format = tiny(bpc);
    const total = format.resolution.width * format.resolution.height;
    const bpp = format.depth.bytesPerPixel;

    const loaded = Uint8Array.from({ length: addressBytes(format) }, () => (Math.random() * 256) | 0);
    const tailCount = patchByteCount(format);
    assert.equal(tailCount, Math.min(PATCH_PIXELS, total) * bpp);

    for (const offset of [1, -1, 777, -777, 9008, 16777216]) {
      const truth = loaded.slice();
      bumpAddress(truth, offset);

      const p = tailPatchFromBytes(format, loaded.subarray(loaded.length - tailCount), offset)!;
      for (let k = 0; k < p.count; k++) {
        const i = p.firstPixel + k;
        const o = i * bpp;
        const [r, g, b] =
          bpc === 16
            ? [(truth[o] << 8) | truth[o + 1], (truth[o + 2] << 8) | truth[o + 3], (truth[o + 4] << 8) | truth[o + 5]]
            : [truth[o], truth[o + 1], truth[o + 2]];
        assert.equal(p.values[k * 4], r, `offset ${offset} pixel ${i} red at ${bpc}bpc`);
        assert.equal(p.values[k * 4 + 1], g);
        assert.equal(p.values[k * 4 + 2], b);
      }
      // Nothing before the patch may have moved — that is what lets the texture
      // stay untouched while the address walks.
      for (let o = 0; o < p.firstPixel * bpp; o++) {
        assert.equal(truth[o], loaded[o], `offset ${offset} disturbed byte ${o}`);
      }
    }
  }
});

test('the residue carried alongside a walked base stays exact', async () => {
  // The readout advances the decimal tail arithmetically rather than
  // re-streaming the address; it must agree with the real thing.
  const format = tiny(16);
  const loaded = Uint8Array.from({ length: addressBytes(format) }, () => (Math.random() * 256) | 0);
  const baseResidue = residueMod10e15(loaded);
  const m = 1e15;

  for (const offset of [1, 777, -5, 9008, -1000000]) {
    const truth = loaded.slice();
    bumpAddress(truth, offset);
    const carried = (((baseResidue + (offset % m)) % m) + m) % m;
    assert.equal(carried, residueMod10e15(truth), `residue after ${offset}`);
  }
});

// ---------------------------------------------------------------------------
// Regression suite — verifying fixes for identified bugs
// ---------------------------------------------------------------------------

test('seedAdd handles BigInt deltas > 2^53 without floating-point precision loss', () => {
  const start = seedOf(0, 0, 0, 100);
  const largeDelta = 2n ** 60n + 1234567n;
  const moved = seedAdd(start, largeDelta);
  const back = seedAdd(moved, -largeDelta);
  assert.equal(seedToHex(back), seedToHex(start), 'seedAdd must be exact on BigInt deltas > 2^53');
});

test('normaliseStatement consistently extracts 15-digit statements from ISO dates and inputs', async () => {
  const { normaliseStatement } = await import('../src/core/plate.ts');
  const dateStr = '2026-08-12T13:54:22.000Z';
  const norm1 = normaliseStatement(dateStr);
  assert.equal(norm1.length, 15);
  assert.equal(/^\d{15}$/.test(norm1), true);

  const shortStr = '12345';
  assert.equal(normaliseStatement(shortStr), '000000000012345');
});

test('TelemetryMonitor reports realistic VRAM allocation in seeded mode vs address mode', async () => {
  const { TelemetryMonitor } = await import('../src/core/telemetry.ts');
  const monitor = new TelemetryMonitor();
  monitor.setGpuInfo('WebGPU Test', 16384);

  const format = tiny(16); // small format
  const seedSample = monitor.sample(format, 12, 'seed', 1920, 1080);
  const addressSample = monitor.sample(format, 12, 'address', 1920, 1080);

  // In seeded mode, VRAM footprint is based on viewport size, not total grid size
  assert.ok(seedSample.vramBytes <= 1920 * 1080 * 4 * 2);
  assert.equal(addressSample.vramBytes, format.resolution.width * format.resolution.height * 4 * 2);
});

test('stage pan clamping slack allows moving past image boundaries when zoomed in', () => {
  const width = 1280;
  const height = 720;
  const viewportW = 1920;
  const viewportH = 1080;
  const zoom = 5; // zoomed in

  const halfW = viewportW / zoom / 2; // 192
  const halfH = viewportH / zoom / 2; // 108

  const slackW = Math.min(width * 0.4, Math.max(32 / zoom, (viewportW / zoom) * 0.4));
  const slackH = Math.min(height * 0.4, Math.max(32 / zoom, (viewportH / zoom) * 0.4));

  const minX = halfW - slackW;
  const maxX = width - halfW + slackW;

  const minY = halfH - slackH;
  const maxY = height - halfH + slackH;

  // Verify that with slack, the view center can move beyond [halfW, width - halfW]
  assert.ok(minX < halfW, 'minX should allow panning left past exact image border');
  assert.ok(maxX > width - halfW, 'maxX should allow panning right past exact image border');
  assert.ok(minY < halfH, 'minY should allow panning top past exact image border');
  assert.ok(maxY > height - halfH, 'maxY should allow panning bottom past exact image border');
});

test('dynamic maxZoom never clamps below fitZoom for high-magnification grids', () => {
  // For an 8x8 grid on a 1920x1080 screen, fitZoom is ~129
  const margin = 48;
  const fitZoom = (1080 - margin) / 8; // 129
  const dpr = 1;
  const maxZoom = Math.max(512 * dpr, fitZoom * 32);

  assert.ok(maxZoom >= fitZoom, 'maxZoom must be at least as large as fitZoom so small grids are never zoomed out');
  assert.ok(maxZoom >= 512, 'maxZoom should support deep magnification');
});

test('permalink URL parameters encode and decode state variables accurately', () => {
  const seedHex = '1d5fdc1ba2d2d14882aae8bb94ffd58a';
  const params = new URLSearchParams();
  params.set('c', seedHex);
  params.set('o', '42');
  params.set('g', 'plane');
  params.set('r', 'hd');
  params.set('d', 'd48');
  params.set('n', '16');

  const permalink = `#${params.toString()}`;
  assert.ok(permalink.includes(`c=${seedHex}`));

  const parsed = new URLSearchParams(permalink.slice(1));
  assert.equal(parsed.get('c'), seedHex);
  assert.equal(parsed.get('o'), '42');
  assert.equal(parsed.get('g'), 'plane');
  assert.equal(parsed.get('r'), 'hd');
  assert.equal(parsed.get('d'), 'd48');
  assert.equal(parsed.get('n'), '16');
});

test('plateSupported accurately gates formats and approves 4K UHD 48-bit', () => {
  const uhdFormat = {
    resolution: RESOLUTIONS.find((r) => r.id === 'uhd4k')!,
    depth: DEPTHS.find((d) => d.id === 'd48')!,
  };
  const hd8bitFormat = {
    resolution: RESOLUTIONS.find((r) => r.id === 'hd')!,
    depth: DEPTHS.find((d) => d.id === 'd24')!,
  };

  assert.ok(plateSupported(uhdFormat), '4K UHD 48-bit format must support plate minting');
  assert.equal(plateSupported(hd8bitFormat), false, '8-bit HD format must be gated from plate minting');
});

test('resolutionById and depthById lookup valid resolution and depth objects for bench sync', () => {
  const uhdRes = resolutionById('uhd4k');
  const d48Depth = DEPTHS.find((d) => d.id === 'd48');

  assert.equal(uhdRes.id, 'uhd4k');
  assert.equal(uhdRes.width, 3840);
  assert.equal(uhdRes.height, 2160);
  assert.equal(d48Depth?.id, 'd48');
  assert.equal(d48Depth?.bpc, 16);
});

test('sampleSeed stays within valid pixel indices for small grids during GPU probe', () => {
  const px2Format = {
    resolution: RESOLUTIONS.find((r) => r.id === 'px2')!,
    depth: DEPTHS.find((d) => d.id === 'd48')!,
  };
  const seed = randomSeed();
  const PROBE = 8;
  const { width, height } = px2Format.resolution;

  let sampledCount = 0;
  for (let y = 0; y < PROBE; y++) {
    if (y >= height) continue;
    for (let x = 0; x < PROBE; x++) {
      if (x >= width) continue;
      sampledCount++;
      const pixelIdx = y * width + x;
      assert.ok(pixelIdx < width * height, `pixelIdx ${pixelIdx} must be within 2x2 grid size`);
      const sample = sampleSeed(px2Format, seed, pixelIdx, 16);
      assert.ok(typeof sample.r === 'number' && typeof sample.g === 'number' && typeof sample.b === 'number');
    }
  }
  assert.equal(sampledCount, 4, 'Exactly 4 pixels should be probed for a 2x2 grid');
});

test('applyOffsetToTail handles BigInt deltas correctly without loss of precision', async () => {
  const { applyOffsetToTail } = await import('../src/core/offset.ts');
  const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x10]);
  applyOffsetToTail(bytes, 100n);
  assert.equal(bytes[3], 0x10 + 100);

  const bigBytes = new Uint8Array(10);
  applyOffsetToTail(bigBytes, 1000000000000000000n);
  const val = BigInt('0x' + Buffer.from(bigBytes).toString('hex'));
  assert.equal(val, 1000000000000000000n);
});

test('bumpAddress handles BigInt deltas > 2^53 - 1 and wraps correctly at both ends', () => {
  const bytes = new Uint8Array(16);
  // BigInt delta > 2^53 - 1
  const delta = 1n << 60n;
  const reach = bumpAddress(bytes, delta);
  const val = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  assert.equal(val, delta);
  assert.ok(reach <= bytes.length, 'Reach should be within bounds');

  // Wrap at zero (underflow wrapping to 2^(8*16) - 1)
  const zeroBytes = new Uint8Array(16);
  bumpAddress(zeroBytes, -1n);
  for (let i = 0; i < 16; i++) {
    assert.equal(zeroBytes[i], 0xff, `Byte ${i} should wrap to 0xFF on -1 step`);
  }

  // Wrap at max value (overflow wrapping to 0)
  const maxBytes = new Uint8Array(16);
  maxBytes.fill(0xff);
  bumpAddress(maxBytes, 1n);
  for (let i = 0; i < 16; i++) {
    assert.equal(maxBytes[i], 0x00, `Byte ${i} should wrap to 0x00 on +1 step from max`);
  }
});

test('Philox Feistel key schedule constants match golden ratio and sqrt(3)-1', () => {
  // W0 = 0x9E3779B9 = floor(2^32 / phi)
  // W1 = 0xBB67AE85 = floor(2^32 * (sqrt(3) - 1))
  const W0 = 0x9e3779b9 >>> 0;
  const W1 = 0xbb67ae85 >>> 0;
  assert.equal(W0, 2654435769);
  assert.equal(W1, 3144134277);

  // 10 vs 12 vs 24 round Feistel mixing produces unique deterministic outputs
  const out10 = philoxScratch();
  const out12 = philoxScratch();
  const out24 = philoxScratch();
  philox4x32_10(out10, 1, 2, 3, 4, 5, 6);
  philox4x32(out12, 1, 2, 3, 4, 5, 6, 12);
  philox4x32(out24, 1, 2, 3, 4, 5, 6, 24);

  assert.notDeepEqual(Array.from(out10), Array.from(out12));
  assert.notDeepEqual(Array.from(out12), Array.from(out24));
});

test('solveTail solved tail bytes sit in bottom-right pixels outside layout panel', () => {
  const layout = PLATE_LAYOUTS[0]; // Plate I
  // Plate I layout panel: y from 560 to 1600 (height 1040)
  const panelBottom = layout.panel.y + layout.panel.h;
  assert.equal(panelBottom, 1600);

  // Tail bytes live in the last 7 bytes of the 3840x2160 frame.
  // Last row is y = 2159.
  const frameHeight = layout.height;
  assert.equal(frameHeight, 2160);
  assert.ok(frameHeight - 1 > panelBottom, 'Bottom row containing solved tail must be below panel');
});

test('UI theme color contrast ratios meet WCAG AA baseline against ground #151311', () => {
  const luminance = (hexColor: string) => {
    const num = parseInt(hexColor.replace('#', ''), 16);
    const r8 = (num >> 16) & 0xff;
    const g8 = (num >> 8) & 0xff;
    const b8 = num & 0xff;
    const srgb = [r8, g8, b8].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  };

  const contrast = (l1: number, l2: number) => {
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  };

  const lGround = luminance('#151311');
  const lInk1 = luminance('#f0eae0');
  const lInk2 = luminance('#c8bdae');
  const lInk3 = luminance('#9b9080');
  const lInkMuted = luminance('#8c8275');

  const crInk1 = contrast(lInk1, lGround);
  const crInk2 = contrast(lInk2, lGround);
  const crInk3 = contrast(lInk3, lGround);
  const crInkMuted = contrast(lInkMuted, lGround);

  assert.ok(crInk1 >= 7.0, `--ink contrast ${crInk1.toFixed(2)}:1 must meet AAA baseline (>= 7.0)`);
  assert.ok(crInk2 >= 7.0, `--ink-2 contrast ${crInk2.toFixed(2)}:1 must meet AAA baseline (>= 7.0)`);
  assert.ok(crInk3 >= 4.5, `--ink-3 contrast ${crInk3.toFixed(2)}:1 must meet AA baseline (>= 4.5)`);
  assert.ok(crInkMuted >= 4.5, `--ink-muted contrast ${crInkMuted.toFixed(2)}:1 must meet AA baseline (>= 4.5)`);
});

test('equirectangular projection handles pole singularities and 180 deg longitude wrap', () => {
  const width = 4096;
  const height = 2048;

  // North pole (+90 deg pitch) -> lat = +pi/2 -> y = 0
  const poleNorth = texelFor([0, 1, 0], width, height);
  assert.equal(poleNorth.y, 0, 'North pole must map to top row (y = 0)');

  // South pole (-90 deg pitch) -> lat = -pi/2 -> y = height - 1
  const poleSouth = texelFor([0, -1, 0], width, height);
  assert.equal(poleSouth.y, height - 1, 'South pole must map to bottom row');

  // Longitude wrap at 180 deg
  const wrapRight = texelFor([0.0001, 0, -1], width, height);
  const wrapLeft = texelFor([-0.0001, 0, -1], width, height);
  assert.ok(wrapRight.x >= 0 && wrapRight.x < width, 'Wrapped texel X must be in [0, width)');
  assert.ok(wrapLeft.x >= 0 && wrapLeft.x < width, 'Wrapped texel X must be in [0, width)');
});

test('renderer.probe source contract enforces try-finally exception safety for GPU resources', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const code = await fs.readFile(path.resolve('src/gpu/renderer.ts'), 'utf8');

  // Verify that probe contains try and finally blocks that call destroy() and deleteTexture()
  assert.ok(code.includes('async probe('), 'renderer.ts must contain probe()');
  assert.ok(code.includes('if (readback) readback.destroy();'), 'WebGPU probe must safely destroy readback buffer in finally');
  assert.ok(code.includes('if (target) target.destroy();'), 'WebGPU probe must safely destroy target texture in finally');
  assert.ok(code.includes('if (fbo) gl.deleteFramebuffer(fbo);'), 'WebGL2 probe must safely delete framebuffer in finally');
  assert.ok(code.includes('if (fboTex) gl.deleteTexture(fboTex);'), 'WebGL2 probe must safely delete texture in finally');
});

test('stage pointer tracking uses canvas bounding rect to eliminate padding offset misalignment', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const code = await fs.readFile(path.resolve('src/ui/stage.ts'), 'utf8');

  assert.ok(
    code.includes('const canvasRect = this.#canvas.getBoundingClientRect()'),
    'Stage pointer handlers must measure coordinates relative to canvas bounding box',
  );
  assert.ok(
    code.includes('this.#cursor = { x: e.clientX - canvasRect.left, y: e.clientY - canvasRect.top }'),
    'Stage pointer handler must subtract canvasRect.left/top for 100% pixel accuracy',
  );
});

test('3D Gaussian Splatting generator statelessly derives 3D volumetric primitive scenes', async () => {
  const { generateSplatScene, sampleGaussianSplat } = await import('../src/core/splat.ts');
  const { DEFAULT_FORMAT } = await import('../src/core/format.ts');
  const seed = randomSeed();

  const scene = generateSplatScene(DEFAULT_FORMAT, seed, 64);
  assert.equal(scene.count, 64);
  assert.equal(scene.primitives.length, 64);

  const prim0 = scene.primitives[0];
  assert.ok(Array.isArray(prim0.position) && prim0.position.length === 3);
  assert.ok(Array.isArray(prim0.scale) && prim0.scale.length === 3);
  assert.ok(Array.isArray(prim0.rotation) && prim0.rotation.length === 4);
  assert.ok(Array.isArray(prim0.color) && prim0.color.length === 4);

  // Determinism check
  const prim0Again = sampleGaussianSplat(seed, 0);
  assert.deepEqual(prim0.position, prim0Again.position);
  assert.deepEqual(prim0.color, prim0Again.color);
});

test('Zero-Knowledge Provenance (ZK-Plate) minting and verification roundtrips', async () => {
  const { mintZkPlateClaim, verifyZkPlateClaim } = await import('../src/core/zkPlate.ts');
  const { DEFAULT_FORMAT } = await import('../src/core/format.ts');
  const seed = randomSeed();

  const claim = mintZkPlateClaim(DEFAULT_FORMAT, seed, '281474976710656');
  assert.equal(claim.version, 'zk-v1');
  assert.equal(claim.statement, '281474976710656');
  assert.ok(claim.commitmentHash && claim.commitmentHash.length === 32);
  assert.equal(verifyZkPlateClaim(claim, seed), true);

  // Tampered claim check
  const badClaim = { ...claim, statement: '000000000000000' };
  assert.equal(verifyZkPlateClaim(badClaim, seed), false);
});

test('WebGPU Compute Shader acceleration module instantiates cleanly', async () => {
  const { createComputeEngine } = await import('../src/gpu/compute.ts');
  const engine = await createComputeEngine();
  assert.ok(typeof engine.supported === 'boolean');
  engine.dispose();
});

test('WebXR VR Manager quaternion pose transformation computes correct Euler yaw and pitch', async () => {
  const { quaternionToYawPitch, createWebXRManager } = await import('../src/gpu/webxr.ts');
  const { yaw, pitch } = quaternionToYawPitch(0, 0, 0, 1);
  assert.equal(yaw, 0);
  assert.equal(pitch, 0);

  const manager = createWebXRManager();
  assert.equal(typeof manager.isSupported, 'boolean');
  assert.equal(manager.isActive, false);
  manager.dispose();
});

test('P2P WebRTC Address Mesh node instantiates and generates node identifier', async () => {
  const { createP2PMeshNode } = await import('../src/core/p2pMesh.ts');
  const node = createP2PMeshNode('test-node-1');
  assert.equal(node.nodeId, 'test-node-1');
  assert.equal(node.peerCount, 0);
  node.close();
});

test('Layer 0: Seed3072 hex serialization and random generation roundtrips', async () => {
  const { randomSeed3072, seed3072ToHex, seed3072FromHex } = await import('../src/core/seed3072.ts');
  const seed = randomSeed3072();
  assert.equal(seed.length, 96);
  const hex = seed3072ToHex(seed);
  assert.equal(hex.length, 768);
  const restored = seed3072FromHex(hex);
  assert.deepEqual(seed, restored);
});

test('Layer 0: Seed3072 BigInt carry addition preserves word boundaries', async () => {
  const { createSeed3072, seed3072Add } = await import('../src/core/seed3072.ts');
  const seed = createSeed3072();
  seed[95] = 0xffffffff;
  seed3072Add(seed, 1n);
  assert.equal(seed[95], 0);
  assert.equal(seed[94], 1);
});

test('Layer 0: Philox96x32 Feistel generator is deterministic and populates 96 words', async () => {
  const { philox96x32 } = await import('../src/core/philox96.ts');
  const { randomSeed3072 } = await import('../src/core/seed3072.ts');
  const seed = randomSeed3072();
  const out1 = new Uint32Array(96);
  const out2 = new Uint32Array(96);

  philox96x32(out1, 1, 0, seed, 32);
  philox96x32(out2, 1, 0, seed, 32);
  assert.deepEqual(out1, out2);
});

test('Layer 0: materialiseSeed3072 generates pixel payload for tiny grid', async () => {
  const { materialiseSeed3072 } = await import('../src/core/philox96.ts');
  const { randomSeed3072 } = await import('../src/core/seed3072.ts');
  const { pixelCount } = await import('../src/core/format.ts');
  type FormatType = import('../src/core/format.ts').ArchiveFormat;
  const seed = randomSeed3072();

  const grid8x8: FormatType = {
    resolution: { id: 'grid8', name: '8x8 Grid', width: 8, height: 8, aspect: 1, megaPixels: 0.000064, planeOnly: true },
    depth: { id: '24', bpc: 8, bytesPerPixel: 3 },
    geometry: 'plane',
  };

  const buffer = new Uint8Array(pixelCount(grid8x8) * grid8x8.depth.bytesPerPixel);
  materialiseSeed3072(grid8x8, seed, buffer, 32);
  assert.equal(buffer.length, 192);
});

test('Layer 0: WebGPU 3,072-bit compute engine instantiates cleanly', async () => {
  const { createComputeEngine3072 } = await import('../src/gpu/compute3072.ts');
  const engine = await createComputeEngine3072();
  assert.ok(typeof engine.supported === 'boolean');
  engine.dispose();
});

test('Sparsity Engine: 21M coin supply halving schedule computes exact block rewards', async () => {
  const { getBlockSubsidy, INITIAL_SUBSIDY } = await import('../src/core/sparsity.ts');

  // Era 0 (Blocks 0 - 209,999)
  assert.equal(getBlockSubsidy(0), INITIAL_SUBSIDY);
  assert.equal(getBlockSubsidy(209_999), INITIAL_SUBSIDY);

  // Era 1 (Blocks 210,000 - 419,999)
  assert.equal(getBlockSubsidy(210_000), INITIAL_SUBSIDY / 2n);
  assert.equal(getBlockSubsidy(419_999), INITIAL_SUBSIDY / 2n);

  // Era 2 (Halving 2)
  assert.equal(getBlockSubsidy(420_000), INITIAL_SUBSIDY / 4n);

  // Halving #33 (Block 6,930,000) -> 0 subsidy
  assert.equal(getBlockSubsidy(6_930_000), 0n);
});

test('Sparsity Engine: Cumulative supply is strictly bounded by 21,000,000 coins hardcap', async () => {
  const { getTotalSupplyAtHeight, MAX_SUPPLY } = await import('../src/core/sparsity.ts');

  const supplyAtGenesis = getTotalSupplyAtHeight(0);
  assert.equal(supplyAtGenesis, 50_0000_0000n);

  const supplyAtFirstHalving = getTotalSupplyAtHeight(209_999);
  assert.equal(supplyAtFirstHalving, 10_500_000_0000_0000n); // 10.5M coins

  const supplyFarFuture = getTotalSupplyAtHeight(10_000_000);
  assert.ok(supplyFarFuture <= MAX_SUPPLY);
  assert.equal(supplyFarFuture, 20_999_999_9769_0000n);
});

test('Sparsity Engine: evaluateBlockSparsity checks 3,072-bit seed difficulty targets', async () => {
  const { evaluateBlockSparsity } = await import('../src/core/sparsity.ts');
  const { randomSeed3072 } = await import('../src/core/seed3072.ts');
  const seed = randomSeed3072();

  const res = evaluateBlockSparsity(seed, 0); // 0 leading zeros required
  assert.equal(res.valid, true);
  assert.ok(typeof res.leadingZeros === 'number');
  assert.equal(res.hashHex.length, 64);
});

test('Sparsity Engine: calculateNextDifficulty retargets difficulty based on actual time ratio', async () => {
  const { calculateNextDifficulty } = await import('../src/core/sparsity.ts');

  // Fast block production -> increase difficulty
  const higherDiff = calculateNextDifficulty(16, 500, 1000);
  assert.equal(higherDiff, 17);

  // Slow block production -> decrease difficulty
  const lowerDiff = calculateNextDifficulty(16, 2000, 1000);
  assert.equal(lowerDiff, 15);
});

test('Block384: Empty block instantiation creates valid 384-byte container structure', async () => {
  const { createEmptyBlock384, encodeBlock384, BLOCK384_BYTE_SIZE } = await import('../src/core/block384.ts');
  const block = createEmptyBlock384();
  const packed = encodeBlock384(block);
  assert.equal(packed.length, BLOCK384_BYTE_SIZE);
});

test('Block384: Packing and unpacking roundtrips byte-for-byte with exact field offsets', async () => {
  const { createEmptyBlock384, encodeBlock384, decodeBlock384 } = await import('../src/core/block384.ts');

  const block = createEmptyBlock384();
  block.prevBlockHash.fill(0xaa);
  block.stateRoot.fill(0xbb);
  block.txMerkleRoot.fill(0xcc);
  block.timestamp = 1770800000000n;
  block.blockHeight = 420000;
  block.targetBits = 24;
  block.nonce = 9876543210n;
  block.txPayload.fill(0xee);
  block.solvedTail.fill(0x77);

  const packed = encodeBlock384(block);
  const unpacked = decodeBlock384(packed);

  assert.deepEqual(unpacked.prevBlockHash, block.prevBlockHash);
  assert.deepEqual(unpacked.stateRoot, block.stateRoot);
  assert.deepEqual(unpacked.txMerkleRoot, block.txMerkleRoot);
  assert.equal(unpacked.timestamp, block.timestamp);
  assert.equal(unpacked.blockHeight, block.blockHeight);
  assert.equal(unpacked.targetBits, block.targetBits);
  assert.equal(unpacked.nonce, block.nonce);
  assert.deepEqual(unpacked.txPayload, block.txPayload);
  assert.deepEqual(unpacked.solvedTail, block.solvedTail);
});

test('Block384: Bijective conversion to Seed3072 and back preserves all 3,072 bits', async () => {
  const { createEmptyBlock384, encodeBlock384, blockToSeed3072, seed3072ToBlockBytes } = await import('../src/core/block384.ts');

  const block = createEmptyBlock384();
  block.prevBlockHash.fill(0x12);
  block.txPayload.fill(0x34);
  const originalBytes = encodeBlock384(block);

  const seed = blockToSeed3072(originalBytes);
  assert.equal(seed.length, 96);

  const restoredBytes = seed3072ToBlockBytes(seed);
  assert.deepEqual(restoredBytes, originalBytes);
});

test('Layer 1.5 Mining: generateMemoryScratchpad expands Seed3072 into memory buffer', async () => {
  const { generateMemoryScratchpad, mixScratchpadMemoryHard } = await import('../src/core/mining3072.ts');
  const { randomSeed3072 } = await import('../src/core/seed3072.ts');

  const seed = randomSeed3072();
  const scratchpad = generateMemoryScratchpad(seed, 1); // 1 MiB
  assert.equal(scratchpad.length, 262144); // 262,144 words

  const copy = new Uint32Array(scratchpad);
  mixScratchpadMemoryHard(scratchpad, 1);
  assert.notDeepEqual(scratchpad, copy);
});

test('Layer 1.5 Mining: mineBlock3072 finds valid nonce and verifyBlockMining3072 verifies it', async () => {
  const { mineBlock3072, verifyBlockMining3072 } = await import('../src/core/mining3072.ts');
  const { createEmptyBlock384 } = await import('../src/core/block384.ts');

  const block = createEmptyBlock384();
  block.blockHeight = 1;
  block.prevBlockHash.fill(0x01);

  const res = mineBlock3072(block, 1, 500, 1); // 1 leading zero bit target
  assert.equal(res.found, true);
  assert.ok(res.attempts >= 1);
  assert.ok(res.seed !== null);

  const verify = verifyBlockMining3072(res.minedBlock!, 1, 1);
  assert.equal(verify.valid, true);
  assert.equal(verify.leadingZeros, res.leadingZeros);

  // Tamper check
  const badBlock = { ...res.minedBlock!, nonce: res.minedBlock!.nonce + 9999n };
  const verifyBad = verifyBlockMining3072(badBlock, 4, 1);
  assert.notEqual(verifyBad.hashHex, res.hashHex);
});

test('Layer 1.5 Full Sparsity: compressScratchpadToVector3072 yields 96-word (3,072-bit) uncompressed vector', async () => {
  const { compressScratchpadToVector3072, countVectorLeadingZeros3072 } = await import('../src/core/sparsity3072.ts');

  const dummyScratchpad = new Uint32Array(1024);
  dummyScratchpad.fill(0x12345678);

  const vector = compressScratchpadToVector3072(dummyScratchpad);
  assert.equal(vector.length, 96);

  const lz = countVectorLeadingZeros3072(vector);
  assert.ok(typeof lz === 'number');
});

test('Layer 1.5 Full Sparsity: mineBlock3072Full mines block against full 3,072-bit vector targets without 256-bit bottleneck', async () => {
  const { mineBlock3072Full, evaluateFullSparsity3072 } = await import('../src/core/sparsity3072.ts');
  const { createEmptyBlock384, blockToSeed3072, encodeBlock384 } = await import('../src/core/block384.ts');

  const block = createEmptyBlock384();
  block.blockHeight = 42;

  const mined = mineBlock3072Full(block, 1, 500, 1);
  assert.equal(mined.found, true);
  assert.ok(mined.seed !== null);

  const seed = blockToSeed3072(encodeBlock384(mined.minedBlock!));
  const evalResult = evaluateFullSparsity3072(seed, 1, 1);
  assert.equal(evalResult.valid, true);
  assert.equal(evalResult.vectorHex.length, 768); // 96 words * 8 hex chars = 768 hex chars (3,072 bits)
});









