import { readFile } from 'node:fs/promises';
import { expect, test, type Download } from '@playwright/test';
import {
  RAW_ADDRESS_BYTES,
  UIA2_HEADER_BYTES,
  activeRecordBytes,
  hex,
  rendererProbeRgb8,
  rgb8Projection,
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

function importedContainer(): Buffer {
  const container = Buffer.alloc(UIA2_HEADER_BYTES + RAW_ADDRESS_BYTES);
  container.write('UIA2', 0, 'ascii');
  container.writeUInt32BE(2, 4);
  container.writeUInt32BE(2, 8);
  container.writeUInt16BE(16, 12);
  container.writeUInt16BE(3, 14);
  container.writeUInt16BE(0, 16);
  container.writeUInt16BE(0, 18);
  Buffer.from(IMPORTED).copy(container, UIA2_HEADER_BYTES);
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
  const originalRendererProbe = await rendererProbeRgb8(page);
  expect(original).toEqual(IMPORTED);
  await waitForActiveRecord(page, original);

  // Exercise local resume rather than letting the exact-address URL carry the bytes.
  await page.evaluate(() => history.replaceState(null, '', '#g=plane&r=px2&d=d48&n=12'));
  await page.reload();
  await waitForArchiveBoot(page);

  const beforeExport = {
    worker: await workerBytes(page),
    rendererProbe: await rendererProbeRgb8(page),
    held: await serializedHeld(page),
    url: page.url(),
    persisted: await activeRecordBytes(page),
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
    url: page.url(),
    persisted: await activeRecordBytes(page),
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
    persisted: await activeRecordBytes(page),
  };

  console.info('M0 imported evidence', JSON.stringify({
    original: hex(original),
    originalHeld,
    beforeExport: {
      worker: hex(beforeExport.worker),
      rendererProbe: hex(beforeExport.rendererProbe),
      held: beforeExport.held,
      url: beforeExport.url,
      persisted: hex(beforeExport.persisted),
    },
    afterExport: {
      worker: hex(afterExport.worker),
      rendererProbe: hex(afterExport.rendererProbe),
      held: afterExport.held,
      url: afterExport.url,
      persisted: hex(afterExport.persisted),
      downloaded: hex(afterExport.downloaded),
    },
    secondReload: {
      worker: hex(secondReload.worker),
      rendererProbe: hex(secondReload.rendererProbe),
      held: secondReload.held,
      persisted: hex(secondReload.persisted),
    },
  }, null, 2));

  // Controls: the imported bytes reach the worker, renderer, and persistence exactly.
  expect(beforeExport.worker).toEqual(original);
  expect(beforeExport.persisted).toEqual(original);
  expect(beforeExport.rendererProbe).toEqual(rgb8Projection(original));
  expect(originalRendererProbe).toEqual(rgb8Projection(original));

  // Characterization: these invariants fail on the published baseline.
  expect.soft(beforeExport.held, 'reload must preserve the opaque imported identity').toEqual(originalHeld);
  expect.soft(afterExport.worker, 'export must not replace imported worker bytes').toEqual(original);
  expect.soft(afterExport.rendererProbe, 'export must not replace the imported renderer texture output').toEqual(originalRendererProbe);
  expect.soft(afterExport.downloaded, 'download must contain the imported address').toEqual(original);
  expect.soft(afterExport.persisted, 'export must not overwrite imported bytes in IndexedDB').toEqual(original);
  expect.soft(afterExport.held, 'export must not invent a generated identity for imported bytes').toEqual(originalHeld);
  expect.soft(afterExport.url, 'export must not replace the imported address URL').toBe(beforeExport.url);
  expect.soft(secondReload.worker, 'second reload must restore the imported worker bytes').toEqual(original);
  expect.soft(secondReload.rendererProbe, 'second reload must restore the imported renderer texture output').toEqual(originalRendererProbe);
  expect.soft(secondReload.persisted, 'second reload must retain the imported IndexedDB bytes').toEqual(original);
  expect.soft(secondReload.held, 'second reload must restore the opaque imported identity').toEqual(originalHeld);
});
