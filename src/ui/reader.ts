/**
 * The address reader.
 *
 * The bench can only ever show the first and last sixteen bytes of a
 * 47-megabyte number, which states the scale without conveying it. This reads
 * the real thing: any window of it, on demand, with the pixel each row belongs
 * to printed beside it — so the number and the picture stop being two facts
 * about each other and become one object you can move around inside.
 *
 * Hexadecimal rather than decimal, and not as a compromise. The address is a
 * byte string; hex is a bijective rendering of it with O(1) random access, so
 * any window is instant. Decimal has no such property — the digit at position
 * n depends on all 47 megabytes — which is why the decimal expansion is an
 * export that takes a minute rather than a view that scrolls.
 */

import type { ArchiveClient } from '../core/archiveClient';
import type { ArchiveFormat } from '../core/format';

const BYTES_PER_ROW = 16;
const ROW_HEIGHT = 18;

const HEX = '0123456789abcdef';

export interface ReaderHooks {
  /** Bring a pixel into view on the stage. */
  locate(x: number, y: number): void;
}

export class Reader {
  #client: ArchiveClient;
  #hooks: ReaderHooks;
  #format: ArchiveFormat;
  #totalBytes = 0;
  #offset = 0;
  #rows = 0;
  #token = 0;

  #elViewport: HTMLElement;
  #elRows: HTMLElement;
  #elSlider: HTMLInputElement;
  #elWhere: HTMLElement;

  constructor(client: ArchiveClient, format: ArchiveFormat, hooks: ReaderHooks) {
    this.#client = client;
    this.#format = format;
    this.#hooks = hooks;

    const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    this.#elViewport = byId('reader');
    this.#elRows = byId('readerRows');
    this.#elSlider = byId<HTMLInputElement>('readerSlider');
    this.#elWhere = byId('addressWhere');

    this.#rows = Math.max(1, Math.floor((this.#elViewport.clientHeight - 16) / ROW_HEIGHT));

    this.#elViewport.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        // Three rows a notch, and a hundred with shift, because covering three
        // million rows one at a time is not travel.
        const step = (e.shiftKey ? 100 : 3) * BYTES_PER_ROW;
        this.goto(this.#offset + Math.sign(e.deltaY) * step);
      },
      { passive: false },
    );

    this.#elSlider.addEventListener('input', () => {
      const fraction = Number(this.#elSlider.value) / Number(this.#elSlider.max);
      this.goto(Math.round(fraction * this.#totalBytes), { fromSlider: true });
    });

    byId('readerJumpGo').addEventListener('click', () => this.#jump());
    byId<HTMLInputElement>('readerJump').addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.#jump();
    });
  }

  #jump(): void {
    const raw = (document.getElementById('readerJump') as HTMLInputElement).value.replace(/[\s,_]/g, '');
    const at = Number(raw);
    if (Number.isFinite(at)) this.goto(at);
  }

  setFormat(format: ArchiveFormat, totalBytes: number): void {
    this.#format = format;
    this.#totalBytes = totalBytes;
    this.#offset = 0;
    this.#elSlider.value = '0';
    this.#describeScale();
    void this.refresh();
  }

  /**
   * States what the slider is actually geared to, measured from its own width.
   *
   * The temptation is to write "every notch is thousands of lines" and move on.
   * It is not true — a keyboard step is three — and the real figure is better
   * anyway: one pixel of drag crosses several thousand lines, which is the whole
   * point being made.
   */
  #describeScale(): void {
    const el = document.getElementById('readerScale');
    if (!el) return;
    const trackPx = Math.max(1, this.#elSlider.clientWidth);
    const rowsPerDragPixel = this.#totalBytes / BYTES_PER_ROW / trackPx;
    const rowsPerNotch = this.#totalBytes / Number(this.#elSlider.max) / BYTES_PER_ROW;
    const total = Math.ceil(this.#totalBytes / BYTES_PER_ROW);

    el.textContent =
      `${total.toLocaleString('en-US')} lines in all. Dragging that slider by a single pixel ` +
      `crosses about ${Math.round(rowsPerDragPixel).toLocaleString('en-US')} of them; ` +
      `an arrow key moves ${rowsPerNotch < 1 ? 'less than one' : Math.round(rowsPerNotch).toLocaleString('en-US')}. ` +
      `Scroll the panel to read, hold shift to go faster.`;
  }

  goto(byte: number, { fromSlider = false } = {}): void {
    const maxOffset = Math.max(0, this.#totalBytes - this.#rows * BYTES_PER_ROW);
    this.#offset = Math.max(0, Math.min(maxOffset, Math.floor(byte / BYTES_PER_ROW) * BYTES_PER_ROW));
    if (!fromSlider && this.#totalBytes > 0) {
      const max = Number(this.#elSlider.max);
      this.#elSlider.value = String(Math.round((this.#offset / this.#totalBytes) * max));
    }
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.#totalBytes === 0) return;
    const token = ++this.#token;
    const { from, bytes } = await this.#client.slice(this.#offset, this.#rows * BYTES_PER_ROW);
    // A newer request may have landed while this one was in the worker.
    if (token !== this.#token) return;

    const { width } = this.#format.resolution;
    const bpp = this.#format.depth.bytesPerPixel;
    const frag = document.createDocumentFragment();

    for (let r = 0; r * BYTES_PER_ROW < bytes.length; r++) {
      const rowStart = from + r * BYTES_PER_ROW;
      let hex = '';
      for (let i = 0; i < BYTES_PER_ROW; i++) {
        const at = r * BYTES_PER_ROW + i;
        if (at >= bytes.length) break;
        hex += HEX[bytes[at] >> 4] + HEX[bytes[at] & 15];
        if (i % 2 === 1) hex += ' ';
      }

      const pixel = Math.floor(rowStart / bpp);
      const px = pixel % width;
      const py = Math.floor(pixel / width);

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'reader__row';
      row.innerHTML = `<b>${rowStart.toLocaleString('en-US')}</b><span>${hex.trim()}</span><i>${px}, ${py}</i>`;
      row.title = `Byte ${rowStart.toLocaleString('en-US')} — pixel ${px}, ${py}`;
      row.addEventListener('click', () => this.#hooks.locate(px, py));
      frag.appendChild(row);
    }

    this.#elRows.replaceChildren(frag);

    const percent = (this.#offset / this.#totalBytes) * 100;
    this.#elWhere.textContent =
      `byte ${this.#offset.toLocaleString('en-US')} of ${this.#totalBytes.toLocaleString('en-US')}` +
      ` — ${percent < 0.001 && percent > 0 ? '<0.001' : percent.toFixed(3)}% in`;
  }
}

/** Draws the byte histogram: 256 counts, flat when there is no structure. */
export function drawHistogram(canvas: HTMLCanvasElement, histogram: Uint32Array): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 320;
  const h = 64;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  let max = 0;
  for (const v of histogram) max = Math.max(max, v);
  if (max === 0) return;

  // Scaled against the mean rather than the maximum, so the flatness is visible
  // instead of being flattened further by an outlier.
  const mean = histogram.reduce((a, b) => a + b, 0) / 256;
  const ceiling = mean * 1.6;

  const style = getComputedStyle(document.documentElement);
  ctx.fillStyle = style.getPropertyValue('--ink-2').trim() || '#a79d8e';
  const barW = w / 256;
  for (let i = 0; i < 256; i++) {
    const bar = Math.min(1, histogram[i] / ceiling) * (h - 10);
    ctx.fillRect(i * barW, h - bar - 1, Math.max(0.5, barW - 0.4), bar);
  }

  ctx.strokeStyle = style.getPropertyValue('--rule-strong').trim() || '#453d33';
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  const meanY = h - (mean / ceiling) * (h - 10) - 1;
  ctx.moveTo(0, meanY);
  ctx.lineTo(w, meanY);
  ctx.stroke();
}
