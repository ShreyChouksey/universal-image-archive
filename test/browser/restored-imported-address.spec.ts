import { readFile } from 'node:fs/promises';
import { expect, test, type Download } from '@playwright/test';
import {
  RAW_ADDRESS_BYTES,
  UIA2_HEADER_BYTES,
  activeRecordBytes,
  failNextTextureRead,
  hex,
  installLegacyRecord,
  normalizedActiveRecord,
  rendererProbeRgb8,
  resolveAddressCallCount,
  rgb8Projection,
  serializedActiveAddress,
  serializedHeld,
  waitForActiveRecord,
  waitForArchiveBoot,
  workerBytes,
} from './support/archive';

const IMPORTED = [
  0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54,
  0x32, 0x10, 0x0f, 0x1e, 0x2d, 0x3c,
  0x4b, 0x5a, 0x69, 0x78, 0x87, 0x96,
  0xa5, 0xb4, 0xc3, 0xd2, 0xe1, 0xf0,
];
const REPLACEMENT = IMPORTED.map((byte, index) => (index === 0 ? byte ^ 0xff : byte));

function importedContainer(payload: number[] = IMPORTED): Buffer {
  const container = Buffer.alloc(UIA2_HEADER_BYTES + RAW_ADDRESS_BYTES);
  container.write('UIA2', 0, 'ascii');
  container.writeUInt32BE(2, 4);
  container.writeUInt32BE(2, 8);
  container.writeUInt16BE(16, 12);
  container.writeUInt16BE(3, 14);
  container.writeUInt16BE(0, 16);
  container.writeUInt16BE(0, 18);
  Buffer.from(payload).copy(container, UIA2_HEADER_BYTES);
  return container;
}

async function addressPayload(download: Download): Promise<number[]> {
  const path = await download.path();
  if (!path) throw new Error('Browser did not expose the completed download path');
  const container = await readFile(path);
  expect(container.subarray(0, 4).toString('ascii')).toBe('UIA2');
  expect(container).toHaveLength(UIA2_HEADER_BYTES + RAW_ADDRESS_BYTES);
  return Array.from(container.subarray(UIA2_HEADER_BYTES));
}

test('restored imported address survives reload and export without substitution', async ({ page }) => {
  await page.goto('/?backend=webgl2#g=plane&r=px2&d=d48&n=12');
  await waitForArchiveBoot(page);
  await page.locator('#fileInput').setInputFiles({
    name: 'm0-imported.uia',
    mimeType: 'application/octet-stream',
    buffer: importedContainer(),
  });
  await page.waitForFunction(() =>
    window.__archive?.state.mode === 'address' && window.__archive.state.held.kind === 'foreign');
  await expect(page.locator('#busy')).toBeHidden();

  const original = await workerBytes(page);
  const originalHeld = await serializedHeld(page);
  const originalActive = await serializedActiveAddress(page);
  const originalRendererProbe = await rendererProbeRgb8(page);
  expect(original).toEqual(IMPORTED);
  await waitForActiveRecord(page, original);
  const originalRecord = await normalizedActiveRecord(page);
  expect(originalActive).toMatchObject({
    kind: 'opaque',
    source: 'file',
    label: 'm0-imported.uia',
  });

  // Exercise local resume rather than letting the exact-address URL carry the bytes.
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

  console.info('imported address-identity evidence', JSON.stringify({
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

  // Controls: the imported bytes reach the worker, renderer, and persistence exactly.
  expect(beforeExport.worker).toEqual(original);
  expect(beforeExport.persisted).toEqual(original);
  expect(beforeExport.record).toEqual(originalRecord);
  expect(beforeExport.rendererProbe).toEqual(rgb8Projection(original));
  expect(originalRendererProbe).toEqual(rgb8Projection(original));

  // Characterization: these invariants fail on the published baseline.
  expect.soft(beforeExport.held, 'reload must preserve the opaque imported identity').toEqual(originalHeld);
  expect.soft(beforeExport.active, 'reload must preserve imported provenance').toEqual(originalActive);
  expect.soft(afterExport.worker, 'export must not replace imported worker bytes').toEqual(original);
  expect.soft(afterExport.rendererProbe, 'export must not replace the imported renderer texture output').toEqual(originalRendererProbe);
  expect.soft(afterExport.downloaded, 'download must contain the imported address').toEqual(original);
  expect.soft(afterExport.persisted, 'export must not overwrite imported bytes in IndexedDB').toEqual(original);
  expect.soft(afterExport.record, 'export must not rewrite imported snapshot metadata').toEqual(originalRecord);
  expect.soft(afterExport.held, 'export must not invent a generated identity for imported bytes').toEqual(originalHeld);
  expect.soft(afterExport.active, 'export must not replace imported provenance').toEqual(originalActive);
  expect.soft(afterExport.url, 'export must not replace the imported address URL').toBe(beforeExport.url);
  expect.soft(secondReload.worker, 'second reload must restore the imported worker bytes').toEqual(original);
  expect.soft(secondReload.rendererProbe, 'second reload must restore the imported renderer texture output').toEqual(originalRendererProbe);
  expect.soft(secondReload.persisted, 'second reload must retain the imported IndexedDB bytes').toEqual(original);
  expect.soft(secondReload.record, 'second reload must retain the complete imported snapshot').toEqual(originalRecord);
  expect.soft(secondReload.held, 'second reload must restore the opaque imported identity').toEqual(originalHeld);
  expect.soft(secondReload.active, 'second reload must restore imported provenance').toEqual(originalActive);

  // A pre-M1 record has exact bytes but no honest source history. It restores
  // as session-only legacy-unknown and is never rewritten into a v1 claim.
  await installLegacyRecord(page, IMPORTED);
  const legacyRecord = await normalizedActiveRecord(page);
  await page.evaluate(() => history.replaceState(null, '', '#g=plane&r=px2&d=d48&n=12'));
  await page.reload();
  await waitForArchiveBoot(page);
  expect(await workerBytes(page)).toEqual(IMPORTED);
  expect(await rendererProbeRgb8(page)).toEqual(rgb8Projection(IMPORTED));
  expect(await serializedActiveAddress(page)).toMatchObject({
    kind: 'opaque',
    source: 'legacy-unknown',
    label: 'legacy restored address',
    returnSeed: null,
  });
  expect(await serializedHeld(page)).toMatchObject({
    kind: 'foreign',
    label: 'legacy restored address',
    origin: null,
  });
  expect(await normalizedActiveRecord(page)).toEqual(legacyRecord);

  const legacyResolveCalls = await resolveAddressCallCount(page);
  const legacyDownloadEvent = page.waitForEvent('download');
  await page.locator('#exportAddress').click();
  expect(await addressPayload(await legacyDownloadEvent)).toEqual(IMPORTED);
  expect(await resolveAddressCallCount(page)).toBe(legacyResolveCalls);
  expect(await workerBytes(page)).toEqual(IMPORTED);
  expect(await normalizedActiveRecord(page)).toEqual(legacyRecord);

  // An ordinary reload after legacy export must remain legacy-unknown. The app
  // must not launder its own URL into a new exact-link provenance claim.
  await page.reload();
  await waitForArchiveBoot(page);
  expect(await workerBytes(page)).toEqual(IMPORTED);
  expect(await serializedActiveAddress(page)).toMatchObject({
    kind: 'opaque',
    source: 'legacy-unknown',
    returnSeed: null,
  });
  expect(await normalizedActiveRecord(page)).toEqual(legacyRecord);

  // If a producer replaces the worker but a later texture/readback step fails,
  // the old identity must already be invalid. New bytes may remain in the
  // worker, but they cannot be exported or stepped under stale provenance.
  await failNextTextureRead(page);
  await page.locator('#fileInput').setInputFiles({
    name: 'post-producer-failure.uia',
    mimeType: 'application/octet-stream',
    buffer: importedContainer(REPLACEMENT),
  });
  await expect(page.locator('#busy')).toBeHidden();
  expect(await workerBytes(page)).toEqual(REPLACEMENT);
  expect(await serializedActiveAddress(page)).toBeNull();
  expect(await page.evaluate(() => window.__archive?.state.mode)).toBe('address');
  expect(await normalizedActiveRecord(page)).toEqual(legacyRecord);

  const failedTransitionResolveCalls = await resolveAddressCallCount(page);
  let failedTransitionDownloads = 0;
  page.on('download', () => failedTransitionDownloads++);
  await page.locator('#exportAddress').click();
  await expect(page.locator('#toast')).toContainText('no identity');
  await page.waitForTimeout(100);
  expect(failedTransitionDownloads).toBe(0);
  expect(await resolveAddressCallCount(page)).toBe(failedTransitionResolveCalls);
  expect(await workerBytes(page)).toEqual(REPLACEMENT);
  expect(await normalizedActiveRecord(page)).toEqual(legacyRecord);
});
