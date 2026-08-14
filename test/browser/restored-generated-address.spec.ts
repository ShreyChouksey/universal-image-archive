import { readFile } from 'node:fs/promises';
import { expect, test, type Download } from '@playwright/test';
import {
  createActiveAddressSnapshot,
  parseActiveAddressSnapshot,
} from '../../src/core/activeAddressSnapshot';
import {
  RAW_ADDRESS_BYTES,
  UIA2_HEADER_BYTES,
  activeRecordBytes,
  hex,
  invalidateActiveAddressIdentity,
  normalizedActiveRecord,
  persistCurrentActiveAddress,
  rendererProbeRgb8,
  resolveAddressCallCount,
  rgb8Projection,
  serializedActiveAddress,
  serializedHeld,
  stepAddress,
  waitForActiveRecord,
  waitForArchiveBoot,
  workerBytes,
} from './support/archive';

const GENERATED_LOCATION =
  '/?backend=webgl2#c=000102030405060708090a0b0c0d0e0f&o=7&g=plane&r=px2&d=d48&n=14';
const EXPECTED_GENERATED_HEX = 'b7ba761936097b1d3078effdbe54a0c3aa0a336c6849f3ef';
const EXPECTED_ROUNDS_16_HEX = '4ae839ced615cbdfddda30a61d1e671485aea577211ae552';

function assertSnapshotGuardrails(): void {
  const valid = createActiveAddressSnapshot(
    new Uint8Array(RAW_ADDRESS_BYTES),
    { width: 2, height: 2, bpc: 16, channels: 3, geometry: 'plane' },
    {
      kind: 'derived',
      generator: 'uia-philox4x32-image',
      generatorVersion: 1,
      seed: [1, 2, 3, 4],
      rounds: 14,
      totalOffset: -7,
    },
  );
  expect(valid).not.toBeNull();
  if (!valid) throw new Error('Valid snapshot fixture was rejected');
  expect(parseActiveAddressSnapshot(valid)).not.toBeNull();
  expect(parseActiveAddressSnapshot({ ...valid, snapshotVersion: 2 })).toBeNull();
  expect(parseActiveAddressSnapshot({ ...valid, bytes: new ArrayBuffer(23) })).toBeNull();
  expect(parseActiveAddressSnapshot({
    ...valid,
    format: { ...valid.format, width: '2' },
  })).toBeNull();
  expect(parseActiveAddressSnapshot({
    ...valid,
    provenance: { ...valid.provenance, rounds: 25 },
  })).toBeNull();
  expect(parseActiveAddressSnapshot({
    ...valid,
    provenance: { ...valid.provenance, totalOffset: Number.MAX_SAFE_INTEGER + 1 },
  })).toBeNull();
  expect(parseActiveAddressSnapshot({
    ...valid,
    provenance: { ...valid.provenance, seed: [1, 2, 3, -1] },
  })).toBeNull();
  expect(parseActiveAddressSnapshot({
    ...valid,
    provenance: {
      kind: 'opaque',
      source: 'legacy-unknown',
      label: 'invented migration',
      returnSeed: null,
    },
  })).toBeNull();
}

async function addressPayload(download: Download): Promise<number[]> {
  const path = await download.path();
  if (!path) throw new Error('Browser did not expose the completed download path');
  const container = await readFile(path);
  expect(container.subarray(0, 4).toString('ascii')).toBe('UIA2');
  expect(container).toHaveLength(UIA2_HEADER_BYTES + RAW_ADDRESS_BYTES);
  return Array.from(container.subarray(UIA2_HEADER_BYTES));
}

test('restored generated address remains the same identity and export is observational', async ({ page }) => {
  assertSnapshotGuardrails();
  await page.goto(GENERATED_LOCATION);
  await waitForArchiveBoot(page);
  await page.locator('#materialise').click();
  await page.waitForFunction(() => window.__archive?.state.mode === 'address');
  await expect(page.locator('#busy')).toBeHidden();

  const original = await workerBytes(page);
  const originalHeld = await serializedHeld(page);
  const originalActive = await serializedActiveAddress(page);
  const originalRendererProbe = await rendererProbeRgb8(page);
  await waitForActiveRecord(page, original);
  const originalRecord = await normalizedActiveRecord(page);
  expect(hex(original)).toBe(EXPECTED_GENERATED_HEX);
  expect(originalActive).toEqual({
    kind: 'derived',
    generator: 'uia-philox4x32-image',
    generatorVersion: 1,
    seed: [0x00010203, 0x04050607, 0x08090a0b, 0x0c0d0e0f],
    rounds: 14,
    totalOffset: 7,
  });

  // Exercise the persisted-record restore path, not the exact-address URL path.
  await page.evaluate(() => history.replaceState(null, '', '#g=plane&r=px2&d=d48&n=12'));
  await page.reload();
  await waitForArchiveBoot(page);

  const beforeExport = {
    worker: await workerBytes(page),
    rendererProbe: await rendererProbeRgb8(page),
    held: await serializedHeld(page),
    active: await serializedActiveAddress(page),
    url: page.url(),
    persisted: await activeRecordBytes(page),
    record: await normalizedActiveRecord(page),
  };

  const downloadEvent = page.waitForEvent('download');
  await page.locator('#exportAddress').click();
  const downloaded = await addressPayload(await downloadEvent);

  const afterWorker = await workerBytes(page);
  await waitForActiveRecord(page, afterWorker);
  const afterExport = {
    worker: afterWorker,
    rendererProbe: await rendererProbeRgb8(page),
    held: await serializedHeld(page),
    active: await serializedActiveAddress(page),
    url: page.url(),
    persisted: await activeRecordBytes(page),
    record: await normalizedActiveRecord(page),
    downloaded,
  };

  // The shared observational boundary protects every export surface, not only
  // the binary container. Verify each real UI path at the smallest exact grid.
  const pngEvent = page.waitForEvent('download');
  await page.locator('#exportPng').click();
  const pngPath = await (await pngEvent).path();
  if (!pngPath) throw new Error('PNG download path was unavailable');
  expect((await readFile(pngPath)).subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  await expect(page.locator('#busy')).toBeHidden();

  const hexEvent = page.waitForEvent('download');
  await page.locator('#exportHexBench').click();
  const hexPath = await (await hexEvent).path();
  if (!hexPath) throw new Error('Hex download path was unavailable');
  expect((await readFile(hexPath, 'utf8')).trim()).toBe(EXPECTED_GENERATED_HEX);
  await expect(page.locator('#busy')).toBeHidden();

  page.once('dialog', (dialog) => dialog.accept());
  const decimalEvent = page.waitForEvent('download');
  await page.locator('#exportDecimalBench').click();
  const decimalPath = await (await decimalEvent).path();
  if (!decimalPath) throw new Error('Decimal download path was unavailable');
  expect((await readFile(decimalPath, 'utf8')).trim()).toBe(
    BigInt(`0x${EXPECTED_GENERATED_HEX}`).toString(10),
  );
  await expect(page.locator('#busy')).toBeHidden();
  expect(await workerBytes(page)).toEqual(original);
  expect(await rendererProbeRgb8(page)).toEqual(originalRendererProbe);
  expect(await serializedHeld(page)).toEqual(originalHeld);
  expect(await serializedActiveAddress(page)).toEqual(originalActive);
  expect(await normalizedActiveRecord(page)).toEqual(originalRecord);
  expect(page.url()).toBe(beforeExport.url);

  // Force the second boot through the persisted record as well. The export
  // must not be able to hide an IndexedDB overwrite behind its rewritten URL.
  await page.evaluate(() => history.replaceState(null, '', '#g=plane&r=px2&d=d48&n=12'));
  await page.reload();
  await waitForArchiveBoot(page);
  const secondReload = {
    worker: await workerBytes(page),
    rendererProbe: await rendererProbeRgb8(page),
    held: await serializedHeld(page),
    active: await serializedActiveAddress(page),
    persisted: await activeRecordBytes(page),
    record: await normalizedActiveRecord(page),
  };

  console.info('generated address-identity evidence', JSON.stringify({
    original: hex(original),
    originalHeld,
    beforeExport: {
      worker: hex(beforeExport.worker),
      rendererProbe: hex(beforeExport.rendererProbe),
      held: beforeExport.held,
      active: beforeExport.active,
      url: beforeExport.url,
      persisted: hex(beforeExport.persisted),
    },
    afterExport: {
      worker: hex(afterExport.worker),
      rendererProbe: hex(afterExport.rendererProbe),
      held: afterExport.held,
      active: afterExport.active,
      url: afterExport.url,
      persisted: hex(afterExport.persisted),
      downloaded: hex(afterExport.downloaded),
    },
    secondReload: {
      worker: hex(secondReload.worker),
      rendererProbe: hex(secondReload.rendererProbe),
      held: secondReload.held,
      active: secondReload.active,
      persisted: hex(secondReload.persisted),
    },
  }, null, 2));

  // Controls: restoration initially preserves the exact bytes and renderer projection.
  expect(beforeExport.worker).toEqual(original);
  expect(beforeExport.persisted).toEqual(original);
  expect(beforeExport.record).toEqual(originalRecord);
  expect(beforeExport.rendererProbe).toEqual(rgb8Projection(original));
  expect(originalRendererProbe).toEqual(rgb8Projection(original));

  // Characterization: these invariants fail on the published baseline.
  expect.soft(beforeExport.held, 'reload must preserve the complete generated identity').toEqual(originalHeld);
  expect.soft(beforeExport.active, 'reload must preserve derived provenance').toEqual(originalActive);
  expect.soft(afterExport.worker, 'export must not replace the worker bytes').toEqual(original);
  expect.soft(afterExport.rendererProbe, 'export must not replace the renderer texture output').toEqual(originalRendererProbe);
  expect.soft(afterExport.downloaded, 'download must contain the original address').toEqual(original);
  expect.soft(afterExport.persisted, 'export must not overwrite IndexedDB').toEqual(original);
  expect.soft(afterExport.record, 'export must not rewrite any IndexedDB snapshot field').toEqual(originalRecord);
  expect.soft(afterExport.held, 'export must not replace the active identity').toEqual(originalHeld);
  expect.soft(afterExport.active, 'export must not replace derived provenance').toEqual(originalActive);
  expect.soft(afterExport.url, 'export must not replace the address in the URL').toBe(beforeExport.url);
  expect.soft(secondReload.worker, 'second reload must restore the original worker bytes').toEqual(original);
  expect.soft(secondReload.rendererProbe, 'second reload must restore the original renderer texture output').toEqual(originalRendererProbe);
  expect.soft(secondReload.persisted, 'second reload must retain the original IndexedDB bytes').toEqual(original);
  expect.soft(secondReload.record, 'second reload must retain the complete original snapshot').toEqual(originalRecord);
  expect.soft(secondReload.held, 'second reload must restore the complete generated identity').toEqual(originalHeld);
  expect.soft(secondReload.active, 'second reload must restore derived provenance').toEqual(originalActive);

  // Parking survives more than the first coordinate move. The worker and its
  // identity remain available until the explicit Return action restores them.
  const parkedIdentity = await serializedActiveAddress(page);
  const parkedRecord = await normalizedActiveRecord(page);
  await page.locator('#nextSeed').click();
  await page.locator('#nextSeed').click();
  expect(await page.evaluate(() => window.__archive?.state.mode)).toBe('seed');
  expect(await serializedActiveAddress(page)).toEqual(parkedIdentity);
  expect(await normalizedActiveRecord(page)).toEqual(parkedRecord);
  await page.locator('#parkedReturn').click();
  await page.waitForFunction(() => window.__archive?.state.mode === 'address');
  expect(await workerBytes(page)).toEqual(original);
  expect(await serializedActiveAddress(page)).toEqual(parkedIdentity);

  // Rematerialising a derived address under a different round count must use
  // its complete stored recipe. In particular, the nonzero total offset may
  // not collapse back to the ambient UI offset of zero.
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#philoxRounds').selectOption('16');
  await page.waitForFunction(() => {
    const active = window.__archive?.state.activeAddress as
      | { kind?: string; rounds?: number; totalOffset?: number }
      | null
      | undefined;
    return active?.kind === 'derived' && active.rounds === 16 && active.totalOffset === 7;
  });
  await expect(page.locator('#busy')).toBeHidden();
  expect(hex(await workerBytes(page))).toBe(EXPECTED_ROUNDS_16_HEX);
  expect(await serializedActiveAddress(page)).toMatchObject({ rounds: 16, totalOffset: 7 });
  await waitForActiveRecord(page, await workerBytes(page));

  // A full exact-address link has an honest opaque identity of its own; it must
  // not inherit the generated snapshot that happens to be in IndexedDB.
  // Change the query as well as the fragment so Playwright performs a real
  // document boot; changing only `#a` is a same-document navigation and would
  // (correctly) leave the already-running app's identity untouched.
  await page.goto(
    `/?backend=webgl2&boot=exact-link#a=${EXPECTED_GENERATED_HEX}&g=plane&r=px2&d=d48&n=12`,
  );
  await waitForArchiveBoot(page);
  expect(await workerBytes(page)).toEqual(original);
  expect(await serializedActiveAddress(page)).toMatchObject({
    kind: 'opaque',
    source: 'exact-link',
    label: 'exact address link',
    returnSeed: null,
  });
  expect(await serializedHeld(page)).toMatchObject({ kind: 'foreign', origin: null });

  // A walked address is represented by a virtual renderer offset until it is
  // committed. M1 deliberately refuses export in that state instead of
  // mutating the worker as a hidden pre-download side effect.
  const exactLinkWorker = await workerBytes(page);
  const exactLinkRecord = await normalizedActiveRecord(page);
  const exactLinkIdentity = await serializedActiveAddress(page);
  const exactLinkResolveCalls = await resolveAddressCallCount(page);
  let pendingOffsetDownloads = 0;
  page.on('download', () => pendingOffsetDownloads++);
  await page.locator('#stepUp').click();
  await page.locator('#exportAddress').click();
  await expect(page.locator('#toast')).toContainText('uncommitted step');
  await page.waitForTimeout(100);
  expect(pendingOffsetDownloads).toBe(0);
  expect(await resolveAddressCallCount(page)).toBe(exactLinkResolveCalls);
  expect(await workerBytes(page)).toEqual(exactLinkWorker);
  expect(await normalizedActiveRecord(page)).toEqual(exactLinkRecord);
  expect(await serializedActiveAddress(page)).toEqual(exactLinkIdentity);
  await page.locator('#stepDown').click();

  // Prove the forbidden repair path is unreachable, not merely unnecessary in
  // the happy path. With worker bytes still loaded but identity invalidated,
  // export and stepping must fail visibly without entering resolveAddress.
  const guardedWorker = await workerBytes(page);
  const guardedProbe = await rendererProbeRgb8(page);
  const guardedUrl = page.url();
  const guardedRecord = await normalizedActiveRecord(page);
  const resolveCalls = await resolveAddressCallCount(page);
  await invalidateActiveAddressIdentity(page);
  let downloadCount = 0;
  page.on('download', () => downloadCount++);
  await page.locator('#exportAddress').click();
  await expect(page.locator('#toast')).toContainText('no identity');
  await page.waitForTimeout(100);
  expect(downloadCount).toBe(0);
  expect(await resolveAddressCallCount(page)).toBe(resolveCalls);
  expect(await workerBytes(page)).toEqual(guardedWorker);
  expect(await rendererProbeRgb8(page)).toEqual(guardedProbe);
  expect(page.url()).toBe(guardedUrl);
  expect(await normalizedActiveRecord(page)).toEqual(guardedRecord);

  expect(await persistCurrentActiveAddress(page)).toBe(false);
  expect(await normalizedActiveRecord(page)).toEqual(guardedRecord);
  const guardedOffset = await page.evaluate(() => window.__archive?.state.offset);
  await page.locator('#stepUp').click();
  await expect(page.locator('#toast')).toContainText('no identity');
  expect(await page.evaluate(() => window.__archive?.state.offset)).toBe(guardedOffset);
  expect(await resolveAddressCallCount(page)).toBe(resolveCalls);
  expect(await workerBytes(page)).toEqual(guardedWorker);
  expect(await normalizedActiveRecord(page)).toEqual(guardedRecord);
  await stepAddress(page, 1);
  expect(await resolveAddressCallCount(page)).toBe(resolveCalls);
  expect(await workerBytes(page)).toEqual(guardedWorker);
  expect(await normalizedActiveRecord(page)).toEqual(guardedRecord);
});
