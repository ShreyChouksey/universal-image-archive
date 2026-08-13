import { readFile } from 'node:fs/promises';
import { expect, test, type Download } from '@playwright/test';
import {
  RAW_ADDRESS_BYTES,
  TEST_LOCATION,
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

const EXPECTED_GENERATED_HEX = 'c96db2c925092257354f0d818edf7c9bbc43e60eda65194d';

async function addressPayload(download: Download): Promise<number[]> {
  const path = await download.path();
  if (!path) throw new Error('Browser did not expose the completed download path');
  const container = await readFile(path);
  expect(container.subarray(0, 4).toString('ascii')).toBe('UIA2');
  expect(container).toHaveLength(UIA2_HEADER_BYTES + RAW_ADDRESS_BYTES);
  return Array.from(container.subarray(UIA2_HEADER_BYTES));
}

test('restored generated address remains the same identity and export is observational', async ({ page }) => {
  await page.goto(TEST_LOCATION);
  await waitForArchiveBoot(page);
  await page.locator('#materialise').click();
  await page.waitForFunction(() => window.__archive?.state.mode === 'address');
  await expect(page.locator('#busy')).toBeHidden();

  const original = await workerBytes(page);
  const originalHeld = await serializedHeld(page);
  const originalRendererProbe = await rendererProbeRgb8(page);
  await waitForActiveRecord(page, original);
  expect(hex(original)).toBe(EXPECTED_GENERATED_HEX);

  // Exercise the persisted-record restore path, not the exact-address URL path.
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

  console.info('M0 generated evidence', JSON.stringify({
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

  // Controls: restoration initially preserves the exact bytes and renderer projection.
  expect(beforeExport.worker).toEqual(original);
  expect(beforeExport.persisted).toEqual(original);
  expect(beforeExport.rendererProbe).toEqual(rgb8Projection(original));
  expect(originalRendererProbe).toEqual(rgb8Projection(original));

  // Characterization: these invariants fail on the published baseline.
  expect.soft(beforeExport.held, 'reload must preserve the complete generated identity').toEqual(originalHeld);
  expect.soft(afterExport.worker, 'export must not replace the worker bytes').toEqual(original);
  expect.soft(afterExport.rendererProbe, 'export must not replace the renderer texture output').toEqual(originalRendererProbe);
  expect.soft(afterExport.downloaded, 'download must contain the original address').toEqual(original);
  expect.soft(afterExport.persisted, 'export must not overwrite IndexedDB').toEqual(original);
  expect.soft(afterExport.held, 'export must not replace the active identity').toEqual(originalHeld);
  expect.soft(afterExport.url, 'export must not replace the address in the URL').toBe(beforeExport.url);
  expect.soft(secondReload.worker, 'second reload must restore the original worker bytes').toEqual(original);
  expect.soft(secondReload.rendererProbe, 'second reload must restore the original renderer texture output').toEqual(originalRendererProbe);
  expect.soft(secondReload.persisted, 'second reload must retain the original IndexedDB bytes').toEqual(original);
  expect.soft(secondReload.held, 'second reload must restore the complete generated identity').toEqual(originalHeld);
});
