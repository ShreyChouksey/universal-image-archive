import { expect, type Page } from '@playwright/test';

export const FIXED_COORDINATE = '000102030405060708090a0b0c0d0e0f';
export const TEST_LOCATION = `/?backend=webgl2#c=${FIXED_COORDINATE}&g=plane&r=px2&d=d48&n=12`;
export const RAW_ADDRESS_BYTES = 24;
export const UIA2_HEADER_BYTES = 20;
const PROBE_SIZE = 8;

interface ActiveAddressRecord {
  bytes?: ArrayBuffer;
  resolutionId?: string;
  depthId?: string;
  geometry?: string;
}

interface ArchiveFormat {
  resolution: { width: number; height: number; geometry: 'plane' | 'sphere' };
  depth: { bpc: 8 | 16; bytesPerPixel: 3 | 6; maxChannel: number };
}

declare global {
  interface Window {
    __archive?: {
      state: {
        format: ArchiveFormat;
        mode: 'seed' | 'address';
        seed: Uint32Array;
        offset: number;
        rounds: number;
        held:
          | { kind: 'none' }
          | { kind: 'seed'; seed: Uint32Array; offset: number; rounds: number }
          | { kind: 'foreign'; label: string; origin: Uint32Array | null; source: string };
        activeAddress: unknown | null;
      };
      client: {
        slice(from: number, count: number): Promise<{ bytes: Uint8Array }>;
        texture(): Promise<unknown>;
      };
      renderer: {
        probe(input: {
          format: ArchiveFormat;
          mode: 'seed' | 'address';
          seed: Uint32Array;
          rounds: number;
        }): Promise<Uint8Array>;
      };
      diagnostics: { resolveAddressCalls: number };
      invalidateActiveAddressIdentity(): void;
      persistCurrentActiveAddress(): Promise<boolean>;
      stepAddress(delta: number): Promise<void>;
    };
  }
}

export async function waitForArchiveBoot(page: Page): Promise<void> {
  await expect(page.locator('#canvas')).toHaveAttribute('data-live', 'true');
  await page.waitForFunction(() => window.__archive !== undefined);
}

export async function workerBytes(page: Page): Promise<number[]> {
  return page.evaluate(async (count) => {
    const archive = window.__archive;
    if (!archive) throw new Error('Development archive handle is unavailable');
    return Array.from((await archive.client.slice(0, count)).bytes);
  }, RAW_ADDRESS_BYTES);
}

/** The renderer's 8-bit projection of the four 16-bit RGB pixels on the 2x2 stage. */
export async function rendererProbeRgb8(page: Page): Promise<number[]> {
  return page.evaluate(async (probeSize) => {
    const archive = window.__archive;
    if (!archive) throw new Error('Development archive handle is unavailable');
    const probe = await archive.renderer.probe({
      format: archive.state.format,
      mode: archive.state.mode,
      seed: archive.state.seed,
      rounds: archive.state.rounds,
    });
    const displayed: number[] = [];
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const start = (y * probeSize + x) * 3;
        displayed.push(probe[start]!, probe[start + 1]!, probe[start + 2]!);
      }
    }
    return displayed;
  }, PROBE_SIZE);
}

export function rgb8Projection(bytes: number[]): number[] {
  if (bytes.length !== RAW_ADDRESS_BYTES) throw new Error('Expected an exact 2x2 RGB16 address');
  const projected: number[] = [];
  for (let pixel = 0; pixel < 4; pixel++) {
    const start = pixel * 6;
    for (const channelOffset of [0, 2, 4]) {
      const value = (bytes[start + channelOffset]! << 8) | bytes[start + channelOffset + 1]!;
      projected.push(Math.round((value * 255) / 65535));
    }
  }
  return projected;
}

export function hex(bytes: number[] | null): string | null {
  return bytes?.map((byte) => byte.toString(16).padStart(2, '0')).join('') ?? null;
}

export async function serializedHeld(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const held = window.__archive?.state.held;
    if (!held) throw new Error('Development archive state is unavailable');
    if (held.kind === 'seed') {
      return { kind: held.kind, seed: Array.from(held.seed), offset: held.offset };
    }
    if (held.kind === 'foreign') {
      return {
        kind: held.kind,
        label: held.label,
        origin: held.origin ? Array.from(held.origin) : null,
      };
    }
    return { kind: held.kind };
  });
}

export async function serializedActiveAddress(page: Page): Promise<unknown> {
  return page.evaluate(() => structuredClone(window.__archive?.state.activeAddress ?? null));
}

export async function resolveAddressCallCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__archive?.diagnostics.resolveAddressCalls ?? -1);
}

export async function invalidateActiveAddressIdentity(page: Page): Promise<void> {
  await page.evaluate(() => window.__archive?.invalidateActiveAddressIdentity());
}

export async function persistCurrentActiveAddress(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__archive?.persistCurrentActiveAddress() ?? false);
}

export async function stepAddress(page: Page, delta: number): Promise<void> {
  await page.evaluate((move) => window.__archive?.stepAddress(move), delta);
}

export async function failNextTextureRead(page: Page): Promise<void> {
  await page.evaluate(() => {
    const archive = window.__archive;
    if (!archive) throw new Error('Development archive handle is unavailable');
    const original = archive.client.texture.bind(archive.client);
    archive.client.texture = async () => {
      archive.client.texture = original;
      throw new Error('M1 injected post-producer texture failure');
    };
  });
}

export async function activeRecordBytes(page: Page): Promise<number[] | null> {
  return page.evaluate(async () => {
    const record = await new Promise<ActiveAddressRecord | null>((resolve, reject) => {
      const request = indexedDB.open('uia_storage', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('active_address')) {
          db.close();
          resolve(null);
          return;
        }
        const transaction = db.transaction('active_address', 'readonly');
        const get = transaction.objectStore('active_address').get('current');
        get.onerror = () => reject(get.error);
        get.onsuccess = () => resolve((get.result as ActiveAddressRecord | undefined) ?? null);
        transaction.oncomplete = () => db.close();
      };
    });
    return record?.bytes ? Array.from(new Uint8Array(record.bytes)) : null;
  });
}

export async function waitForActiveRecord(page: Page, expected: number[]): Promise<void> {
  await expect.poll(() => activeRecordBytes(page), { message: 'IndexedDB commit did not reach the expected bytes' })
    .toEqual(expected);
}

/** JSON-safe view of the whole record, including provenance and canonical format. */
export async function normalizedActiveRecord(page: Page): Promise<unknown | null> {
  return page.evaluate(async () => {
    const record = await new Promise<unknown | null>((resolve, reject) => {
      const request = indexedDB.open('uia_storage', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('active_address')) {
          db.close();
          resolve(null);
          return;
        }
        const transaction = db.transaction('active_address', 'readonly');
        const get = transaction.objectStore('active_address').get('current');
        get.onerror = () => reject(get.error);
        get.onsuccess = () => resolve(get.result ?? null);
        transaction.oncomplete = () => db.close();
      };
    });
    const normalize = (value: unknown): unknown => {
      if (value instanceof ArrayBuffer) return { arrayBuffer: Array.from(new Uint8Array(value)) };
      if (ArrayBuffer.isView(value)) {
        return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      }
      if (Array.isArray(value)) return value.map(normalize);
      if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, child]) => [key, normalize(child)]),
        );
      }
      return value;
    };
    return normalize(record);
  });
}

export async function installLegacyRecord(page: Page, bytes: number[]): Promise<void> {
  await page.evaluate(async (payload) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('uia_storage', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('active_address', 'readwrite');
        transaction.objectStore('active_address').put(
          {
            bytes: Uint8Array.from(payload).buffer,
            hex: payload.map((byte) => byte.toString(16).padStart(2, '0')).join(''),
            resolutionId: 'px2',
            depthId: 'd48',
            geometry: 'plane',
          },
          'current',
        );
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      };
    });
  }, bytes);
}
