/**
 * Typed, promise-shaped front door to the archive worker.
 *
 * Requests are correlated by id; progress messages fan out to a listener so the
 * UI can show what a 47.5 MiB operation is actually doing rather than spinning.
 */

import type { AddressReadout } from './address';
import type { ArchiveFormat } from './format';
import type { PlateReport, PlateVerdict } from './plate';
import type { EntropyReport, Request, Response, SearchOptions } from '../workers/archive.worker';
import type { Seed } from './philox';

export type { SearchOptions, FitMode, FlipMode, LowBits, EntropyReport } from '../workers/archive.worker';

export interface Progress {
  label: string;
  fraction: number;
}

type Pending = {
  resolve: (value: Response) => void;
  reject: (reason: Error) => void;
  onProgress?: (p: Progress) => void;
};

/** `Omit` over a union collapses it; this distributes across the members instead. */
type Unaddressed<T> = T extends { id: number } ? Omit<T, 'id'> : never;

export class ArchiveClient {
  #worker: Worker;
  #pending = new Map<number, Pending>();
  #nextId = 1;

  constructor() {
    this.#worker = new Worker(new URL('../workers/archive.worker.ts', import.meta.url), {
      type: 'module',
      name: 'archive',
    });
    this.#worker.onmessage = (event: MessageEvent<Response>) => {
      const msg = event.data;
      const pending = this.#pending.get(msg.id);
      if (!pending) return;
      if (msg.kind === 'progress') {
        pending.onProgress?.({ label: msg.label, fraction: msg.fraction });
        return;
      }
      this.#pending.delete(msg.id);
      if (msg.kind === 'error') pending.reject(new Error(msg.message));
      else pending.resolve(msg);
    };
  }

  #send(
    req: Unaddressed<Request>,
    transfer: Transferable[] = [],
    onProgress?: (p: Progress) => void,
  ): Promise<Response> {
    const id = this.#nextId++;
    return new Promise<Response>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, onProgress });
      this.#worker.postMessage({ ...req, id } as Request, transfer);
    });
  }

  async materialise(format: ArchiveFormat, seed: Seed, onProgress?: (p: Progress) => void): Promise<void> {
    await this.#send({ kind: 'materialise', format, seed: Array.from(seed) }, [], onProgress);
  }

  async search(
    format: ArchiveFormat,
    bitmap: ImageBitmap,
    options: SearchOptions,
    seed: Seed,
    onProgress?: (p: Progress) => void,
  ): Promise<void> {
    await this.#send(
      { kind: 'search', format, bitmap, options, seed: Array.from(seed) },
      [bitmap],
      onProgress,
    );
  }

  async adopt(format: ArchiveFormat, bytes: ArrayBuffer): Promise<void> {
    await this.#send({ kind: 'adopt', format, bytes }, [bytes]);
  }

  /** Parses a decimal address off the main thread and loads it. */
  async importDecimal(
    text: string,
    formats: ArchiveFormat[],
    onProgress?: (p: Progress) => void,
  ): Promise<ArchiveFormat> {
    const res = await this.#send({ kind: 'importDecimal', text, formats }, [], onProgress);
    if (res.kind !== 'imported') throw new Error('unexpected response');
    return res.format;
  }

  /** Mints a plate and leaves it loaded as the current address. */
  async plate(
    format: ArchiveFormat,
    seed: Seed,
    statement: string,
    layoutId: string,
    onProgress?: (p: Progress) => void,
  ): Promise<PlateReport> {
    const res = await this.#send(
      { kind: 'plate', format, seed: Array.from(seed), statement, layoutId },
      [],
      onProgress,
    );
    if (res.kind !== 'plate') throw new Error('unexpected response');
    return res.report;
  }

  /** Runs the plate composition self-check where it cannot stall a frame. */
  async plateSelfCheck(format: ArchiveFormat, seed: Seed): Promise<void> {
    await this.#send({ kind: 'selfcheck', format, seed: Array.from(seed) });
  }

  /** Checks whether the loaded address is a plate, and whether it tells the truth. */
  async verify(format: ArchiveFormat): Promise<PlateVerdict> {
    const res = await this.#send({ kind: 'verify', format });
    if (res.kind !== 'verdict') throw new Error('unexpected response');
    return res.verdict;
  }

  /** A window into the loaded address, for the viewer. */
  async slice(from: number, count: number): Promise<{ from: number; bytes: Uint8Array }> {
    const res = await this.#send({ kind: 'slice', from, count });
    if (res.kind !== 'slice') throw new Error('unexpected response');
    return res;
  }

  /** Measured entropy and incompressibility of the loaded address. */
  async entropy(): Promise<EntropyReport> {
    const res = await this.#send({ kind: 'entropy' });
    if (res.kind !== 'entropy') throw new Error('unexpected response');
    return res.report;
  }

  async hexFile(onProgress?: (p: Progress) => void): Promise<{ blob: Blob; filename: string }> {
    const res = await this.#send({ kind: 'hexFile' }, [], onProgress);
    if (res.kind !== 'blob') throw new Error('unexpected response');
    return res;
  }

  async decimalFile(onProgress?: (p: Progress) => void): Promise<{ blob: Blob; filename: string }> {
    const res = await this.#send({ kind: 'decimal' }, [], onProgress);
    if (res.kind !== 'blob') throw new Error('unexpected response');
    return res;
  }

  /** Move the loaded address by `delta`; returns the lowest byte index changed. */
  async step(delta: number): Promise<number> {
    const res = await this.#send({ kind: 'step', delta });
    if (res.kind !== 'stepped') throw new Error('unexpected response');
    return res.changedFrom;
  }

  /** A horizontal band of the loaded address as RGBA16 texels. */
  async textureRows(y0: number, rows: number): Promise<{ y0: number; rows: number; data: Uint16Array }> {
    const res = await this.#send({ kind: 'textureRows', y0, rows });
    if (res.kind !== 'textureRows') throw new Error('unexpected response');
    return res;
  }

  async texture(): Promise<{ width: number; height: number; data: Uint16Array }> {
    const res = await this.#send({ kind: 'texture' });
    if (res.kind !== 'texture') throw new Error('unexpected response');
    return res;
  }

  async readout(): Promise<AddressReadout> {
    const res = await this.#send({ kind: 'readout' });
    if (res.kind !== 'readout') throw new Error('unexpected response');
    return res.readout;
  }

  async png(onProgress?: (p: Progress) => void): Promise<{ blob: Blob; filename: string }> {
    const res = await this.#send({ kind: 'png' }, [], onProgress);
    if (res.kind !== 'blob') throw new Error('unexpected response');
    return res;
  }

  async addressFile(): Promise<{ blob: Blob; filename: string }> {
    const res = await this.#send({ kind: 'addressFile' });
    if (res.kind !== 'blob') throw new Error('unexpected response');
    return res;
  }

  async release(): Promise<void> {
    await this.#send({ kind: 'release' });
  }
}
