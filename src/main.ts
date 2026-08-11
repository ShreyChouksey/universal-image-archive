/**
 * Universal Image Archive — application shell.
 *
 * Two lanes of navigation, one stage. Coordinates are cheap and shareable and
 * render straight off the GPU; addresses are exact, enormous, and only
 * materialised when someone asks for one. Everything below is the wiring that
 * keeps those two representations honest with each other.
 */

import { ArchiveClient, type Progress, type SearchOptions } from './core/archiveClient';
import {
  DEFAULT_FORMAT,
  DEPTHS,
  GEOMETRIES,
  LIMITS,
  RESOLUTIONS,
  type ArchiveFormat,
  type FormatCapacity,
  type Geometry,
  type Resolution,
  customResolution,
  defaultResolutionFor,
  depthById,
  formatCapacity,
  resolutionById,
  resolutionsFor,
} from './core/format';
import { createRenderer, PROBE, type Renderer } from './gpu/renderer';
import { decodePng } from './core/png';
import {
  PLATE_LAYOUTS,
  normaliseStatement,
  plateSupported,
  type PlateReport,
  type PlateVerdict,
} from './core/plate';
import { BIGINT_MAX_BYTES, archiveScale, sampleSeed, unpackAddressFile } from './core/address';
import {
  randomSeed,
  seedAdd,
  seedFromHex,
  seedFromPhrase,
  seedToHex,
  selfTest,
  type Seed,
} from './core/philox';
import { EQUAL_AREA_EFFICIENCY, arcminPerTexel, planeArcminPerPixel, screenToTexel } from './core/sphere';
import {
  CarryEscaped,
  applyOffsetToTail,
  sampleAt,
  seedHeadBytes,
  seedTailBytes,
  tailPatch,
  tailPatchFromBytes,
  type TailPatch,
} from './core/offset';
import { DECIMAL_MODULUS } from './core/address';
import { Stage } from './ui/stage';
import { Reader, drawHistogram } from './ui/reader';
import { addressAnchors, archiveAnchors, describeDecimalCost } from './core/magnitude';
import { bytesHuman, group, scaleWord, superscript } from './ui/numbers';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * What the worker's single address buffer currently holds.
 *
 * 'seed' is an address materialised from a coordinate, `offset` steps away from
 * it — offset 0 means the coordinate on the bench genuinely names these bytes.
 * 'foreign' is an address with no coordinate at all: a located photograph, an
 * opened file, a plate. Tracking this explicitly is what stops the interface
 * from ever showing a coordinate as if it named a picture it does not, and from
 * quietly destroying a loaded image when the user travels the coordinate lane.
 *
 * Both loaded variants remember where they came from, and that memory is what
 * makes crossing between the lanes reversible. Without it, parking a picture,
 * walking the coordinate lane and returning would leave the coordinate stranded
 * wherever the walk ended — the arrows would then be moving a different lane on
 * the way home than they moved on the way out, and the journey would not undo.
 */
type Held =
  | { kind: 'none' }
  | { kind: 'seed'; seed: Seed; offset: number }
  | { kind: 'foreign'; label: string; origin: Seed };

interface State {
  format: ArchiveFormat;
  seed: Seed;
  offset: number;
  headOffset: number;
  rounds: number;
  entropyMode: boolean;
  /** 'seed' renders from the coordinate and offset; 'address' renders a texture. */
  mode: 'seed' | 'address';
  held: Held;
  playing: boolean;
}

const state: State = {
  format: DEFAULT_FORMAT,
  seed: randomSeed(),
  offset: 0,
  headOffset: 0,
  rounds: 12,
  entropyMode: false,
  mode: 'seed',
  held: { kind: 'none' },
  playing: false,
};

/** The tail patch for the current location, recomputed only when it moves. */
let patch: TailPatch | null = null;

/**
 * Everything about the loaded address that lets a nearby one be described
 * without asking the worker again: its head, its tail, and its residue.
 *
 * A step only rewrites the tail, and the residue of base+delta is
 * (residue+delta) mod 10^15 exactly — so with these three in hand a located
 * photograph walks at the same cost as a generated one, and the 47 MiB sits
 * untouched in the worker the whole time.
 */
let base: { head: Uint8Array; tail: Uint8Array; residue: number; digits: number; headOffset: number } | null = null;

function refreshPatch(): boolean {
  try {
    patch =
      state.mode === 'address'
        ? base
          ? tailPatchFromBytes(state.format, base.tail, state.offset)
          : null
        : tailPatch(state.format, state.seed, state.offset);
    return true;
  } catch (error) {
    if (error instanceof CarryEscaped) return false;
    throw error;
  }
}

/**
 * Fold a pending offset into the worker's bytes.
 *
 * Stepping leaves the buffer at the base and carries the drift separately,
 * which is what makes it free. Anything that needs the address to actually BE
 * the bytes — exporting, verifying a plate, reading it in the panel — calls
 * this first. It is one step of arithmetic on 47 MiB, paid once at the moment
 * it matters rather than on every press.
 */
async function flushOffset(): Promise<void> {
  if (state.offset === 0 || state.mode !== 'address' || state.held.kind === 'none') return;
  const delta = state.offset;
  const changedFrom = await client.step(delta);
  state.offset = 0;
  patch = null;

  // Repaint the rows the carry reached, and refresh the cached base.
  const { width, height } = state.format.resolution;
  const bpp = state.format.depth.bytesPerPixel;
  const firstRow = Math.max(0, Math.floor(changedFrom / bpp / width));
  if (addressTexels) {
    const band = await client.textureRows(firstRow, height - firstRow);
    renderer.updateAddressRows(band.y0, band.rows, band.data);
    addressTexels.set(band.data, band.y0 * width * 4);
  } else {
    await adoptWorkerAddress();
  }
  await renderAddressReadout();
  requestDraw();
}

const sameSeed = (a: Seed, b: Seed): boolean =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/**
 * True when the worker's bytes are the image on the stage — or can be made so
 * by folding in a pending offset, which `flushOffset` does on demand.
 */
function workerMatchesStage(): boolean {
  if (state.mode === 'address') return state.held.kind !== 'none';
  return (
    state.offset === 0 &&
    state.held.kind === 'seed' &&
    state.held.offset === 0 &&
    sameSeed(state.held.seed, state.seed)
  );
}

/** True when the coordinate on the bench genuinely names the picture on the stage. */
function coordinateNamesStage(): boolean {
  if (state.mode === 'seed') return true;
  return (
    state.held.kind === 'seed' && state.held.offset === 0 && sameSeed(state.held.seed, state.seed)
  );
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const client = new ArchiveClient();
let renderer: Renderer;
let stage: Stage;
/** Retained alongside the GPU copy so the loupe can read exact values in address mode. */
let addressTexels: Uint16Array | null = null;
let reader: Reader | null = null;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

let frameQueued = false;

function requestDraw(): void {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    renderer.draw(
      { format: state.format, mode: state.mode, seed: state.seed, rounds: state.rounds, patch },
      stage.view,
    );
  });
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function toast(message: string): void {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout((el as HTMLElement & { _t?: number })._t);
  (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

let busyDepth = 0;

function busy(on: boolean, label = '', fraction = 0): void {
  busyDepth = Math.max(0, busyDepth + (on ? 1 : -1));
  const el = $('busy');
  el.hidden = busyDepth === 0;
  if (label) $('busyLabel').textContent = label;
  ($('busyFill') as HTMLElement).style.width = `${Math.round(fraction * 100)}%`;
}

const onProgress = (p: Progress): void => {
  $('busyLabel').textContent = p.label;
  ($('busyFill') as HTMLElement).style.width = `${Math.round(p.fraction * 100)}%`;
};

// ---------------------------------------------------------------------------
// Readouts
// ---------------------------------------------------------------------------

/** Whether the current grid can be resolved to an address on this GPU. */
function capacity(): FormatCapacity {
  return formatCapacity(
    state.format,
    renderer?.capabilities.maxTextureDimension ?? LIMITS.defaultMaxTextureDimension,
  );
}

function renderScale(): void {
  const s = archiveScale(state.format);
  const cap = capacity();
  $('scale').innerHTML = `
    <div><b>${group(s.pixels)}</b> pixels · <b>${scaleWord(s.colours)}</b> colours</div>
    <div>address <b>${bytesHuman(s.bytes)}</b> · <b>${group(s.bits)}</b> bits</div>
    <div>archive holds <b>10<sup>${group(s.cardinalityExponent)}</sup></b> images</div>
    ${
      geometryOf() === 'sphere'
        ? `<div>${arcminPerTexel(state.format.resolution.width).toFixed(2)}′ per texel · <b>${Math.round(
            EQUAL_AREA_EFFICIENCY * 100,
          )}%</b> equal-area</div>`
        : ''
    }
    ${cap.materialisable ? '' : `<div class="scale__warn">browse only — ${cap.reason}</div>`}
  `;

  $('aboutFormat').textContent = `${state.format.resolution.note} and ${state.format.depth.label}`;
  $('aboutDigits').textContent = group(s.cardinalityDigits);
  $('aboutPixels').textContent = group(s.pixels);

  $('facts').innerHTML = [
    ['Grid', `${state.format.resolution.width} × ${state.format.resolution.height}`],
    ['Channel depth', `${state.format.depth.bpc} bits`],
    ['Distinct colours', group(s.colours)],
    ['Address size', bytesHuman(s.bytes)],
    ['Address, in bits', group(s.bits)],
    ['Images in the archive', `10${superscript(s.cardinalityExponent)}`],
    ['Coordinates available', `2¹²⁸ ≈ 3.40 × 10³⁸`],
    ...(geometryOf() === 'sphere'
      ? ([
          ['Angular pitch', `${arcminPerTexel(state.format.resolution.width).toFixed(2)}′ / texel`],
          ['Equal-area efficiency', `${(EQUAL_AREA_EFFICIENCY * 100).toFixed(1)}%`],
          [
            'Against a flat 4K frame',
            `${(
              arcminPerTexel(state.format.resolution.width) / planeArcminPerPixel(3840)
            ).toFixed(2)}× coarser`,
          ],
        ] as Array<[string, string]>)
      : []),
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');
}

const geometryOf = (): Geometry => state.format.resolution.geometry;

function renderResolutionOptions(): void {
  const sel = $<HTMLSelectElement>('resolution');
  const current = state.format.resolution;
  const listed = resolutionsFor(geometryOf());
  const options = listed
    .map((r) => `<option value="${r.id}">${r.label} — ${r.note}</option>`)
    .join('');
  // A custom grid is real while it is in use, so the select must be able to
  // say so rather than displaying the wrong entry.
  const custom =
    current.geometry === geometryOf() && !listed.some((r) => r.id === current.id)
      ? `<option value="${current.id}">${current.label} — ${current.note}</option>`
      : '';
  sel.innerHTML = custom + options;
  sel.value = current.id;
}

function setGeometry(geometry: Geometry): void {
  if (geometry === geometryOf()) return;
  state.format = { ...state.format, resolution: defaultResolutionFor(geometry) };
  $<HTMLSelectElement>('geometry').value = geometry;
  renderResolutionOptions();
  applyFormat();
}

/**
 * Keeps the chrome honest about which lane the stage is showing.
 *
 * When the picture on the stage has no coordinate, the coordinate field dims
 * and says so, the transport note explains what the arrows will actually do,
 * and Copy stops pretending the link reproduces the view.
 */
function updateLaneUI(): void {
  const stale = !coordinateNamesStage();
  $<HTMLInputElement>('seedInput').dataset.stale = String(stale);
  $('coordNote').hidden = !stale;

  const badge = document.getElementById('laneBadge');
  if (badge) {
    if (state.mode === 'address') {
      badge.textContent = 'MATERIALISED ADDRESS · 3.85M DIGITS';
      badge.className = 'lane-badge lane-badge--address';
      badge.title = 'This image is at its exact base-256 address in the archive (1.52 MiB, 3.85M decimal digits)';
    } else {
      badge.textContent = 'GENERATOR SEED · PHILOX 128-BIT';
      badge.className = 'lane-badge lane-badge--seed';
      badge.title = 'A 128-bit coordinate that expands via Philox noise into a 4K frame';
    }
  }

  const step = stepSize();
  const n = step.toLocaleString('en-US');
  $('transportNote').textContent =
    state.mode === 'address'
      ? `← → walk this address by ${n}. Walk out and back the same distance and you are exactly where you were.`
      : step === 1
        ? '← → walk the coordinate lane. ± address steps to the neighbouring image — a single bit, invisible to the eye, a different picture.'
        : `← → walk the coordinate lane by ${n}. ± address moves the address itself by ${n}.`;

  // The stage-level way back: shown exactly when a loaded image is parked out
  // of view behind the coordinate lane.
  const parked = state.mode === 'seed' && state.held.kind !== 'none';
  const chip = $('parkedChip');
  chip.hidden = !parked;
  if (parked) $('parkedLabel').textContent = `${heldLabel()} is still loaded —`;
}

function renderSeed(): void {
  const input = $<HTMLInputElement>('seedInput');
  if (state.mode === 'address') {
    if (document.activeElement !== input) {
      input.value = '';
      input.placeholder = 'No 128-bit seed coordinate — photo lives at full byte address';
    }
  } else {
    input.placeholder = 'Image coordinate, 128-bit hexadecimal';
    if (document.activeElement !== input) input.value = seedToHex(state.seed);
  }
  input.dataset.invalid = 'false';
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The address readout for a location that has not been materialised.
 *
 * Head and tail come straight from the generator — a seeded address's leading
 * bytes are just its first pixels, and its trailing bytes are the patch — so
 * the exact address can be shown in the coordinate lane for the cost of a
 * dozen Philox calls. Only the decimal residue needs the whole 47 MiB, and that
 * stays behind "resolve".
 */
function renderSeedLocation(): void {
  if (state.mode === 'address') return;
  const cap = capacity();
  const scale = archiveScale(state.format);

  let headBytes = seedHeadBytes(state.format, state.seed, 16);
  if (state.headOffset !== 0) {
    const headSeed = seedFromHex(hex(headBytes)) ?? (new Uint32Array(4) as Seed);
    const updated = seedAdd(headSeed, state.headOffset);
    headBytes = new Uint8Array(updated.buffer, updated.byteOffset, updated.byteLength);
  }

  let head: string;
  let tail: string;
  try {
    head = hex(headBytes);
    tail = hex(seedTailBytes(state.format, state.seed, state.offset, 16));
  } catch {
    renderAddressPlaceholder();
    return;
  }

  const notes: string[] = [];
  if (state.headOffset !== 0) {
    notes.push(`${state.headOffset > 0 ? '+' : '−'}${Math.abs(state.headOffset).toLocaleString('en-US')} from head`);
  }
  if (state.offset !== 0) {
    notes.push(`${state.offset > 0 ? '+' : '−'}${Math.abs(state.offset).toLocaleString('en-US')} from coordinate`);
  }
  const offsetNote = notes.length > 0 ? notes.join(' · ') : 'on coordinate';

  const formattedDigits = group(scale.cardinalityDigits);
  const scaleHint = scale.cardinalityDigits > 1e6 ? ` (~${(scale.cardinalityDigits / 1e6).toFixed(2)}M digits)` : '';

  let html =
    `<div class="address-meta">` +
    `<span class="hex-chip" data-copy="${head}" title="Click to copy Head Hex">${head}</span> ` +
    `<span class="dim">…</span> ` +
    `<span class="hex-chip" data-copy="${tail}" title="Click to copy Tail Hex">${tail}</span></div>` +
    `<div class="address-meta"><span class="dim">${formattedDigits} digits${scaleHint} · ${offsetNote}`;

  if (cap.materialisable) {
    html += ' · <button class="ghost" type="button" id="materialise">resolve</button></span></div>';
  } else {
    html += '</span></div>';
  }

  if (state.held.kind !== 'none') {
    html +=
      `<div class="address-meta"><span class="dim">still loaded: ${escapeHtml(heldLabel())} —</span> ` +
      '<button class="ghost" type="button" id="heldReturn">return to it</button> ' +
      '<button class="ghost" type="button" id="heldDiscard">discard</button></div>';
  }

  $('addressReadout').innerHTML = html;

  if (cap.materialisable) {
    document.getElementById('materialise')?.addEventListener('click', () => void resolveAddress());
  }
  document.getElementById('heldReturn')?.addEventListener('click', () => void returnToHeld());
  document.getElementById('heldDiscard')?.addEventListener('click', () => void discardHeld());

  for (const id of ['stepUp', 'stepDown'] as const) {
    $<HTMLButtonElement>(id).disabled = false;
  }
  for (const id of ['exportPng', 'exportAddress'] as const) {
    const el = $<HTMLButtonElement>(id);
    el.disabled = !cap.materialisable;
    el.title = cap.materialisable ? '' : cap.reason;
  }
}

/**
 * The readout for a loaded address plus an offset, computed entirely here.
 *
 * The head is the base's head unless the carry reached it, the tail is the
 * patched tail, and the decimal residue moves by the offset — so a located
 * photograph shows its exact address while it is being walked, with the worker
 * never consulted.
 */
function renderAddressLocation(): void {
  if (state.mode !== 'address' || !base) return;

  const bpp = state.format.depth.bytesPerPixel;
  const count = Math.floor(base.tail.length / bpp) * bpp;
  const tailBytes = base.tail.slice(0, count);
  try {
    applyOffsetToTail(tailBytes, state.offset);
  } catch {
    return;
  }
  const m = DECIMAL_MODULUS;
  const residue = (((base.residue + (state.offset % m)) % m) + m) % m;
  const tailHex = hex(tailBytes.subarray(Math.max(0, tailBytes.length - 16)));
  const headHex = hex(base.head);
  const tailDec = String(residue).padStart(15, '0').slice(-12);
  const formattedDigits = group(base.digits);
  const scaleHint = base.digits > 1e6 ? ` (~${(base.digits / 1e6).toFixed(2)}M digits)` : '';

  const notes: string[] = [];
  if (base.headOffset !== 0) {
    notes.push(`${base.headOffset > 0 ? '+' : '−'}${Math.abs(base.headOffset).toLocaleString('en-US')} from head`);
  }
  if (state.offset !== 0) {
    notes.push(`${state.offset > 0 ? '+' : '−'}${Math.abs(state.offset).toLocaleString('en-US')} from base`);
  }
  const offsetNote = notes.length > 0 ? notes.join(' · ') : 'on base address';

  $('addressReadout').innerHTML =
    `<div class="address-meta">` +
    `<span class="hex-chip" data-copy="${headHex}" title="Click to copy Head Hex">${headHex}</span> ` +
    `<span class="dim">…</span> ` +
    `<span class="hex-chip" data-copy="${tailHex}" title="Click to copy Tail Hex">${tailHex}</span></div>` +
    `<div class="address-meta"><span class="dim">${formattedDigits} digits${scaleHint} · ends ` +
    `<span class="hex-chip" data-copy="${tailDec}" title="Click to copy Decimal Residue">…${tailDec}</span> · ${offsetNote}</span></div>`;
}

function renderAddressPlaceholder(): void {
  const cap = capacity();
  let html = cap.materialisable
    ? '<span class="dim">not materialised —</span> <button class="ghost" type="button" id="materialise">resolve</button>'
    : `<span class="dim">too large to resolve on this GPU</span>`;

  // A loaded image parked while the user travels the coordinate lane. The way
  // back — the whole point of parking it rather than destroying it.
  if (state.mode === 'seed' && state.held.kind !== 'none') {
    html +=
      `<br /><span class="dim">still loaded: ${escapeHtml(heldLabel())} —</span> ` +
      '<button class="ghost" type="button" id="heldReturn">return to it</button> ' +
      '<button class="ghost" type="button" id="heldDiscard">discard</button>';
  }
  $('addressReadout').innerHTML = html;

  if (cap.materialisable) {
    $('materialise').addEventListener('click', () => void resolveAddress());
  }
  document.getElementById('heldReturn')?.addEventListener('click', () => void returnToHeld());
  document.getElementById('heldDiscard')?.addEventListener('click', () => void discardHeld());
  for (const id of ['stepUp', 'stepDown', 'exportPng', 'exportAddress', 'locate'] as const) {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (!el) continue;
    if (id === 'stepUp' || id === 'stepDown') el.disabled = true;
    else if (id === 'locate') el.disabled = !pendingFile || !cap.materialisable;
    else el.disabled = !cap.materialisable;
    el.title = cap.materialisable ? '' : cap.reason;
  }
}

async function renderAddressReadout(): Promise<void> {
  const r = await client.readout();
  base = { head: r.headBytes, tail: r.tailBytes, residue: r.residue, digits: r.digitCount, headOffset: 0 };
  if (!$('addressLoaded').hidden || $('drawerTitle').textContent === TITLES.address) {
    void renderAddressPanel();
  }
  const formattedDigits = group(r.digitCount);
  const scaleHint = r.digitCount > 1e6 ? ` (~${(r.digitCount / 1e6).toFixed(2)}M digits)` : '';

  $('addressReadout').innerHTML =
    `<div class="address-meta">` +
    `<span class="hex-chip" data-copy="${r.head}" title="Click to copy Head Hex">${r.head}</span> ` +
    `<span class="dim">…</span> ` +
    `<span class="hex-chip" data-copy="${r.tail}" title="Click to copy Tail Hex">${r.tail}</span></div>` +
    `<div class="address-meta"><span class="dim">${formattedDigits} digits${scaleHint} · ends ` +
    `<span class="hex-chip" data-copy="${r.trailingDecimal}" title="Click to copy Decimal Residue">…${r.trailingDecimal}</span></span></div>`;

  $<HTMLButtonElement>('stepUp').disabled = false;
  $<HTMLButtonElement>('stepDown').disabled = false;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function setSeed(seed: Seed, { pushUrl = true, offset = 0 } = {}): void {
  if (state.held.kind !== 'none') {
    const origin = state.held.kind === 'foreign' ? state.held.origin : state.held.seed;
    const targetOffset = state.held.kind === 'seed' ? state.held.offset : 0;
    if (sameSeed(seed, origin) && offset === targetOffset) {
      void returnToHeld();
      return;
    }
  }

  const wasAddressMode = state.mode === 'address';
  state.seed = seed;
  state.offset = offset;
  state.headOffset = 0;
  state.mode = 'seed';
  refreshPatch();
  addressTexels = null;
  renderer.setAddressTexture(1, 1, null);

  const parking = wasAddressMode && state.held.kind !== 'none';
  if (parking) toast(`${heldLabel()} is still loaded — click return on stage to view it`);

  renderSeed();
  renderSeedLocation();
  updateLaneUI();
  requestDraw();
  if (pushUrl) syncUrl();
}

/**
 * How far one press of the arrows moves. Clamped to what the arithmetic behind
 * both lanes handles exactly: bumpAddress and seedAdd both decompose a signed
 * double into limbs, so anything inside 2^53 is exact in either lane.
 */
function stepSize(): number {
  // Only grouping marks are stripped. A decimal point is not a grouping mark:
  // stripping it turned "1.5" into a step of fifteen.
  const raw = $<HTMLInputElement>('stepSize').value.replace(/[\s,_']/g, '');
  const n = Math.trunc(Math.abs(Number(raw)));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Number.MAX_SAFE_INTEGER);
}

/**
 * Walk the address. Always the address — there is only one thing to walk.
 *
 * On a located picture that means stepping its materialised bytes. On a
 * coordinate it means moving the offset, which rewrites the tail of the address
 * and nothing else, so the step costs a uniform upload rather than 47 MiB. The
 * coordinate itself is no longer something you walk; it is where you jump to.
 */
function walk(delta: number): void {
  const previous = state.offset;
  state.offset += delta;
  if (!refreshPatch()) {
    // The carry ran past the tail, so bytes outside it moved too. Fold what we
    // have into the buffer and take the step properly — rare enough to be a
    // curiosity, and answered exactly rather than approximated.
    state.offset = previous;
    refreshPatch();
    void (async () => {
      await flushOffset();
      await stepAddress(delta);
    })();
    return;
  }
  requestDraw();
  if (state.mode === 'address') renderAddressLocation();
  else renderSeedLocation();
  syncUrl();
}

/** What a parked address should be called on the chip and in messages. */
function heldLabel(): string {
  if (state.held.kind === 'foreign') return state.held.label;
  if (state.held.kind === 'seed') {
    const n = Math.abs(state.held.offset).toLocaleString('en-US');
    return `an address ${n} ${state.held.offset > 0 ? 'past' : 'before'} ${seedToHex(state.held.seed).slice(0, 8)}…`;
  }
  return 'an address';
}

/**
 * Bring a parked image back onto the stage, and the bench back with it.
 *
 * Restoring the coordinate the image was parked from is what closes the loop
 * across the lanes: leave from coordinate R, wander the coordinate lane, come
 * back, and the bench reads R again — so the arrows resume meaning what they
 * meant when you left. The worker never let go of the bytes.
 */
async function returnToHeld(): Promise<void> {
  if (state.held.kind === 'none') return;
  const origin = state.held.kind === 'foreign' ? state.held.origin : state.held.seed;
  state.seed = Uint32Array.from(origin) as Seed;
  renderSeed();
  await adoptWorkerAddress();
  // The readout IS the address section now — no placeholder after it, or the
  // chip's scaffolding would paint over the very readout the return restored.
  await renderAddressReadout();
  updateLaneUI();
  syncUrl();
  toast('Returned to the loaded image');
}

async function discardHeld(): Promise<void> {
  if (state.held.kind === 'none') return;
  state.held = { kind: 'none' };
  await client.release();
  renderAddressPlaceholder();
  updateLaneUI();
}

async function resolveAddress(): Promise<void> {
  const cap = capacity();
  if (!cap.materialisable) {
    // The texture allocation fails silently on the GPU, so refusing here is the
    // difference between an explanation and an unexplained black frame.
    toast(cap.reason);
    return;
  }
  if (state.held.kind === 'foreign') {
    // The worker has one buffer, so materialising this coordinate's address
    // evicts the loaded image. That must be the user's decision, not a side
    // effect they discover afterwards.
    const ok = window.confirm(
      `Working out this coordinate's address will discard the loaded image (${heldLabel()}). Continue?`,
    );
    if (!ok) return;
  }
  busy(true, 'Materialising address', 0);
  try {
    await client.materialise(state.format, state.seed, onProgress, state.rounds);
    if (state.offset !== 0) await client.step(state.offset);
    state.held = {
      kind: 'seed',
      seed: Uint32Array.from(state.seed) as Seed,
      offset: state.offset,
    };
    await adoptWorkerAddress();
    await renderAddressReadout();
    updateLaneUI();
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not materialise the address');
  } finally {
    busy(false);
  }
}

/**
 * Step to a neighbouring address. This is a different motion from stepping the
 * coordinate: +1 alters the final pixel's least significant bit and nothing
 * else, so the picture is, to the eye, unchanged — and is a different image.
 */
let stepping = false;
let pendingStep = 0;

/**
 * Steps are serialised and coalesced, never dropped.
 *
 * Two in flight at once would race the banded repaint against the readout.
 * Refusing the extra clicks instead would be just as wrong in the other
 * direction — twelve presses have to move twelve. So presses accumulate and the
 * next pass applies whatever has piled up, in one jump.
 */
async function stepAddress(delta: number): Promise<void> {
  pendingStep += delta;
  if (stepping) return;
  if (!workerMatchesStage()) {
    await resolveAddress();
    if (!workerMatchesStage()) return;
  }
  stepping = true;
  try {
    while (pendingStep !== 0) {
      const move = pendingStep;
      pendingStep = 0;
      await applyStep(move);
    }
  } finally {
    stepping = false;
  }
}

async function applyStep(delta: number): Promise<void> {
  {
    const changedFrom = await client.step(delta);
    if (state.held.kind === 'seed') {
      state.held = { ...state.held, offset: state.held.offset + delta };
    }

    // Repaint only the rows the carry reached. A step of one touches the last
    // byte, so this is a single row instead of the whole texture — the
    // difference between stepping that feels instant and stepping that queues.
    const { width, height } = state.format.resolution;
    const bpp = state.format.depth.bytesPerPixel;
    const firstRow = Math.max(0, Math.floor(changedFrom / bpp / width));
    const rows = height - firstRow;

    if (state.mode === 'address' && addressTexels && rows * width * bpp < 4_000_000) {
      const band = await client.textureRows(firstRow, rows);
      renderer.updateAddressRows(band.y0, band.rows, band.data);
      // Keep the loupe's copy in step with the GPU's.
      addressTexels.set(band.data, band.y0 * width * 4);
      requestDraw();
    } else {
      await adoptWorkerAddress();
    }

    await renderAddressReadout();
    updateLaneUI();
  }
}

/** Pull the worker's current address onto the GPU and into the loupe's reach. */
async function adoptWorkerAddress(): Promise<void> {
  state.offset = 0;
  patch = null;
  const tex = await client.texture();
  addressTexels = tex.data;
  renderer.setAddressTexture(tex.width, tex.height, tex.data);
  state.mode = 'address';
  requestDraw();
}

function syncUrl(): void {
  const params = new URLSearchParams();
  params.set('c', seedToHex(state.seed));
  if (state.mode === 'seed' && state.offset !== 0) params.set('o', String(state.offset));
  params.set('g', geometryOf());
  params.set('r', state.format.resolution.id);
  params.set('d', state.format.depth.id);
  if (state.rounds !== 12) params.set('n', String(state.rounds));
  history.replaceState(null, '', `#${params.toString()}`);
}

function readUrl(): void {
  const params = new URLSearchParams(location.hash.slice(1));
  const c = params.get('c');
  if (c) {
    const seed = seedFromHex(c);
    if (seed) state.seed = seed;
  }
  const o = Number(params.get('o'));
  if (Number.isSafeInteger(o)) state.offset = o;
  const n = Number(params.get('n'));
  if (Number.isInteger(n) && n >= 12 && n <= 24) state.rounds = n;
  const g = params.get('g') === 'sphere' ? 'sphere' : params.get('g') === 'plane' ? 'plane' : null;
  if (params.get('r')) {
    state.format = { ...state.format, resolution: resolutionById(params.get('r')!, g ?? undefined) };
  } else if (g) {
    state.format = { ...state.format, resolution: defaultResolutionFor(g) };
  }
  if (params.get('d')) state.format = { ...state.format, depth: depthById(params.get('d')!) };
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/**
 * A grid, depth or geometry change re-parameterises the archive, so the loaded
 * address — which is bytes at the old size — cannot survive it. Ask before
 * spending someone's located picture on a dropdown.
 */
function confirmFormatChange(): boolean {
  if (state.held.kind === 'none') return true;
  return window.confirm(`Changing the format will discard the loaded image (${heldLabel()}). Continue?`);
}

function applyFormat(): void {
  reader = null;
  renderPlacementChoice();
  stage.setFormat(state.format);
  renderScale();
  state.held = { kind: 'none' };
  addressTexels = null;
  renderer.setAddressTexture(1, 1, null);
  state.mode = 'seed';
  state.offset = 0;
  refreshPatch();
  renderSeedLocation();
  updateLaneUI();
  void client.release();
  requestDraw();
  syncUrl();
  updateLowBitsHint();
  updateSearchControls();
}

function updateSearchControls(): void {
  const sphere = geometryOf() === 'sphere';
  $('placementField').hidden = !sphere;
  // Fit and margin describe placing a rectangle inside a rectangle; on a sphere
  // the lens angle does that job instead, so controls that would be ignored are
  // not shown rather than shown and disobeyed.
  ($('fit').closest('.field') as HTMLElement).hidden = sphere;
  ($('frame').closest('div') as HTMLElement).hidden = sphere;
}

function updateLowBitsHint(): void {
  $('lowBitsHint').textContent =
    state.format.depth.bpc === 16
      ? 'Uploads arrive with 8 bits per channel. The archive stores 16.'
      : 'The archive and the upload share a depth; nothing is promoted.';
  $<HTMLSelectElement>('lowBits').disabled = state.format.depth.bpc !== 16;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

let pendingFile: File | null = null;
/** Dimensions of the staged picture, read once when it is chosen. */
let pendingDims: { width: number; height: number } | null = null;

/**
 * Where a picture whose dimensions match no listed grid can live.
 *
 * 'own'      — a grid cut to its exact dimensions: the complete archive of
 *              every image that size, and this picture's true address in it.
 *              No resampling, nothing lost.
 * 'embed'    — the smallest listed grid it fits inside, surround filling the
 *              rest, exact pixels preserved at the centre.
 * 'resample' — scaled onto the grid currently on the bench.
 */
type Placement = 'own' | 'embed' | 'resample';

function smallestEmbedding(width: number, height: number): Resolution | null {
  const maxDim = renderer?.capabilities.maxTextureDimension ?? LIMITS.defaultMaxTextureDimension;
  return (
    resolutionsFor('plane')
      .filter((r) => r.width >= width && r.height >= height)
      .filter((r) => formatCapacity({ resolution: r, depth: state.format.depth }, maxDim).materialisable)
      .sort((a, b) => a.width * a.height - b.width * b.height)[0] ?? null
  );
}

/** Offers the placement choice exactly when the dimensions call for one. */
function renderPlacementChoice(): void {
  const field = $('placementChoiceField');
  if (!pendingDims || geometryOf() === 'sphere') {
    field.hidden = true;
    return;
  }
  const { width, height } = pendingDims;
  const listed = RESOLUTIONS.find((r) => r.geometry === 'plane' && r.width === width && r.height === height);
  const current = state.format.resolution;
  if (listed || (current.width === width && current.height === height)) {
    field.hidden = true;
    return;
  }

  const maxDim = renderer?.capabilities.maxTextureDimension ?? LIMITS.defaultMaxTextureDimension;
  const own = customResolution(width, height);
  const ownFits = formatCapacity({ resolution: own, depth: state.format.depth }, maxDim).materialisable;
  const embed = smallestEmbedding(width, height);

  const options: Array<[Placement, string]> = [];
  if (ownFits) options.push(['own', `Its own archive — every ${width} × ${height} image, exactly`]);
  if (embed) options.push(['embed', `Embed in ${embed.label} — smallest grid that holds it`]);
  options.push(['resample', `Resample to the grid on the bench (${current.label})`]);

  const select = $<HTMLSelectElement>('placementChoice');
  select.innerHTML = options.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
  $('placementChoiceHint').textContent = ownFits
    ? 'Its own archive keeps every pixel and gives the picture its exact address — the numbers below change to its size.'
    : 'This picture is too large for a grid of its own on this GPU.';
  field.hidden = false;
}

/** Holds a file ready for `locate()` and reflects it in the dropzone. */
function stageForSearch(file: File): void {
  pendingFile = file;
  pendingDims = null;
  const dropzone = $('dropzone');
  dropzone.dataset.loaded = 'true';
  dropzone.querySelector<HTMLElement>('.dropzone__title')!.textContent = file.name;
  dropzone.querySelector<HTMLElement>('.dropzone__hint')!.textContent = bytesHuman(file.size);

  const previewBox = document.getElementById('dropzonePreview');
  const previewImg = document.getElementById('dropzoneImg') as HTMLImageElement | null;
  if (previewBox && previewImg && file.type.startsWith('image/')) {
    previewImg.src = URL.createObjectURL(file);
    previewBox.hidden = false;
  }

  void createImageBitmap(file)
    .then((bitmap) => {
      pendingDims = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      dropzone.querySelector<HTMLElement>('.dropzone__hint')!.textContent =
        `${pendingDims.width} × ${pendingDims.height} · ${bytesHuman(file.size)}`;
      renderPlacementChoice();
    })
    .catch(() => {
      $('placementChoiceField').hidden = true;
    });
  const cap = capacity();
  $<HTMLButtonElement>('locate').disabled = !cap.materialisable;
  $('searchStatus').textContent = cap.materialisable ? '' : cap.reason;
}

function searchOptions(): SearchOptions {
  return {
    fit: $<HTMLSelectElement>('fit').value as SearchOptions['fit'],
    flip: $<HTMLSelectElement>('flip').value as SearchOptions['flip'],
    fill: $<HTMLSelectElement>('fill').value,
    frame: Number($<HTMLInputElement>('frame').value) || 0,
    lowBits: $<HTMLSelectElement>('lowBits').value as SearchOptions['lowBits'],
    placementFovDeg: Number($<HTMLInputElement>('placementFov').value) || 90,
  };
}

// ---------------------------------------------------------------------------
// The address panel
// ---------------------------------------------------------------------------

/**
 * Shows what the address actually contains, measured rather than claimed.
 *
 * The entropy figure and the compression ratio are computed over these exact
 * bytes every time — an archive that asserts its own randomness is asking to be
 * believed, and this one can simply be checked.
 */
async function renderAddressPanel(): Promise<void> {
  const empty = $('addressEmpty');
  const loaded = $('addressLoaded');
  if (state.held.kind === 'none') {
    empty.hidden = false;
    loaded.hidden = true;
    return;
  }
  empty.hidden = true;
  loaded.hidden = false;

  await flushOffset();
  const scale = archiveScale(state.format);
  if (!reader) {
    reader = new Reader(client, state.format, {
      locate(x, y) {
        stage.focusPixel(x, y);
        stage.toggleLoupe(true);
        requestDraw();
      },
    });
  }
  reader.setFormat(state.format, scale.bytes);

  await flushOffset();
  const report = await client.entropy();
  $('entropyFacts').innerHTML = [
    ['Shannon entropy', `${report.bitsPerByte.toFixed(6)} of 8 bits per byte`],
    ['Compressed with gzip', `${(report.compressionRatio * 100).toFixed(2)}% of original`],
    ['Measured over', `${bytesHuman(report.sampleBytes)} sample`],
    ['Distinct byte values', `${report.histogram.filter((v) => v > 0).length} of 256`],
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');
  drawHistogram($<HTMLCanvasElement>('histogram'), report.histogram);

  $('magnitudeFacts').innerHTML = [
    { label: 'Written out in full', value: `${group(scale.cardinalityDigits)} digits` },
    ...addressAnchors(scale.cardinalityDigits),
    ...archiveAnchors(scale.cardinalityExponent),
  ]
    .map((a) => `<div><dt>${a.label}</dt><dd>${a.value}</dd></div>`)
    .join('');
}

// ---------------------------------------------------------------------------
// Plates
// ---------------------------------------------------------------------------

function renderVerdict(verdict: PlateVerdict | null): void {
  const box = $('verdict');
  if (!verdict) {
    box.hidden = true;
    return;
  }
  box.hidden = false;

  if (!verdict.isPlate) {
    $('verdictWord').textContent = 'NO PLATE';
    $('verdictPrinted').textContent = '—';
    $('verdictComputed').textContent = verdict.computed;
    $('verdictNote').textContent = verdict.note;
    return;
  }

  $('verdictWord').textContent = verdict.valid ? 'TRUE' : 'FALSE';
  // Brighten only the digits that disagree, so the divergence is legible
  // without reaching for a warning colour.
  const printed = verdict.printed ?? '';
  const mark = (text: string) =>
    [...text].map((c, i) => (c === printed[i] ? c : `<i>${c}</i>`)).join('');
  $('verdictPrinted').innerHTML = mark(printed);
  $('verdictComputed').innerHTML = mark(verdict.computed);
  $('verdictNote').textContent = verdict.note;
}

function renderPlateFacts(report: PlateReport | null): void {
  if (!report) {
    $('plateFacts').innerHTML = '';
    return;
  }
  const s = archiveScale(state.format);
  const stampedBits = report.stampedPixels * state.format.depth.bpc * 3;
  // Odds that an address drawn at random is a valid plate of this layout:
  // every stamped pixel has to land exactly, and the tail has to solve.
  const rarityExponent = Math.round((stampedBits + Math.log2(1e15)) * Math.LOG10E * Math.LN2);
  $('plateFacts').innerHTML = [
    ['Layout', `Plate ${report.layout}`],
    ['Statement', report.statement],
    ['Constrained pixels', group(report.stampedPixels)],
    ['Free pixels', group(s.pixels - report.stampedPixels)],
    ['Tail solutions', group(report.solutions)],
    ['Plates among addresses', `one in 10${superscript(rarityExponent)}`],
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');
}

async function mintPlate(): Promise<void> {
  if (!plateSupported(state.format)) {
    $('plateStatus').textContent =
      'Plates are minted at 4K UHD and 48-bit. Switch the grid and depth on the bench.';
    return;
  }
  const ground = seedFromHex($<HTMLInputElement>('plateGround').value.trim());
  if (!ground) {
    $('plateStatus').textContent = 'The ground needs a 32-character coordinate.';
    return;
  }
  const statement = normaliseStatement($<HTMLInputElement>('plateStatement').value);

  busy(true, 'Composing plate', 0);
  try {
    const report = await client.plate(
      state.format,
      ground,
      statement,
      $<HTMLSelectElement>('plateLayout').value,
      onProgress,
    );
    state.held = { kind: 'foreign', label: `plate ${report.statement}`, origin: Uint32Array.from(state.seed) as Seed };
    await adoptWorkerAddress();
    await renderAddressReadout();
    updateLaneUI();
    renderPlateFacts(report);
    renderVerdict(await client.verify(state.format));
    $('plateStatus').textContent =
      'Minted. Export it as a PNG and it stays true; screenshot it and it does not.';
    toast('Plate constructed');
  } catch (error) {
    $('plateStatus').textContent =
      error instanceof Error ? error.message : 'The plate could not be constructed.';
  } finally {
    busy(false);
  }
}

/**
 * Reads a PNG back at full depth and checks it for a plate.
 *
 * Deliberately not `createImageBitmap`: that returns 8 bits per channel, which
 * would change the address before it could be checked and make every plate
 * read as false.
 */
async function inspectPng(file: File): Promise<void> {
  busy(true, 'Reading PNG', 0.2);
  try {
    const decoded = await decodePng(await file.arrayBuffer());
    if (!decoded) throw new Error('That PNG is not one this archive can read exactly.');

    // A 2:1 grid that matches a sphere is read as one: that is what the ratio
    // means in this archive, and reading it flat would show the right number
    // wrapped around the wrong picture.
    const resolution =
      RESOLUTIONS.find(
        (r) => r.width === decoded.width && r.height === decoded.height && r.geometry === 'sphere',
      ) ?? RESOLUTIONS.find((r) => r.width === decoded.width && r.height === decoded.height);
    const depth = DEPTHS.find((d) => d.bpc === decoded.bpc);
    if (!resolution || !depth) {
      // Not a file this archive minted, so it is not a plate — it is just an
      // image somebody wants to find. Hand it to search rather than refusing it.
      busy(false);
      stageForSearch(file);
      $('searchStatus').textContent =
        `${decoded.width} × ${decoded.height} — not an archive grid, so it will be resampled to locate it.`;
      return;
    }

    state.format = { resolution, depth };
    $<HTMLSelectElement>('geometry').value = resolution.geometry;
    renderResolutionOptions();
    $<HTMLSelectElement>('resolution').value = resolution.id;
    $<HTMLSelectElement>('depth').value = depth.id;
    stage.setFormat(state.format);
    renderScale();
    updateSearchControls();

    const bytes = decoded.pixels.slice();
    await client.adopt(state.format, bytes.buffer);
    state.held = { kind: 'foreign', label: file.name, origin: Uint32Array.from(state.seed) as Seed };
    await adoptWorkerAddress();
    await renderAddressReadout();
    updateLaneUI();
    renderVerdict(await client.verify(state.format));
    $('searchStatus').textContent = `Read ${file.name} at ${decoded.bpc} bits per channel.`;
  } catch (error) {
    renderVerdict(null);
    $('searchStatus').textContent =
      error instanceof Error ? error.message : 'That PNG could not be read.';
  } finally {
    busy(false);
  }
}

/**
 * All the formats a text import may land on: everything this GPU can resolve.
 * Passed to the worker so inference happens where the parsing does.
 */
function resolvableFormats(): ArchiveFormat[] {
  const out: ArchiveFormat[] = [];
  const maxDim = renderer?.capabilities.maxTextureDimension ?? LIMITS.defaultMaxTextureDimension;
  for (const resolution of RESOLUTIONS) {
    for (const depth of DEPTHS) {
      const f = { resolution, depth };
      if (formatCapacity(f, maxDim).materialisable) out.push(f);
    }
  }
  return out;
}

/** Applies a format a file brought with it, syncing every control and the URL. */
function adoptImportedFormat(format: ArchiveFormat): void {
  state.format = format;
  $<HTMLSelectElement>('geometry').value = format.resolution.geometry;
  renderResolutionOptions();
  $<HTMLSelectElement>('resolution').value = format.resolution.id;
  $<HTMLSelectElement>('depth').value = format.depth.id;
  stage.setFormat(format);
  renderScale();
  updateSearchControls();
  // Custom grids ride the r= parameter (c900x1600), so a bespoke archive is as
  // linkable as a listed one.
  syncUrl();
}

/**
 * Reads an exported .txt back into the archive — the other half of the round
 * trip. Hexadecimal is a byte string, so its length names its grid exactly.
 * Decimal is a pure number whose leading zeros are gone, so the worker infers
 * the smallest resolvable grid the value fits.
 */
async function importAddressText(file: File): Promise<void> {
  busy(true, 'Reading the file', 0.05);
  try {
    const text = (await file.text()).replace(/[\s,._']/g, '');

    if (/^[0-9a-fA-F]+$/.test(text) && !/^\d+$/.test(text)) {
      // Unambiguously hexadecimal (contains a-f): bytes, directly.
      if (text.length % 2) throw new Error('That hex file has an odd number of digits.');
      const byteCount = text.length / 2;
      // The bench's own format first: a custom archive's hex has no listed
      // grid to infer, but the bench still set to it names it exactly.
      const candidates = [state.format, ...resolvableFormats()];
      const format = candidates.find(
        (f) => f.resolution.width * f.resolution.height * f.depth.bytesPerPixel === byteCount,
      );
      if (!format) {
        throw new Error(
          `${byteCount.toLocaleString('en-US')} bytes of hex matches no grid this archive can resolve.`,
        );
      }
      const bytes = new Uint8Array(byteCount);
      for (let i = 0; i < byteCount; i++) bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);

      adoptImportedFormat(format);
      await client.adopt(format, bytes.buffer);
      state.held = { kind: 'foreign', label: file.name, origin: Uint32Array.from(state.seed) as Seed };
      await adoptWorkerAddress();
      await renderAddressReadout();
      updateLaneUI();
      renderVerdict(await client.verify(state.format));
      $('searchStatus').textContent =
        `Read ${file.name} as ${format.resolution.label} at ${format.depth.label}.`;
      toast('Address restored from hexadecimal');
      return;
    }

    if (/^\d+$/.test(text)) {
      const ok = window.confirm(
        `Read ${text.length.toLocaleString('en-US')} decimal digits back into an image?\n\n` +
          `Parsing a number this size takes roughly as long as writing it did. ` +
          `The tab stays responsive; the work happens off to one side.`,
      );
      if (!ok) return;
      const format = await client.importDecimal(text, resolvableFormats(), onProgress);

      adoptImportedFormat(format);
      state.held = { kind: 'foreign', label: file.name, origin: Uint32Array.from(state.seed) as Seed };
      await adoptWorkerAddress();
      await renderAddressReadout();
      updateLaneUI();
      renderVerdict(await client.verify(state.format));
      $('searchStatus').textContent =
        `Read ${file.name} as ${format.resolution.label} at ${format.depth.label} — the smallest grid the number fits. ` +
        `Decimal drops leading zeros, so an image that was mostly black may belong on a larger grid.`;
      toast('Address restored from decimal');
      return;
    }

    throw new Error('That file is neither hexadecimal nor decimal digits.');
  } catch (error) {
    $('searchStatus').textContent =
      error instanceof Error ? error.message : 'That file could not be read as an address.';
  } finally {
    busy(false);
  }
}

/** Reopens an address exported from here, completing the round trip. */
async function openAddressFile(file: File): Promise<void> {
  busy(true, 'Reading address', 0.2);
  try {
    const unpacked = unpackAddressFile(await file.arrayBuffer());
    if (!unpacked) throw new Error('That file is not a Universal Image Archive address.');

    // A listed grid if one matches; otherwise the file carries its own — the
    // same custom-archive idea, arriving by container instead of by picture.
    const resolution =
      RESOLUTIONS.find(
        (r) =>
          r.width === unpacked.width &&
          r.height === unpacked.height &&
          r.geometry === unpacked.geometry,
      ) ?? (unpacked.geometry === 'plane' ? customResolution(unpacked.width, unpacked.height) : null);
    const depth = DEPTHS.find((d) => d.bpc === unpacked.bpc);
    if (!resolution || !depth) {
      throw new Error(
        `That address is a ${unpacked.geometry} of ${unpacked.width} × ${unpacked.height} at ${unpacked.bpc} bits, which this archive cannot carry.`,
      );
    }
    const maxDim = renderer?.capabilities.maxTextureDimension ?? LIMITS.defaultMaxTextureDimension;
    const fit = formatCapacity({ resolution, depth }, maxDim);
    if (!fit.materialisable) throw new Error(fit.reason);

    adoptImportedFormat({ resolution, depth });

    // The unpacked view is a window onto the file's buffer; copy it so the
    // transfer to the worker hands over a buffer of exactly the right length.
    const bytes = unpacked.bytes.slice();
    await client.adopt(state.format, bytes.buffer);
    state.held = { kind: 'foreign', label: file.name, origin: Uint32Array.from(state.seed) as Seed };
    await adoptWorkerAddress();
    await renderAddressReadout();
    updateLaneUI();
    $('searchStatus').textContent = `Opened ${file.name}.`;
    toast('Address opened');
  } catch (error) {
    $('searchStatus').textContent =
      error instanceof Error ? error.message : 'That address could not be read.';
  } finally {
    busy(false);
  }
}

async function locate(): Promise<void> {
  if (!pendingFile) return;

  // The placement decision, made before any pixels move.
  if (!$('placementChoiceField').hidden && pendingDims) {
    const choice = $<HTMLSelectElement>('placementChoice').value as Placement;
    if (choice === 'own') {
      adoptImportedFormat({
        resolution: customResolution(pendingDims.width, pendingDims.height),
        depth: state.format.depth,
      });
    } else if (choice === 'embed') {
      const embed = smallestEmbedding(pendingDims.width, pendingDims.height);
      if (embed) {
        adoptImportedFormat({ resolution: embed, depth: state.format.depth });
        $<HTMLSelectElement>('fit').value = 'contain';
      }
    }
    // 'resample' is the existing behaviour: the bench grid stands.
  }

  busy(true, 'Reading image', 0.05);
  try {
    const bitmap = await createImageBitmap(pendingFile);
    await client.search(state.format, bitmap, searchOptions(), state.seed, onProgress);
    state.held = { kind: 'foreign', label: pendingFile.name, origin: Uint32Array.from(state.seed) as Seed };
    await adoptWorkerAddress();
    await renderAddressReadout();
    updateLaneUI();
    $('searchStatus').textContent =
      'Located. This address has always held this image; the archive has simply never been asked for it before.';
    toast('Located in the archive');
  } catch (error) {
    $('searchStatus').textContent =
      error instanceof Error ? error.message : 'That file could not be read as an image.';
  } finally {
    busy(false);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function exportPng(): Promise<void> {
  if (!workerMatchesStage()) await resolveAddress();
  if (!workerMatchesStage()) return;
  await flushOffset();
  busy(true, 'Encoding PNG', 0);
  try {
    const { blob, filename } = await client.png(onProgress);
    download(blob, filename);
    toast(`PNG written · ${bytesHuman(blob.size)}`);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Export failed');
  } finally {
    busy(false);
  }
}

async function exportAddress(): Promise<void> {
  if (!workerMatchesStage()) await resolveAddress();
  if (!workerMatchesStage()) return;
  await flushOffset();
  const { blob, filename } = await client.addressFile();
  download(blob, filename);
  toast(`Address written · ${bytesHuman(blob.size)}`);
}

/** The address as readable hexadecimal — exact, and instant, because hex is the bytes. */
async function exportHex(): Promise<void> {
  if (!workerMatchesStage()) await resolveAddress();
  if (!workerMatchesStage()) return;
  await flushOffset();
  busy(true, 'Writing hexadecimal', 0);
  try {
    const { blob, filename } = await client.hexFile(onProgress);
    download(blob, filename);
    toast(`Hexadecimal written · ${bytesHuman(blob.size)}`);
  } finally {
    busy(false);
  }
}

/**
 * The address in base ten — the actual number, all of it.
 *
 * Slow by nature rather than by implementation: the digit in any position
 * depends on every byte, so there is no way to produce the first one without
 * doing all the work. The estimate is shown first because a minute of silence
 * reads as a hang.
 */
async function exportDecimal(): Promise<void> {
  if (!workerMatchesStage()) await resolveAddress();
  if (!workerMatchesStage()) return;
  await flushOffset();

  const scale = archiveScale(state.format);
  if (scale.bytes > BIGINT_MAX_BYTES) {
    toast(
      `Base-ten conversion stops at ${(BIGINT_MAX_BYTES / 1048576).toFixed(0)} MiB of address — hexadecimal carries the full number exactly.`,
    );
    return;
  }
  const estimate = describeDecimalCost(scale.bytes);
  const ok = window.confirm(
    `Work out all ${group(scale.cardinalityDigits)} decimal digits?\n\n` +
      `This takes about ${estimate} and produces a text file of roughly ` +
      `${bytesHuman(scale.cardinalityDigits)}. The tab stays responsive; the work happens ` +
      `off to one side.`,
  );
  if (!ok) return;

  busy(true, `Converting to base ten — about ${estimate}`, 0.1);
  try {
    const { blob, filename } = await client.decimalFile(onProgress);
    download(blob, filename);
    toast(`Decimal written · ${bytesHuman(blob.size)}`);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'The conversion did not finish');
  } finally {
    busy(false);
  }
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

const TITLES: Record<string, string> = {
  search: 'Search',
  address: 'The address',
  plate: 'Plate',
  keys: 'Keys',
  about: 'About the archive',
};

function openDrawer(panel: string | null): void {
  const drawer = $('drawer');
  if (!panel) {
    drawer.dataset.open = 'false';
    document.body.dataset.drawerOpen = 'false';
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-expanded', 'false'));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 240);
    return;
  }
  drawer.dataset.open = 'true';
  document.body.dataset.drawerOpen = 'true';
  $('drawerTitle').textContent = TITLES[panel] ?? panel;
  drawer.querySelectorAll<HTMLElement>('.drawer__body').forEach((body) => {
    body.hidden = body.dataset.panel !== panel;
  });
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
    t.setAttribute('aria-expanded', String(t.dataset.drawer === panel));
  });
  setTimeout(() => window.dispatchEvent(new Event('resize')), 240);
}

// ---------------------------------------------------------------------------
// Traverse
// ---------------------------------------------------------------------------

let traverseTimer = 0;
let traverseSteps = 0;

/**
 * Traverse walks the coordinate lane, and only ever the coordinate lane.
 *
 * Walking the address instead would be conceptually pure and visually inert —
 * address+1 flips one bit, so every frame would look identical — and each tick
 * would re-upload the whole texture. So this is a coordinate walk, it says so,
 * and it counts its steps: halting reports how far it went, which is exactly
 * how far the back arrow must go to return.
 */
function setPlaying(on: boolean): void {
  state.playing = on;
  $('play').setAttribute('aria-pressed', String(on));
  $('play').textContent = on ? 'Halt' : 'Traverse';
  window.clearInterval(traverseTimer);

  if (on) {
    traverseSteps = 0;
    traverseTimer = window.setInterval(() => {
      traverseSteps += 1;
      setSeed(seedAdd(state.seed, 1), { pushUrl: false });
    }, 500);
  } else {
    syncUrl();
    if (traverseSteps > 0) {
      toast(
        `Traversed ${traverseSteps.toLocaleString('en-US')} coordinates — set the step to that and press ← to return.`,
      );
      traverseSteps = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  readUrl();

  const canvas = $<HTMLCanvasElement>('canvas');
  try {
    renderer = await createRenderer(canvas);
  } catch (error) {
    $('pipelineText').textContent = 'no GPU';
    toast(error instanceof Error ? error.message : 'No GPU available');
    return;
  }

  const caps = renderer.capabilities;
  $('pipelineText').textContent = [
    caps.backend,
    caps.canvasFormat,
    caps.colorSpace,
    caps.hdr ? 'HDR' : `${caps.outputBits}-bit out`,
  ].join(' · ');
  $('pipeline').querySelector('.pipeline__dot')!.setAttribute(
    'data-state',
    caps.outputBits === 16 ? 'ready' : 'degraded',
  );

  stage = new Stage($('stage'), canvas, renderer, state.format, {
    sample: (x, y) => {
      if (state.mode === 'seed') {
        return sampleAt(
          state.format,
          state.seed,
          state.offset,
          y * state.format.resolution.width + x,
          patch,
          state.rounds,
        );
      }
      const index = y * state.format.resolution.width + x;
      if (patch && index >= patch.firstPixel) {
        const d = (index - patch.firstPixel) * 4;
        return { r: patch.values[d], g: patch.values[d + 1], b: patch.values[d + 2] };
      }
      if (!addressTexels) return null;
      const i = index * 4;
      return { r: addressTexels[i], g: addressTexels[i + 1], b: addressTexels[i + 2] };
    },
    onViewChange: requestDraw,
    onEntropyMotion: (dx, dy, dt) => {
      if (!state.entropyMode) return;
      const delta = Math.round(dx * 13 + dy * 17 + dt * 7);
      if (delta !== 0) setSeed(seedAdd(state.seed, delta), { pushUrl: false });
    },
  });

  // Format controls
  const geoSelect = $<HTMLSelectElement>('geometry');
  geoSelect.innerHTML = GEOMETRIES.map(
    (g) => `<option value="${g.id}">${g.label} — ${g.note}</option>`,
  ).join('');
  geoSelect.value = geometryOf();
  geoSelect.addEventListener('change', () => {
    if (!confirmFormatChange()) {
      geoSelect.value = geometryOf();
      return;
    }
    setGeometry(geoSelect.value as Geometry);
  });

  const resSelect = $<HTMLSelectElement>('resolution');
  renderResolutionOptions();
  resSelect.addEventListener('change', () => {
    if (!confirmFormatChange()) {
      resSelect.value = state.format.resolution.id;
      return;
    }
    state.format = { ...state.format, resolution: resolutionById(resSelect.value, geometryOf()) };
    applyFormat();
  });

  const depthSelect = $<HTMLSelectElement>('depth');
  depthSelect.innerHTML = DEPTHS.map(
    (d) => `<option value="${d.id}">${d.label} — ${d.note}</option>`,
  ).join('');
  depthSelect.value = state.format.depth.id;
  depthSelect.addEventListener('change', () => {
    if (!confirmFormatChange()) {
      depthSelect.value = state.format.depth.id;
      return;
    }
    state.format = { ...state.format, depth: depthById(depthSelect.value) };
    applyFormat();
  });

  // Coordinate entry
  const seedInput = $<HTMLInputElement>('seedInput');
  seedInput.addEventListener('input', () => {
    let text = seedInput.value.trim();
    if (!text) return;
    // If a full URL is pasted (e.g. http://localhost:5274/#c=41854b...), extract the 'c' coordinate parameter.
    if (text.includes('#c=') || text.includes('?c=')) {
      const match = text.match(/[#?]c=([0-9a-fA-F]{32})/);
      if (match && match[1]) text = match[1];
    }
    setSeed(seedFromHex(text) ?? seedFromPhrase(text));
  });
  seedInput.addEventListener('blur', renderSeed);

  $('parkedChip').addEventListener('click', () => void returnToHeld());

  $('copySeed').addEventListener('click', async () => {
    if (state.mode === 'address') {
      toast('Photos have no 128-bit seed — export as Binary (.uia) or Hex to save its address.');
      return;
    }
    await navigator.clipboard.writeText(seedToHex(state.seed));
    toast('Coordinate copied');
  });

  function stepCoordinate(delta: number): void {
    setSeed(seedAdd(state.seed, delta));
  }

  function stepHead(delta: number): void {
    if (state.mode === 'seed') {
      state.headOffset += delta;
      renderSeedLocation();
      toast(`Head (first digit) stepped by ${delta > 0 ? '+' : ''}${delta.toLocaleString('en-US')}`);
    } else if (base) {
      base.headOffset = (base.headOffset ?? 0) + delta;
      const headSeed = seedFromHex(hex(base.head)) ?? (new Uint32Array(4) as Seed);
      const updated = seedAdd(headSeed, delta);
      base.head = new Uint8Array(updated.buffer, updated.byteOffset, updated.byteLength);
      renderAddressLocation();
      requestDraw();
      toast(`Head (first digit) stepped by ${delta > 0 ? '+' : ''}${delta.toLocaleString('en-US')}`);
    }
  }

  // Transport
  $('randomSeed').addEventListener('click', () => setSeed(randomSeed()));
  $('nextSeed').addEventListener('click', () => stepCoordinate(stepSize()));
  $('prevSeed').addEventListener('click', () => stepCoordinate(-stepSize()));
  $('stepSize').addEventListener('change', updateLaneUI);
  $('stepSize').addEventListener('input', updateLaneUI);
  $('play').addEventListener('click', () => setPlaying(!state.playing));
  $('stepHeadUp').addEventListener('click', () => stepHead(stepSize()));
  $('stepHeadDown').addEventListener('click', () => stepHead(-stepSize()));
  $('stepUp').addEventListener('click', () => walk(stepSize()));
  $('stepDown').addEventListener('click', () => walk(-stepSize()));

  const roundsSelect = $<HTMLSelectElement>('philoxRounds');
  if (roundsSelect) {
    roundsSelect.value = String(state.rounds);
    roundsSelect.addEventListener('change', () => {
      state.rounds = Number(roundsSelect.value);
      requestDraw();
      syncUrl();
      toast(`Philox Cipher configured to ${state.rounds} rounds`);
    });
  }

  const entropyBtn = $<HTMLButtonElement>('toggleEntropy');
  if (entropyBtn) {
    entropyBtn.addEventListener('click', () => {
      state.entropyMode = !state.entropyMode;
      entropyBtn.setAttribute('aria-pressed', String(state.entropyMode));
      entropyBtn.textContent = state.entropyMode ? 'Entropy: Active' : 'Entropy: Off';
      toast(
        state.entropyMode
          ? 'Entropy Sculpting: Active — move cursor across stage to sculpt coordinates live'
          : 'Entropy Sculpting: Paused',
      );
    });
  }

  // Exports
  $('exportPng').addEventListener('click', () => void exportPng());
  $('exportAddress').addEventListener('click', () => void exportAddress());
  document.getElementById('exportHexBench')?.addEventListener('click', () => void exportHex());
  document.getElementById('exportDecimalBench')?.addEventListener('click', () => void exportDecimal());
  $('addressResolve').addEventListener('click', async () => {
    await resolveAddress();
    await renderAddressPanel();
  });

  document.getElementById('openAddressInspector')?.addEventListener('click', () => {
    openDrawer('address');
    void renderAddressPanel();
  });

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const chip = target?.closest('.hex-chip') as HTMLElement | null;
    if (chip && chip.dataset.copy) {
      const val = chip.dataset.copy;
      void navigator.clipboard.writeText(val).then(() => {
        toast(`Copied ${val.length > 16 ? val.slice(0, 8) + '…' : val}`);
      });
    }
  });

  // Drawer
  document.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const panel = tab.dataset.drawer!;
      const isOpen = tab.getAttribute('aria-expanded') === 'true';
      openDrawer(isOpen ? null : panel);
      if (!isOpen && panel === 'address') void renderAddressPanel();
    });
  });
  $('drawerClose').addEventListener('click', () => openDrawer(null));

  // Search
  const dropzone = $('dropzone');
  const fileInput = $<HTMLInputElement>('fileInput');

  const acceptFile = (file: File | null | undefined) => {
    if (!file) return;
    // An exported address is an image too — just one already in archive form.
    if (file.name.endsWith('.uia')) {
      void openAddressFile(file);
      return;
    }
    // An exported address as text — hex or decimal — is the picture, and
    // dropping it back must return the picture.
    if (file.name.toLowerCase().endsWith('.txt') || file.type === 'text/plain') {
      void importAddressText(file);
      return;
    }
    // A PNG might be a plate, and resampling it would destroy the claim before
    // it could be checked. Read it exactly first.
    if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
      void inspectPng(file);
      return;
    }
    if (!file.type.startsWith('image/')) {
      $('searchStatus').textContent = 'That file is neither an image nor an exported address.';
      return;
    }
    stageForSearch(file);
  };

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => acceptFile(fileInput.files?.[0]));
  for (const type of ['dragenter', 'dragover'] as const) {
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      dropzone.dataset.over = 'true';
    });
  }
  for (const type of ['dragleave', 'drop'] as const) {
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      dropzone.dataset.over = 'false';
    });
  }
  dropzone.addEventListener('drop', (e) => acceptFile((e as DragEvent).dataTransfer?.files?.[0]));
  $('locate').addEventListener('click', () => void locate());

  // Plate
  const layoutSelect = $<HTMLSelectElement>('plateLayout');
  layoutSelect.innerHTML = PLATE_LAYOUTS.map(
    (l) => `<option value="${l.id}">${l.label}</option>`,
  ).join('');
  $<HTMLInputElement>('plateGround').value = seedToHex(state.seed);
  $<HTMLInputElement>('plateStatement').value = new Date()
    .toISOString()
    .replace(/\D/g, '')
    .slice(0, 15)
    .padEnd(15, '0');
  $('plateUseCurrent').addEventListener('click', () => {
    $<HTMLInputElement>('plateGround').value = seedToHex(state.seed);
  });
  $('mintPlate').addEventListener('click', () => void mintPlate());

  // Keyboard
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target.matches('input, select, textarea')) {
      if (e.key === 'Escape') target.blur();
      return;
    }
    // A button keeps focus after it is clicked, and Space activates a focused
    // button. Without this, pressing Space after clicking Random would fire
    // Random again and toggle Traverse at the same time.
    if (target.matches('button') && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key.toLowerCase()) {
      case 'r': setSeed(randomSeed()); break;
      case 'arrowright': stepCoordinate(stepSize()); break;
      case 'arrowleft': stepCoordinate(-stepSize()); break;
      case ']': walk(stepSize()); break;
      case '[': walk(-stepSize()); break;
      case ' ': e.preventDefault(); setPlaying(!state.playing); break;
      case 'f': stage.fit(); break;
      case '1': stage.actualSize(); break;
      case 'i': stage.toggleLoupe(); break;
      case 'g': setGeometry(geometryOf() === 'sphere' ? 'plane' : 'sphere'); break;
      case 's': openDrawer('search'); break;
      case 'p': openDrawer('plate'); break;
      case 'a': openDrawer('address'); void renderAddressPanel(); break;
      case 'e': void exportPng(); break;
      case 'escape': openDrawer(null); break;
      default: return;
    }
  });

  // First light
  stage.setFormat(state.format);
  stage.toggleLoupe(true);
  renderScale();
  renderSeed();
  renderSeedLocation();
  updateLaneUI();
  updateLowBitsHint();
  updateSearchControls();
  syncUrl();
  requestDraw();
  canvas.dataset.live = 'true';

  await runSelfChecks();
}

/**
 * Two checks, run once at startup.
 *
 * The first proves the CPU generator is the standard philox4x32-10. The second
 * reads pixels back off the GPU and compares them to what the CPU says those
 * pixels are. If either fails, the picture on the stage and the number printed
 * beneath it are different images — the one failure this project cannot absorb,
 * and one that is invisible without asking, because wrong noise looks exactly
 * like right noise.
 */
async function runSelfChecks(): Promise<void> {
  const vectors = selfTest();
  if (!vectors.ok) {
    console.error(`archive: generator self-check failed — ${vectors.detail}`);
    toast('Address generator failed its self-check');
    return;
  }
  console.info(`archive: ${vectors.detail}`);

  try {
    const gpu = await renderer.probe({ format: state.format, mode: 'seed', seed: state.seed, rounds: state.rounds });
    const shift = state.format.depth.bpc - 8;
    let mismatches = 0;
    for (let y = 0; y < PROBE; y++) {
      for (let x = 0; x < PROBE; x++) {
        const cpu = sampleSeed(state.format, state.seed, y * state.format.resolution.width + x, state.rounds);
        const i = (y * PROBE + x) * 3;
        // The probe target is 8-bit, so compare the top 8 bits of each channel.
        // Philox is chaotic: any divergence changes every bit, not just the low ones.
        if (
          Math.abs((cpu.r >> shift) - gpu[i]) > 1 ||
          Math.abs((cpu.g >> shift) - gpu[i + 1]) > 1 ||
          Math.abs((cpu.b >> shift) - gpu[i + 2]) > 1
        ) {
          mismatches++;
        }
      }
    }
    if (mismatches === 0) {
      console.info(`archive: GPU matches CPU across ${PROBE * PROBE} probed pixels`);
    } else {
      console.error(`archive: GPU/CPU divergence on ${mismatches} of ${PROBE * PROBE} pixels`);
      toast('Renderer disagrees with the address generator');
    }
  } catch (error) {
    console.warn('archive: GPU probe unavailable', error);
  }

  // The sphere projection is a third port of the same maths, and over a field of
  // noise a wrong projection looks exactly like a right one. Without this the
  // loupe's byte offsets would be claims nobody had checked.
  if (geometryOf() === 'sphere') {
    try {
      const { width, height } = state.format.resolution;
      // Narrow enough that the shader's footprint collapses to a single tap,
      // so this compares projections rather than filter kernels.
      const look = { yaw: 0, pitch: 0, fov: 0.008 };
      const gpu = await renderer.probe(
        { format: state.format, mode: 'seed', seed: state.seed, rounds: state.rounds },
        { look },
      );
      const shift = state.format.depth.bpc - 8;
      let mismatches = 0;
      for (let y = 0; y < PROBE; y++) {
        for (let x = 0; x < PROBE; x++) {
          const t = screenToTexel(x, y, PROBE, PROBE, width, height, look);
          const cpu = sampleSeed(state.format, state.seed, t.y * width + t.x, state.rounds);
          const i = (y * PROBE + x) * 3;
          if (
            Math.abs((cpu.r >> shift) - gpu[i]) > 1 ||
            Math.abs((cpu.g >> shift) - gpu[i + 1]) > 1 ||
            Math.abs((cpu.b >> shift) - gpu[i + 2]) > 1
          ) {
            mismatches++;
          }
        }
      }
      if (mismatches === 0) {
        console.info(`archive: sphere projection matches the CPU across ${PROBE * PROBE} rays`);
      } else {
        console.error(`archive: sphere projection diverges on ${mismatches} of ${PROBE * PROBE} rays`);
        toast('Sphere projection disagrees with the reference');
      }
    } catch (error) {
      console.warn('archive: sphere probe unavailable', error);
    }
  }

  // The offset is painted by the shader from a patch the CPU computed, so the
  // two must agree on the tail pixels — otherwise the picture on screen would
  // be at a different address than the number beneath it claims.
  try {
    const { width, height } = state.format.resolution;
    const probeSeed = state.seed;
    const testPatch = tailPatch(state.format, probeSeed, 1, state.rounds);
    const at = { x: Math.max(0, width - PROBE), y: height - 1 };
    const gpu = await renderer.probe(
      { format: state.format, mode: 'seed', seed: probeSeed, rounds: state.rounds, patch: testPatch },
      { at, withPatch: true },
    );
    const shift = state.format.depth.bpc - 8;
    let mismatches = 0;
    for (let x = 0; x < PROBE; x++) {
      const px = at.x + x;
      if (px >= width) continue;
      const cpu = sampleAt(state.format, probeSeed, 1, at.y * width + px, testPatch, state.rounds);
      // Row 0 of the readback is image row `at.y`.
      const i = x * 3;
      if (
        Math.abs((cpu.r >> shift) - gpu[i]) > 1 ||
        Math.abs((cpu.g >> shift) - gpu[i + 1]) > 1 ||
        Math.abs((cpu.b >> shift) - gpu[i + 2]) > 1
      ) {
        mismatches++;
      }
    }
    if (mismatches === 0) console.info('archive: offset patch paints exactly what the CPU computes');
    else {
      console.error(`archive: offset patch diverges on ${mismatches} tail pixels`);
      toast('Offset rendering disagrees with the reference');
    }
  } catch (error) {
    console.warn('archive: offset probe unavailable', error);
  }

  // A plate minted here has to verify everywhere, so prove the composition and
  // the readback agree before anyone is handed an object that claims they do.
  // In the worker: it composes a full 4K plate, which is seconds of work that
  // used to freeze the first paint.
  if (plateSupported(state.format)) {
    client
      .plateSelfCheck(state.format, state.seed)
      .then(() => console.info('archive: plate composes and reads back exactly'))
      .catch((error: unknown) => {
        console.error('archive: plate self-check failed', error);
        toast('Plate construction failed its self-check');
      });
  }
}

if (import.meta.env.DEV) {
  // A handle for benchmarking from the console. Dev-only: nothing in the
  // shipped bundle depends on it.
  (window as unknown as Record<string, unknown>).__archive = {
    get state() {
      return state;
    },
    get renderer() {
      return renderer;
    },
    get stage() {
      return stage;
    },
    client,
    setSeed,
    applyFormat,
    resolveAddress,
    adoptWorkerAddress,
    requestDraw,
  };
}

void boot();
