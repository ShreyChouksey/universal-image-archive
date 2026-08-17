/**
 * Canonical IndexedDB identity for the worker's active address buffer.
 *
 * This is deliberately not the .uia file format. A file encodes and round-trips
 * exact bytes and format and carries no authenticity or integrity proof; this
 * snapshot additionally records how this browser obtained those bytes so a
 * reload never invents a seed recipe from ambient UI state.
 */

export const ACTIVE_ADDRESS_SNAPSHOT_VERSION = 1 as const;
export const UIA_IMAGE_GENERATOR = 'uia-philox4x32-image' as const;
export const UIA_IMAGE_GENERATOR_VERSION = 1 as const;
export const MAX_SNAPSHOT_LABEL_LENGTH = 512;

export type SeedWords = [number, number, number, number];
export type AddressGeometry = 'plane' | 'sphere';

export interface CanonicalAddressFormat {
  width: number;
  height: number;
  bpc: 8 | 16;
  channels: 3;
  geometry: AddressGeometry;
}

export interface DerivedAddressProvenance {
  kind: 'derived';
  generator: typeof UIA_IMAGE_GENERATOR;
  generatorVersion: typeof UIA_IMAGE_GENERATOR_VERSION;
  seed: SeedWords;
  rounds: number;
  totalOffset: number;
}

export type PersistedOpaqueSource = 'file' | 'search' | 'plate' | 'exact-link';
export type OpaqueSource = PersistedOpaqueSource | 'legacy-unknown';

export interface OpaqueAddressProvenance {
  kind: 'opaque';
  source: OpaqueSource;
  label: string;
  /** Navigation return point, not a claim about how the bytes were created. */
  returnSeed: SeedWords | null;
}

export type ActiveAddressProvenance = DerivedAddressProvenance | OpaqueAddressProvenance;

export interface ActiveAddressSnapshotV1 {
  snapshotVersion: typeof ACTIVE_ADDRESS_SNAPSHOT_VERSION;
  bytes: ArrayBuffer;
  format: CanonicalAddressFormat;
  provenance: DerivedAddressProvenance | (OpaqueAddressProvenance & { source: PersistedOpaqueSource });
}

export interface LegacyActiveAddressRecord {
  bytes: ArrayBuffer;
  hex: string;
  resolutionId: string;
  depthId: string;
  geometry: AddressGeometry;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isUint32 = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffffffff;

function parseSeedWords(value: unknown): SeedWords | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(isUint32)) return null;
  return [value[0]!, value[1]!, value[2]!, value[3]!];
}

export function cloneProvenance(provenance: ActiveAddressProvenance): ActiveAddressProvenance {
  if (provenance.kind === 'derived') {
    return { ...provenance, seed: [...provenance.seed] as SeedWords };
  }
  return {
    ...provenance,
    returnSeed: provenance.returnSeed ? ([...provenance.returnSeed] as SeedWords) : null,
  };
}

export function isPersistableProvenance(
  provenance: ActiveAddressProvenance | null,
): provenance is ActiveAddressSnapshotV1['provenance'] {
  return provenance !== null &&
    (provenance.kind === 'derived' || provenance.source !== 'legacy-unknown');
}

export function canonicalAddressByteLength(format: CanonicalAddressFormat): number | null {
  if (!Number.isInteger(format.width) || format.width < 1 || format.width > 0xffffffff) return null;
  if (!Number.isInteger(format.height) || format.height < 1 || format.height > 0xffffffff) return null;
  if (format.bpc !== 8 && format.bpc !== 16) return null;
  if (format.channels !== 3) return null;
  if (format.geometry !== 'plane' && format.geometry !== 'sphere') return null;
  const length = format.width * format.height * format.channels * (format.bpc / 8);
  return Number.isSafeInteger(length) ? length : null;
}

export function parseCanonicalAddressFormat(value: unknown): CanonicalAddressFormat | null {
  if (!isRecord(value)) return null;
  if (typeof value.width !== 'number' || typeof value.height !== 'number') return null;
  const candidate: CanonicalAddressFormat = {
    width: value.width,
    height: value.height,
    bpc: value.bpc as 8 | 16,
    channels: value.channels as 3,
    geometry: value.geometry as AddressGeometry,
  };
  return canonicalAddressByteLength(candidate) === null ? null : candidate;
}

export function parseActiveAddressProvenance(value: unknown): ActiveAddressProvenance | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'derived') {
    const seed = parseSeedWords(value.seed);
    if (
      value.generator !== UIA_IMAGE_GENERATOR ||
      value.generatorVersion !== UIA_IMAGE_GENERATOR_VERSION ||
      !seed ||
      !Number.isInteger(value.rounds) ||
      Number(value.rounds) < 12 ||
      Number(value.rounds) > 24 ||
      !Number.isSafeInteger(value.totalOffset)
    ) {
      return null;
    }
    return {
      kind: 'derived',
      generator: UIA_IMAGE_GENERATOR,
      generatorVersion: UIA_IMAGE_GENERATOR_VERSION,
      seed,
      rounds: Number(value.rounds),
      totalOffset: Number(value.totalOffset),
    };
  }

  if (value.kind === 'opaque') {
    const sources: readonly OpaqueSource[] = ['file', 'search', 'plate', 'exact-link', 'legacy-unknown'];
    if (
      typeof value.source !== 'string' ||
      !sources.includes(value.source as OpaqueSource) ||
      typeof value.label !== 'string' ||
      value.label.length < 1 ||
      value.label.length > MAX_SNAPSHOT_LABEL_LENGTH
    ) {
      return null;
    }
    const source = value.source as OpaqueSource;
    let returnSeed: SeedWords | null;
    if (source === 'exact-link' || source === 'legacy-unknown') {
      if (value.returnSeed !== null) return null;
      returnSeed = null;
    } else {
      returnSeed = parseSeedWords(value.returnSeed);
      if (!returnSeed) return null;
    }
    return {
      kind: 'opaque',
      source,
      label: value.label,
      returnSeed,
    };
  }
  return null;
}

export function createActiveAddressSnapshot(
  bytes: Uint8Array,
  format: CanonicalAddressFormat,
  provenance: ActiveAddressProvenance,
): ActiveAddressSnapshotV1 | null {
  const expected = canonicalAddressByteLength(format);
  const parsedProvenance = parseActiveAddressProvenance(provenance);
  if (expected === null || bytes.byteLength !== expected || !parsedProvenance) return null;
  if (!isPersistableProvenance(parsedProvenance)) return null;
  return {
    snapshotVersion: ACTIVE_ADDRESS_SNAPSHOT_VERSION,
    bytes: bytes.slice().buffer,
    format: { ...format },
    provenance: cloneProvenance(parsedProvenance) as ActiveAddressSnapshotV1['provenance'],
  };
}

export function parseActiveAddressSnapshot(value: unknown): ActiveAddressSnapshotV1 | null {
  if (!isRecord(value) || value.snapshotVersion !== ACTIVE_ADDRESS_SNAPSHOT_VERSION) return null;
  if (!(value.bytes instanceof ArrayBuffer)) return null;
  const format = parseCanonicalAddressFormat(value.format);
  const provenance = parseActiveAddressProvenance(value.provenance);
  if (!format || !provenance || !isPersistableProvenance(provenance)) return null;
  if (canonicalAddressByteLength(format) !== value.bytes.byteLength) return null;
  return {
    snapshotVersion: ACTIVE_ADDRESS_SNAPSHOT_VERSION,
    bytes: value.bytes.slice(0),
    format,
    provenance: cloneProvenance(provenance) as ActiveAddressSnapshotV1['provenance'],
  };
}

export function hasSnapshotVersion(value: unknown): boolean {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'snapshotVersion');
}

/** Recognise only the exact pre-M1 record family; future/corrupt v1 records never degrade to legacy. */
export function parseLegacyActiveAddressRecord(value: unknown): LegacyActiveAddressRecord | null {
  if (!isRecord(value) || hasSnapshotVersion(value)) return null;
  if (
    !(value.bytes instanceof ArrayBuffer) ||
    typeof value.hex !== 'string' ||
    !/^[0-9a-f]*$/.test(value.hex) ||
    value.hex.length !== value.bytes.byteLength * 2 ||
    typeof value.resolutionId !== 'string' ||
    typeof value.depthId !== 'string' ||
    (value.geometry !== 'plane' && value.geometry !== 'sphere')
  ) {
    return null;
  }
  return {
    bytes: value.bytes.slice(0),
    hex: value.hex,
    resolutionId: value.resolutionId,
    depthId: value.depthId,
    geometry: value.geometry,
  };
}
