/**
 * Plates.
 *
 * A plate is an image with fifteen digits printed on its face, and those digits
 * are the last fifteen digits of the number that image *is*. Not a caption, not
 * a hash, not a lookup — the picture and the number are the same object, so the
 * picture can be solved for.
 *
 * The construction: stamp the ground and the digits, which fixes every byte of
 * the address except the last seven. Those seven live in the bottom-right two
 * pixels, are not part of any glyph, and are then solved so the whole 119-
 * million-digit number ends in the digits already printed. Nothing is adjusted
 * afterwards, so nothing can drift.
 *
 * This is the one thing in the project that an archive built on lookup keys
 * cannot do at all. It is also fragile on purpose: re-encode a plate, screenshot
 * it, or let a platform recompress it, and the claim becomes false. That makes
 * it a proof of unmodified transmission with no key, no signature, and nobody
 * to trust — but only if the fragility is stated, which is why the plate says so
 * on its own face, inside the region that makes it true.
 *
 * Everything here must be bit-identical on every machine. Hence an embedded
 * bitmap font at integer scale rather than canvas text, exact 16-bit ink values,
 * nearest sampling, and no floating point anywhere in the composition path.
 */

import { type Seed } from './philox';
import { materialiseSeed, solveTail, trailingDecimalDigits, TAIL_BYTES } from './address';
import type { ArchiveFormat } from './format';

// ---------------------------------------------------------------------------
// Font
// ---------------------------------------------------------------------------

/**
 * 5 x 7, one string per row. Deliberately a stencil: a plate should look
 * stamped, and blocky glyphs survive integer scaling without a single decision
 * that could differ between two machines.
 */
const GLYPHS: Record<string, readonly string[]> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  "'": ['.##..', '.##..', '.#...', '.....', '.....', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

function glyph(ch: string): readonly string[] {
  return GLYPHS[ch.toUpperCase()] ?? GLYPHS[' '];
}

/** Width in image pixels of `text` rendered at `scale`, including inter-glyph gaps. */
function textWidth(text: string, scale: number, tracking: number): number {
  if (text.length === 0) return 0;
  return text.length * (GLYPH_W * scale + tracking) - tracking;
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

export interface PlateLayout {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  /** Grid this layout is defined for; a layout is only valid at its own size. */
  readonly width: number;
  readonly height: number;
  readonly panel: { x: number; y: number; w: number; h: number };
  readonly rule: number;
  readonly eyebrow: { text: string; scale: number; tracking: number; y: number };
  readonly statement: { scale: number; tracking: number; y: number };
  readonly caption: { lines: readonly string[]; scale: number; tracking: number; y: number; leading: number };
  /** 16-bit channel triples. Exact values, never derived at runtime. */
  readonly ink: readonly [number, number, number];
  readonly ground: readonly [number, number, number];
}

const INK: readonly [number, number, number] = [0xf0f0, 0xeaea, 0xe0e0]; // bone, 8-bit x 257
const GROUND: readonly [number, number, number] = [0x1515, 0x1313, 0x1111]; // warm graphite

/**
 * Frozen forever once released. A layout may be superseded but never edited:
 * every plate ever minted under it has to keep verifying, and verification
 * compares against these exact numbers.
 */
export const PLATE_LAYOUTS: readonly PlateLayout[] = [
  {
    id: 'I',
    version: 1,
    label: 'Plate I — statement',
    width: 3840,
    height: 2160,
    panel: { x: 384, y: 560, w: 3072, h: 1040 },
    rule: 4,
    eyebrow: { text: 'UNIVERSAL IMAGE ARCHIVE', scale: 8, tracking: 16, y: 700 },
    statement: { scale: 30, tracking: 22, y: 900 },
    caption: {
      lines: [
        'THE LAST FIFTEEN DIGITS OF THIS IMAGE\'S OWN ADDRESS',
        'TRUE ONLY IN ITS EXACT BYTES',
      ],
      scale: 7,
      tracking: 10,
      y: 1300,
      leading: 90,
    },
    ink: INK,
    ground: GROUND,
  },
];

export function layoutFor(format: ArchiveFormat, id: string): PlateLayout | null {
  const layout = PLATE_LAYOUTS.find((l) => l.id === id) ?? PLATE_LAYOUTS[0];
  if (!layout) return null;
  if (layout.width !== format.resolution.width || layout.height !== format.resolution.height) {
    return null;
  }
  return layout;
}

/** A plate needs 16-bit channels: the ink values are defined as 16-bit triples. */
export function plateSupported(format: ArchiveFormat, id = 'I'): boolean {
  return format.depth.bpc === 16 && layoutFor(format, id) !== null;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

function put(
  bytes: Uint8Array,
  width: number,
  x: number,
  y: number,
  rgb: readonly [number, number, number],
): void {
  const o = (y * width + x) * 6;
  bytes[o] = rgb[0] >>> 8;
  bytes[o + 1] = rgb[0] & 0xff;
  bytes[o + 2] = rgb[1] >>> 8;
  bytes[o + 3] = rgb[1] & 0xff;
  bytes[o + 4] = rgb[2] >>> 8;
  bytes[o + 5] = rgb[2] & 0xff;
}

function fill(
  bytes: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: readonly [number, number, number],
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) put(bytes, width, x, y, rgb);
  }
}

/** Stamps `text` and returns the pixel rectangles it occupied, for readback. */
function stamp(
  bytes: Uint8Array,
  width: number,
  text: string,
  x0: number,
  y0: number,
  scale: number,
  tracking: number,
  ink: readonly [number, number, number],
): void {
  let x = x0;
  for (const ch of text) {
    const rows = glyph(ch);
    for (let gy = 0; gy < GLYPH_H; gy++) {
      const row = rows[gy];
      for (let gx = 0; gx < GLYPH_W; gx++) {
        if (row[gx] !== '#') continue;
        fill(bytes, width, x + gx * scale, y0 + gy * scale, scale, scale, ink);
      }
    }
    x += GLYPH_W * scale + tracking;
    void y0;
  }
}

export interface PlateSpec {
  /** Coordinate whose noise becomes the ground the plate is stamped on. */
  seed: Seed;
  /** The fifteen digits to print, and to make true. */
  statement: string;
  layoutId: string;
}

export interface PlateReport {
  layout: string;
  statement: string;
  /** Pixels the layout fixes. Everything else is the ground. */
  stampedPixels: number;
  solutions: number;
}

export function normaliseStatement(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(-15);
  return digits.padStart(15, '0');
}

/** The x of each statement glyph, so readback and stamping cannot disagree. */
function statementOrigin(layout: PlateLayout): number {
  const w = textWidth('000000000000000', layout.statement.scale, layout.statement.tracking);
  return Math.round(layout.panel.x + (layout.panel.w - w) / 2);
}

function centred(layout: PlateLayout, text: string, scale: number, tracking: number): number {
  return Math.round(layout.panel.x + (layout.panel.w - textWidth(text, scale, tracking)) / 2);
}

/**
 * Stamps the full panel — ground, rules, eyebrow, statement, caption — for
 * `statement`. The single source of those pixels: composition writes them with
 * it and verification recomposes them with it, so the two cannot disagree.
 */
function stampPanel(layout: PlateLayout, statement: string, out: Uint8Array, width: number): void {
  const { panel, rule } = layout;
  fill(out, width, panel.x, panel.y, panel.w, panel.h, layout.ground);
  fill(out, width, panel.x, panel.y, panel.w, rule, layout.ink);
  fill(out, width, panel.x, panel.y + panel.h - rule, panel.w, rule, layout.ink);
  fill(out, width, panel.x, panel.y, rule, panel.h, layout.ink);
  fill(out, width, panel.x + panel.w - rule, panel.y, rule, panel.h, layout.ink);

  stamp(
    out,
    width,
    layout.eyebrow.text,
    centred(layout, layout.eyebrow.text, layout.eyebrow.scale, layout.eyebrow.tracking),
    layout.eyebrow.y,
    layout.eyebrow.scale,
    layout.eyebrow.tracking,
    layout.ink,
  );

  stamp(
    out,
    width,
    statement,
    statementOrigin(layout),
    layout.statement.y,
    layout.statement.scale,
    layout.statement.tracking,
    layout.ink,
  );

  layout.caption.lines.forEach((line, i) => {
    stamp(
      out,
      width,
      line,
      centred(layout, line, layout.caption.scale, layout.caption.tracking),
      layout.caption.y + i * layout.caption.leading,
      layout.caption.scale,
      layout.caption.tracking,
      layout.ink,
    );
  });
}

export function composePlate(
  format: ArchiveFormat,
  spec: PlateSpec,
  out: Uint8Array,
): PlateReport {
  const layout = layoutFor(format, spec.layoutId);
  if (!layout) throw new Error('That layout does not fit this grid.');
  const width = format.resolution.width;
  const statement = normaliseStatement(spec.statement);

  // The ground is the archive itself: an ordinary seeded image, stamped over.
  materialiseSeed(format, spec.seed, out);
  stampPanel(layout, statement, out, width);

  // Everything is now fixed except the final two pixels, which are ground noise
  // well outside the panel. Solving them makes the whole number end in what the
  // panel already says.
  const { solutions } = solveTail(out, Number(statement));

  const stampedPixels = layout.panel.w * layout.panel.h;
  return { layout: layout.id, statement, stampedPixels, solutions };
}

// ---------------------------------------------------------------------------
// Reading a plate back
// ---------------------------------------------------------------------------

function sample(bytes: Uint8Array, width: number, x: number, y: number): [number, number, number] {
  const o = (y * width + x) * 6;
  return [
    (bytes[o] << 8) | bytes[o + 1],
    (bytes[o + 2] << 8) | bytes[o + 3],
    (bytes[o + 4] << 8) | bytes[o + 5],
  ];
}

function same(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * Reads the fifteen printed digits by exact comparison against the reference
 * bitmaps, at the offsets the layout defines. No OCR and no tolerance: the
 * machine reads the same marks a person does, and a single altered pixel inside
 * a glyph means this is not a plate rather than meaning it is a damaged one.
 * A hidden channel would make the plate a container for a claim instead of a
 * statement of one.
 *
 * Every pixel of every cell is compared. An earlier version probed two pixels
 * per cell as a shortcut, which meant a defaced digit could still read as
 * itself — the check has to be as literal as the claim it guards.
 */
export function readPlateClaim(layout: PlateLayout, bytes: Uint8Array, width: number): string | null {
  const { scale, tracking, y } = layout.statement;
  const x0 = statementOrigin(layout);
  let digits = '';

  for (let i = 0; i < 15; i++) {
    const gx0 = x0 + i * (GLYPH_W * scale + tracking);
    let matched: string | null = null;

    for (const candidate of '0123456789') {
      const rows = glyph(candidate);
      let ok = true;
      for (let gy = 0; gy < GLYPH_H && ok; gy++) {
        for (let gx = 0; gx < GLYPH_W && ok; gx++) {
          const want = rows[gy][gx] === '#' ? layout.ink : layout.ground;
          const cellX = gx0 + gx * scale;
          const cellY = y + gy * scale;
          for (let py = 0; py < scale && ok; py++) {
            for (let px = 0; px < scale && ok; px++) {
              if (!same(sample(bytes, width, cellX + px, cellY + py), want)) ok = false;
            }
          }
        }
      }
      if (ok) {
        matched = candidate;
        break;
      }
    }
    if (matched === null) return null;
    digits += matched;
  }
  return digits;
}

/**
 * Confirms every stamped pixel of the panel — ground, rules, eyebrow, caption
 * and digits — is exactly what the layout would have stamped for `statement`.
 *
 * This is what stops a plate whose caption has been quietly erased, or whose
 * warning has been repainted, from verifying: the caption is part of what makes
 * the object honest, so it is part of what the verdict covers. Composing a
 * reference and comparing bytes reuses the exact stamping code, which means the
 * check cannot drift from the construction.
 */
export function panelMatches(
  layout: PlateLayout,
  statement: string,
  bytes: Uint8Array,
  width: number,
): boolean {
  const reference = new Uint8Array(bytes.length);
  stampPanel(layout, statement, reference, width);

  const { panel } = layout;
  for (let y = panel.y; y < panel.y + panel.h; y++) {
    const rowStart = (y * width + panel.x) * 6;
    const rowEnd = rowStart + panel.w * 6;
    for (let o = rowStart; o < rowEnd; o++) {
      if (bytes[o] !== reference[o]) return false;
    }
  }
  return true;
}

export interface PlateVerdict {
  isPlate: boolean;
  layout: string | null;
  printed: string | null;
  computed: string;
  valid: boolean;
  /** Set when the file is an image but carries no readable plate. */
  note: string;
}

export function verifyPlate(format: ArchiveFormat, bytes: Uint8Array): PlateVerdict {
  const computed = trailingDecimalDigits(bytes, 15);

  if (format.depth.bpc !== 16) {
    return {
      isPlate: false,
      layout: null,
      printed: null,
      computed,
      valid: false,
      // Carefully not claiming this WAS a plate: most 8-bit images never were.
      note: 'Plates carry their claim in 16-bit channels; this file has 8, so there is no claim here to check. If it began as a plate, the re-encoding that halved it also unmade it.',
    };
  }

  for (const layout of PLATE_LAYOUTS) {
    if (layout.width !== format.resolution.width || layout.height !== format.resolution.height) {
      continue;
    }
    const printed = readPlateClaim(layout, bytes, format.resolution.width);
    if (printed === null) continue;

    // The digits are readable — now the whole panel must be exactly what the
    // layout stamps, caption and warning included. Without this, the parts of
    // the plate that explain the plate could be edited away and it would still
    // verify, which would make the object a liar about itself.
    if (!panelMatches(layout, printed, bytes, format.resolution.width)) {
      return {
        isPlate: true,
        layout: layout.id,
        printed,
        computed,
        valid: false,
        note: 'The digits read cleanly but the panel around them has been altered. A plate is its exact bytes, all of them.',
      };
    }

    return {
      isPlate: true,
      layout: layout.id,
      printed,
      computed,
      valid: printed === computed,
      note:
        printed === computed
          ? 'The digits on this plate are the last fifteen digits of its own address.'
          : 'These bytes are not the bytes that were minted. Something re-encoded this image.',
    };
  }

  return {
    isPlate: false,
    layout: null,
    printed: null,
    computed,
    valid: false,
    note: 'No plate here — just an image, like every other image in the archive.',
  };
}

// ---------------------------------------------------------------------------
// Self-check
// ---------------------------------------------------------------------------

/**
 * A plate minted in one browser has to verify in every other, or the object is
 * worthless. This composes a real plate, reads it back, and confirms the
 * arithmetic closes — the same reasoning as the generator's reference vectors:
 * a wrong plate looks exactly like a right plate.
 */
export function plateSelfTest(format: ArchiveFormat, seed: Seed): { ok: boolean; detail: string } {
  const layout = layoutFor(format, 'I');
  if (!layout || format.depth.bpc !== 16) return { ok: true, detail: 'plate check skipped for this format' };

  const bytes = new Uint8Array(
    format.resolution.width * format.resolution.height * format.depth.bytesPerPixel,
  );
  const target = '123456789012345';
  composePlate(format, { seed, statement: target, layoutId: 'I' }, bytes);

  const printed = readPlateClaim(layout, bytes, format.resolution.width);
  const computed = trailingDecimalDigits(bytes, 15);
  const ok = printed === target && computed === target;
  return {
    ok,
    detail: ok
      ? `plate composes and reads back exactly (tail solved in ${TAIL_BYTES} bytes)`
      : `printed=${printed} computed=${computed} target=${target}`,
  };
}
