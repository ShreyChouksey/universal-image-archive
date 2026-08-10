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
import { Stage } from './ui/stage';
import { Reader, drawHistogram } from './ui/reader';
import { addressAnchors, archiveAnchors, describeDecimalCost } from './core/magnitude';
import { bytesHuman, group, scaleWord, superscript } from './ui/numbers';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface State {
  format: ArchiveFormat;
  seed: Seed;
  /** 'seed' renders from the coordinate; 'address' renders an uploaded texture. */
  mode: 'seed' | 'address';
  /** True once the current image's address exists in the worker. */
  resolved: boolean;
  playing: boolean;
}

const state: State = {
  format: DEFAULT_FORMAT,
  seed: randomSeed(),
  mode: 'seed',
  resolved: false,
  playing: false,
};

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
    renderer.draw({ format: state.format, mode: state.mode, seed: state.seed }, stage.view);
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
  sel.innerHTML = resolutionsFor(geometryOf())
    .map((r) => `<option value="${r.id}">${r.label} — ${r.note}</option>`)
    .join('');
  sel.value = state.format.resolution.id;
}

function setGeometry(geometry: Geometry): void {
  if (geometry === geometryOf()) return;
  state.format = { ...state.format, resolution: defaultResolutionFor(geometry) };
  $<HTMLSelectElement>('geometry').value = geometry;
  renderResolutionOptions();
  applyFormat();
}

function renderSeed(): void {
  const input = $<HTMLInputElement>('seedInput');
  if (document.activeElement !== input) input.value = seedToHex(state.seed);
  input.dataset.invalid = 'false';
}

function renderAddressPlaceholder(): void {
  const cap = capacity();
  $('addressReadout').innerHTML = cap.materialisable
    ? '<span class="dim">not materialised —</span> <button class="ghost" type="button" id="materialise">resolve</button>'
    : `<span class="dim">too large to resolve on this GPU</span>`;
  if (cap.materialisable) {
    $('materialise').addEventListener('click', () => void resolveAddress());
  }
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
  if (!$('addressLoaded').hidden || $('drawerTitle').textContent === TITLES.address) {
    void renderAddressPanel();
  }
  $('addressReadout').innerHTML = `<b>${r.head}</b> … <b>${r.tail}</b><br /><span class="dim">${group(
    r.digitCount,
  )} digits · ends …${r.trailingDecimal}</span>`;
  $<HTMLButtonElement>('stepUp').disabled = false;
  $<HTMLButtonElement>('stepDown').disabled = false;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function setSeed(seed: Seed, { pushUrl = true } = {}): void {
  state.seed = seed;
  state.mode = 'seed';
  state.resolved = false;
  addressTexels = null;
  renderer.setAddressTexture(1, 1, null);
  renderSeed();
  renderAddressPlaceholder();
  requestDraw();
  if (pushUrl) syncUrl();
}

async function resolveAddress(): Promise<void> {
  const cap = capacity();
  if (!cap.materialisable) {
    // The texture allocation fails silently on the GPU, so refusing here is the
    // difference between an explanation and an unexplained black frame.
    toast(cap.reason);
    return;
  }
  busy(true, 'Materialising address', 0);
  try {
    await client.materialise(state.format, state.seed, onProgress);
    state.resolved = true;
    await renderAddressReadout();
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
async function stepAddress(delta: number): Promise<void> {
  if (!state.resolved) {
    await resolveAddress();
    if (!state.resolved) return;
  }
  busy(true, 'Stepping address', 0.5);
  try {
    await client.step(delta);
    await adoptWorkerAddress();
    await renderAddressReadout();
    toast(delta > 0 ? 'Advanced one address' : 'Retreated one address');
  } finally {
    busy(false);
  }
}

/** Pull the worker's current address onto the GPU and into the loupe's reach. */
async function adoptWorkerAddress(): Promise<void> {
  const tex = await client.texture();
  addressTexels = tex.data;
  renderer.setAddressTexture(tex.width, tex.height, tex.data);
  state.mode = 'address';
  requestDraw();
}

function syncUrl(): void {
  const params = new URLSearchParams();
  params.set('c', seedToHex(state.seed));
  params.set('g', geometryOf());
  params.set('r', state.format.resolution.id);
  params.set('d', state.format.depth.id);
  history.replaceState(null, '', `#${params.toString()}`);
}

function readUrl(): void {
  const params = new URLSearchParams(location.hash.slice(1));
  const c = params.get('c');
  if (c) {
    const seed = seedFromHex(c);
    if (seed) state.seed = seed;
  }
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

function applyFormat(): void {
  reader = null;
  stage.setFormat(state.format);
  renderScale();
  state.resolved = false;
  addressTexels = null;
  renderer.setAddressTexture(1, 1, null);
  state.mode = 'seed';
  renderAddressPlaceholder();
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

/** Holds a file ready for `locate()` and reflects it in the dropzone. */
function stageForSearch(file: File): void {
  pendingFile = file;
  const dropzone = $('dropzone');
  dropzone.dataset.loaded = 'true';
  dropzone.querySelector('.dropzone__title')!.textContent = file.name;
  dropzone.querySelector('.dropzone__hint')!.textContent = bytesHuman(file.size);
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
  if (!state.resolved) {
    empty.hidden = false;
    loaded.hidden = true;
    return;
  }
  empty.hidden = true;
  loaded.hidden = false;

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

  $('exportHint').textContent =
    scale.bytes > BIGINT_MAX_BYTES
      ? `Hexadecimal is exact and immediate at any size. Base ten is out of reach here: the ` +
        `engine's integers stop at ${(BIGINT_MAX_BYTES / 1048576).toFixed(0)} MiB of address and this one is ` +
        `${bytesHuman(scale.bytes)}.`
      : `Hexadecimal is exact and immediate. Decimal is the same number in base ten — ` +
        `${group(scale.cardinalityDigits)} digits, about ${describeDecimalCost(scale.bytes)} to work out, ` +
        `because the digit in any position depends on all ${bytesHuman(scale.bytes)}.`;
  $<HTMLButtonElement>('exportDecimal').disabled = scale.bytes > BIGINT_MAX_BYTES;
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
    await adoptWorkerAddress();
    state.resolved = true;
    await renderAddressReadout();
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
    await adoptWorkerAddress();
    state.resolved = true;
    await renderAddressReadout();
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

/** Reopens an address exported from here, completing the round trip. */
async function openAddressFile(file: File): Promise<void> {
  busy(true, 'Reading address', 0.2);
  try {
    const unpacked = unpackAddressFile(await file.arrayBuffer());
    if (!unpacked) throw new Error('That file is not a Universal Image Archive address.');

    const resolution = RESOLUTIONS.find(
      (r) =>
        r.width === unpacked.width &&
        r.height === unpacked.height &&
        r.geometry === unpacked.geometry,
    );
    const depth = DEPTHS.find((d) => d.bpc === unpacked.bpc);
    if (!resolution || !depth) {
      throw new Error(
        `That address is a ${unpacked.geometry} of ${unpacked.width} × ${unpacked.height} at ${unpacked.bpc} bits, which this archive does not carry.`,
      );
    }

    state.format = { resolution, depth };
    $<HTMLSelectElement>('geometry').value = resolution.geometry;
    renderResolutionOptions();
    $<HTMLSelectElement>('resolution').value = resolution.id;
    $<HTMLSelectElement>('depth').value = depth.id;
    stage.setFormat(state.format);
    renderScale();

    // The unpacked view is a window onto the file's buffer; copy it so the
    // transfer to the worker hands over a buffer of exactly the right length.
    const bytes = unpacked.bytes.slice();
    await client.adopt(state.format, bytes.buffer);
    await adoptWorkerAddress();
    state.resolved = true;
    await renderAddressReadout();
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
  busy(true, 'Reading image', 0.05);
  try {
    const bitmap = await createImageBitmap(pendingFile);
    await client.search(state.format, bitmap, searchOptions(), state.seed, onProgress);
    await adoptWorkerAddress();
    state.resolved = true;
    await renderAddressReadout();
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
  if (!state.resolved) await resolveAddress();
  if (!state.resolved) return;
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
  if (!state.resolved) await resolveAddress();
  if (!state.resolved) return;
  const { blob, filename } = await client.addressFile();
  download(blob, filename);
  toast(`Address written · ${bytesHuman(blob.size)}`);
}

/** The address as readable hexadecimal — exact, and instant, because hex is the bytes. */
async function exportHex(): Promise<void> {
  if (!state.resolved) await resolveAddress();
  if (!state.resolved) return;
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
  if (!state.resolved) await resolveAddress();
  if (!state.resolved) return;

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
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-expanded', 'false'));
    return;
  }
  drawer.dataset.open = 'true';
  $('drawerTitle').textContent = TITLES[panel] ?? panel;
  drawer.querySelectorAll<HTMLElement>('.drawer__body').forEach((body) => {
    body.hidden = body.dataset.panel !== panel;
  });
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
    t.setAttribute('aria-expanded', String(t.dataset.drawer === panel));
  });
}

// ---------------------------------------------------------------------------
// Traverse
// ---------------------------------------------------------------------------

let traverseTimer = 0;

function setPlaying(on: boolean): void {
  state.playing = on;
  $('play').setAttribute('aria-pressed', String(on));
  $('play').textContent = on ? 'Halt' : 'Traverse';
  window.clearInterval(traverseTimer);
  if (on) {
    traverseTimer = window.setInterval(() => setSeed(seedAdd(state.seed, 1), { pushUrl: false }), 500);
  } else {
    syncUrl();
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
        return sampleSeed(state.format, state.seed, y * state.format.resolution.width + x);
      }
      if (!addressTexels) return null;
      const i = (y * state.format.resolution.width + x) * 4;
      return { r: addressTexels[i], g: addressTexels[i + 1], b: addressTexels[i + 2] };
    },
    onViewChange: requestDraw,
  });

  // Format controls
  const geoSelect = $<HTMLSelectElement>('geometry');
  geoSelect.innerHTML = GEOMETRIES.map(
    (g) => `<option value="${g.id}">${g.label} — ${g.note}</option>`,
  ).join('');
  geoSelect.value = geometryOf();
  geoSelect.addEventListener('change', () => setGeometry(geoSelect.value as Geometry));

  const resSelect = $<HTMLSelectElement>('resolution');
  renderResolutionOptions();
  resSelect.addEventListener('change', () => {
    state.format = { ...state.format, resolution: resolutionById(resSelect.value, geometryOf()) };
    applyFormat();
  });

  const depthSelect = $<HTMLSelectElement>('depth');
  depthSelect.innerHTML = DEPTHS.map(
    (d) => `<option value="${d.id}">${d.label} — ${d.note}</option>`,
  ).join('');
  depthSelect.value = state.format.depth.id;
  depthSelect.addEventListener('change', () => {
    state.format = { ...state.format, depth: depthById(depthSelect.value) };
    applyFormat();
  });

  // Coordinate entry
  const seedInput = $<HTMLInputElement>('seedInput');
  seedInput.addEventListener('input', () => {
    // Hexadecimal first, so a coordinate pasted in is read as itself. Anything
    // else is a phrase, hashed to the coordinate it names — which makes typing
    // in this field a way to travel rather than a way to get an error.
    const text = seedInput.value.trim();
    if (!text) return;
    setSeed(seedFromHex(text) ?? seedFromPhrase(text));
  });
  seedInput.addEventListener('blur', renderSeed);

  $('copySeed').addEventListener('click', async () => {
    await navigator.clipboard.writeText(location.href);
    toast('Link copied');
  });

  // Transport
  $('randomSeed').addEventListener('click', () => setSeed(randomSeed()));
  $('nextSeed').addEventListener('click', () => setSeed(seedAdd(state.seed, 1)));
  $('prevSeed').addEventListener('click', () => setSeed(seedAdd(state.seed, -1)));
  $('play').addEventListener('click', () => setPlaying(!state.playing));
  $('stepUp').addEventListener('click', () => void stepAddress(1));
  $('stepDown').addEventListener('click', () => void stepAddress(-1));

  // Exports
  $('exportPng').addEventListener('click', () => void exportPng());
  $('exportAddress').addEventListener('click', () => void exportAddress());
  $('exportAddress2').addEventListener('click', () => void exportAddress());
  $('exportHex').addEventListener('click', () => void exportHex());
  $('exportDecimal').addEventListener('click', () => void exportDecimal());
  $('addressResolve').addEventListener('click', async () => {
    await resolveAddress();
    await renderAddressPanel();
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
      case 'arrowright': setSeed(seedAdd(state.seed, 1)); break;
      case 'arrowleft': setSeed(seedAdd(state.seed, -1)); break;
      case ']': void stepAddress(1); break;
      case '[': void stepAddress(-1); break;
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
  renderAddressPlaceholder();
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
    const gpu = await renderer.probe({ format: state.format, mode: 'seed', seed: state.seed });
    const shift = state.format.depth.bpc - 8;
    let mismatches = 0;
    for (let y = 0; y < PROBE; y++) {
      for (let x = 0; x < PROBE; x++) {
        const cpu = sampleSeed(state.format, state.seed, y * state.format.resolution.width + x);
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
        { format: state.format, mode: 'seed', seed: state.seed },
        look,
      );
      const shift = state.format.depth.bpc - 8;
      let mismatches = 0;
      for (let y = 0; y < PROBE; y++) {
        for (let x = 0; x < PROBE; x++) {
          const t = screenToTexel(x, y, PROBE, PROBE, width, height, look);
          const cpu = sampleSeed(state.format, state.seed, t.y * width + t.x);
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
