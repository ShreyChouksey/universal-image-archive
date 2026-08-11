/**
 * The stage: the viewing surface and everything that happens on it.
 *
 * Owns pan, zoom, and the loupe. Zoom is anchored under the cursor so the pixel
 * you are pointing at stays put — the difference between an image viewer that
 * feels like an instrument and one that feels like a slideshow.
 */

import type { Renderer, ViewState } from '../gpu/renderer';
import type { ArchiveFormat } from '../core/format';
import {
  DEFAULT_FOV,
  MAX_FOV,
  MIN_FOV,
  arcminPerTexel,
  directionOfTexel,
  screenToTexel,
} from '../core/sphere';

export interface Sample {
  r: number;
  g: number;
  b: number;
}

export interface StageHooks {
  /** Channel values at an image pixel, or null if unavailable. */
  sample(x: number, y: number): Sample | null;
  onViewChange(): void;
}

const MIN_ZOOM_FACTOR = 0.9; // relative to fit
const MAX_ZOOM = 48;

export class Stage {
  readonly view: ViewState = { x: 0, y: 0, zoom: 1, yaw: 0, pitch: 0, fov: DEFAULT_FOV };

  #canvas: HTMLCanvasElement;
  #renderer: Renderer;
  #format: ArchiveFormat;
  #hooks: StageHooks;
  #viewportW = 1;
  #viewportH = 1;
  #dpr = 1;
  #dragging = false;
  #lastPointer: { x: number; y: number } | null = null;
  #cursor: { x: number; y: number } | null = null;
  #loupeVisible = false;

  #elLoupe: HTMLElement;
  #elSwatch: HTMLElement;
  #elR: HTMLElement;
  #elG: HTMLElement;
  #elB: HTMLElement;
  #elOffset: HTMLElement;
  #elTotal: HTMLElement;
  #elZoom: HTMLElement;
  #elCursor: HTMLElement;

  constructor(
    root: HTMLElement,
    canvas: HTMLCanvasElement,
    renderer: Renderer,
    format: ArchiveFormat,
    hooks: StageHooks,
  ) {
    this.#canvas = canvas;
    this.#renderer = renderer;
    this.#format = format;
    this.#hooks = hooks;

    const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    this.#elLoupe = byId('loupe');
    this.#elSwatch = byId('loupeSwatch');
    this.#elR = byId('loupeR');
    this.#elG = byId('loupeG');
    this.#elB = byId('loupeB');
    this.#elOffset = byId('loupeOffset');
    this.#elTotal = byId('loupeTotal');
    this.#elZoom = byId('zoomReadout');
    this.#elCursor = byId('cursorReadout');

    // Measure once synchronously: the observer's first callback does not arrive
    // until after a frame, and anything that fits the grid before then would be
    // fitting it to a 1x1 viewport.
    this.#measure();
    let resizeRaf = 0;
    const observer = new ResizeObserver(() => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        this.resize();
      });
    });
    observer.observe(root);

    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.#dragging = true;
      this.#lastPointer = { x: e.clientX, y: e.clientY };
      root.setPointerCapture(e.pointerId);
    });

    root.addEventListener('pointermove', (e) => {
      const rect = root.getBoundingClientRect();
      this.#cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (this.#dragging && this.#lastPointer) {
        const dx = (e.clientX - this.#lastPointer.x) * this.#dpr;
        const dy = (e.clientY - this.#lastPointer.y) * this.#dpr;
        if (this.#sphere) {
          // Drag moves the world with the cursor, so the scene follows the hand
          // rather than the camera doing. Scaled by fov so the gearing stays
          // constant as the view narrows.
          const perPixel = this.view.fov / this.#viewportH;
          this.view.yaw -= dx * perPixel;
          // Dragging down pulls the sky down, which is looking up — and up is
          // now genuinely positive pitch.
          this.view.pitch += dy * perPixel;
          this.#clampLook();
        } else {
          this.view.x -= dx / this.view.zoom;
          this.view.y -= dy / this.view.zoom;
          this.#clamp();
        }
        this.#lastPointer = { x: e.clientX, y: e.clientY };
        this.#hooks.onViewChange();
      }
      this.updateReadouts();
    });

    const endDrag = (e: PointerEvent) => {
      this.#dragging = false;
      this.#lastPointer = null;
      if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
    };
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);
    root.addEventListener('pointerleave', () => {
      this.#cursor = null;
      this.updateReadouts();
    });

    root.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = root.getBoundingClientRect();
        const px = (e.clientX - rect.left) * this.#dpr;
        const py = (e.clientY - rect.top) * this.#dpr;
        this.zoomAt(px, py, Math.exp(-e.deltaY * 0.0015));
        void px;
        void py;
      },
      { passive: false },
    );
  }

  setFormat(format: ArchiveFormat): void {
    this.#format = format;
    this.#measure();
    this.fit();
    this.#elTotal.textContent = (
      format.resolution.width *
      format.resolution.height *
      format.depth.bytesPerPixel
    ).toLocaleString('en-US');
  }

  get fitZoom(): number {
    const margin = 24 * this.#dpr;
    const availW = Math.max(1, this.#viewportW - margin * 2);
    const availH = Math.max(1, this.#viewportH - margin * 2);
    return Math.min(
      availW / this.#format.resolution.width,
      availH / this.#format.resolution.height,
    );
  }

  #measure(): void {
    const root = this.#canvas.parentElement!;
    this.#dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = root.getBoundingClientRect();
    const style = window.getComputedStyle(root);
    const padX = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
    const padY = parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0');
    const width = Math.max(1, rect.width - padX);
    const height = Math.max(1, rect.height - padY);
    this.#viewportW = Math.max(1, Math.round(width * this.#dpr));
    this.#viewportH = Math.max(1, Math.round(height * this.#dpr));
    this.#renderer.resize(this.#viewportW, this.#viewportH);
  }

  resize(): void {
    const wasFit = this.#atFit;
    this.#measure();
    // A viewer sitting at fit expects to stay there when the window changes;
    // one who has zoomed in expects to keep their magnification.
    if (wasFit) this.fit();
    else {
      this.#clamp();
      this.#hooks.onViewChange();
      this.updateReadouts();
    }
  }

  get #sphere(): boolean {
    return this.#format.resolution.geometry === 'sphere';
  }

  /**
   * Pitch stops at the poles and yaw runs free.
   *
   * Letting pitch past ±90° would roll the horizon over, which reads as the
   * world tipping rather than the head turning. Yaw wraps because a full turn is
   * exactly what the grid holds.
   */
  #clampLook(): void {
    const limit = Math.PI / 2;
    this.view.pitch = Math.max(-limit, Math.min(limit, this.view.pitch));
    const turn = Math.PI * 2;
    this.view.yaw = ((this.view.yaw + Math.PI) % turn + turn) % turn - Math.PI;
  }

  get #atFit(): boolean {
    if (this.#sphere) return Math.abs(this.view.fov - DEFAULT_FOV) < 1e-4;
    return Math.abs(this.view.zoom - this.fitZoom) < this.fitZoom * 1e-3;
  }

  fit(): void {
    if (this.#sphere) {
      // Facing forward at a natural 90°, which is roughly what a person sees
      // without moving their eyes.
      this.view.yaw = 0;
      this.view.pitch = 0;
      this.view.fov = DEFAULT_FOV;
    } else {
      this.view.zoom = this.fitZoom;
      this.view.x = this.#format.resolution.width / 2;
      this.view.y = this.#format.resolution.height / 2;
    }
    this.#hooks.onViewChange();
    this.updateReadouts();
  }

  /** One archive texel per device pixel — at the equator, for a sphere. */
  actualSize(): void {
    if (this.#sphere) {
      // Vertical texels spanned = fov/pi * H. Setting that equal to the viewport
      // height puts the grid at 1:1 down the middle of the view.
      this.view.fov = Math.max(
        MIN_FOV,
        Math.min(MAX_FOV, (Math.PI * this.#viewportH) / this.#format.resolution.height),
      );
    } else {
      const before = this.view.zoom;
      this.view.zoom = 1;
      if (before !== this.view.zoom) this.#clamp();
    }
    this.#hooks.onViewChange();
    this.updateReadouts();
  }

  zoomAt(px: number, py: number, factor: number): void {
    if (this.#sphere) {
      // Narrowing the field of view is the sphere's zoom. It is not anchored to
      // the cursor: on a sphere that would swing the heading as well, and the
      // combined motion is disorienting.
      const next = Math.max(MIN_FOV, Math.min(MAX_FOV, this.view.fov / factor));
      if (next === this.view.fov) return;
      this.view.fov = next;
      this.#hooks.onViewChange();
      this.updateReadouts();
      return;
    }

    const min = this.fitZoom * MIN_ZOOM_FACTOR;
    const next = Math.min(MAX_ZOOM, Math.max(min, this.view.zoom * factor));
    if (next === this.view.zoom) return;

    // Keep the image point under the cursor fixed across the zoom.
    const ox = (px - this.#viewportW / 2) / this.view.zoom + this.view.x;
    const oy = (py - this.#viewportH / 2) / this.view.zoom + this.view.y;
    this.view.zoom = next;
    this.view.x = ox - (px - this.#viewportW / 2) / next;
    this.view.y = oy - (py - this.#viewportH / 2) / next;

    this.#clamp();
    this.#hooks.onViewChange();
    this.updateReadouts();
  }

  /**
   * Bring one texel into view — the move that turns a byte offset into a place.
   *
   * On a plane that means centring and magnifying it; on a sphere it means
   * turning the head until you are facing it, which is the same instruction
   * expressed in the only terms a standpoint has.
   */
  focusPixel(x: number, y: number, magnification = 12): void {
    const { width, height } = this.#format.resolution;
    if (this.#sphere) {
      const dir = directionOfTexel(x, y, width, height);
      this.view.yaw = Math.atan2(dir[0], dir[2]);
      this.view.pitch = Math.asin(Math.max(-1, Math.min(1, dir[1])));
      this.view.fov = Math.max(MIN_FOV, Math.min(MAX_FOV, (Math.PI * this.#viewportH) / height / magnification));
      this.#clampLook();
    } else {
      this.view.zoom = Math.min(MAX_ZOOM, Math.max(this.fitZoom, magnification));
      this.view.x = x + 0.5;
      this.view.y = y + 0.5;
      this.#clamp();
    }
    this.#hooks.onViewChange();
    this.updateReadouts();
  }

  #clamp(): void {
    const { width, height } = this.#format.resolution;
    const halfW = this.#viewportW / this.view.zoom / 2;
    const halfH = this.#viewportH / this.view.zoom / 2;
    // When the image is smaller than the viewport on an axis, pin it centred.
    this.view.x = halfW * 2 >= width ? width / 2 : Math.min(width - halfW, Math.max(halfW, this.view.x));
    this.view.y = halfH * 2 >= height ? height / 2 : Math.min(height - halfH, Math.max(halfH, this.view.y));
  }

  toggleLoupe(force?: boolean): boolean {
    this.#loupeVisible = force ?? !this.#loupeVisible;
    this.#elLoupe.hidden = !this.#loupeVisible;
    this.updateReadouts();
    return this.#loupeVisible;
  }

  /** Image texel under the cursor, or null. */
  pixelUnderCursor(): { x: number; y: number } | null {
    if (!this.#cursor) return null;
    const px = this.#cursor.x * this.#dpr;
    const py = this.#cursor.y * this.#dpr;
    const { width, height } = this.#format.resolution;

    if (this.#sphere) {
      // Through the same projection the shader uses, so the loupe's byte offset
      // is the byte the pixel on screen actually came from.
      const t = screenToTexel(px, py, this.#viewportW, this.#viewportH, width, height, this.view);
      return { x: t.x, y: t.y };
    }

    const x = Math.floor((px - this.#viewportW / 2) / this.view.zoom + this.view.x);
    const y = Math.floor((py - this.#viewportH / 2) / this.view.zoom + this.view.y);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    return { x, y };
  }

  updateReadouts(): void {
    if (this.#sphere) {
      const deg = (this.view.fov * 180) / Math.PI;
      const arcmin = arcminPerTexel(this.#format.resolution.width);
      this.#elZoom.textContent = `${deg.toFixed(deg < 10 ? 1 : 0)}° · ${arcmin.toFixed(2)}′/texel`;
      const yaw = ((this.view.yaw * 180) / Math.PI + 360) % 360;
      const pitch = (this.view.pitch * 180) / Math.PI;
      this.#elCursor.textContent = `${yaw.toFixed(0)}° ${pitch >= 0 ? '+' : ''}${pitch.toFixed(0)}°`;
    } else {
      const ratio = this.view.zoom / this.#dpr;
      this.#elZoom.textContent =
        Math.abs(this.view.zoom - this.fitZoom) < 1e-6
          ? `fit · ${(ratio * 100).toFixed(0)}%`
          : `${ratio >= 1 ? ratio.toFixed(ratio < 10 ? 1 : 0) + '×' : (ratio * 100).toFixed(0) + '%'}`;
      const at = this.pixelUnderCursor();
      this.#elCursor.textContent = at ? `${at.x}, ${at.y}` : '—';
    }

    const pixel = this.pixelUnderCursor();

    if (!this.#loupeVisible) return;

    const sample = pixel ? this.#hooks.sample(pixel.x, pixel.y) : null;
    if (!sample || !pixel) {
      this.#elR.textContent = this.#elG.textContent = this.#elB.textContent = '—';
      this.#elOffset.textContent = '—';
      this.#elSwatch.style.background = '#000';
      return;
    }

    const max = this.#format.depth.maxChannel;
    const pad = this.#format.depth.bpc === 16 ? 5 : 3;
    this.#elR.textContent = String(sample.r).padStart(pad, ' ');
    this.#elG.textContent = String(sample.g).padStart(pad, ' ');
    this.#elB.textContent = String(sample.b).padStart(pad, ' ');
    this.#elSwatch.style.background = `color(display-p3 ${sample.r / max} ${sample.g / max} ${
      sample.b / max
    })`;

    const index = pixel.y * this.#format.resolution.width + pixel.x;
    this.#elOffset.textContent = (index * this.#format.depth.bytesPerPixel).toLocaleString('en-US');
  }
}
