import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  RAW_ADDRESS_BYTES,
  TEST_LOCATION,
  UIA2_HEADER_BYTES,
  activeRecordBytes,
  serializedHeld,
  waitForActiveRecord,
  waitForArchiveBoot,
  workerBytes,
} from './support/archive';

test('browser harness reaches boot, renderer, worker, IndexedDB, and download', async ({ page }) => {
  await page.goto(TEST_LOCATION);
  await waitForArchiveBoot(page);

  const canvas = page.locator('#canvas');
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  expect(bounds?.width).toBeGreaterThan(0);
  expect(bounds?.height).toBeGreaterThan(0);

  await page.locator('#materialise').click();
  await page.waitForFunction(() => window.__archive?.state.mode === 'address');
  expect(await serializedHeld(page)).toEqual({
    kind: 'seed',
    seed: [0x00010203, 0x04050607, 0x08090a0b, 0x0c0d0e0f],
    offset: 0,
  });

  const original = await workerBytes(page);
  expect(original).toHaveLength(RAW_ADDRESS_BYTES);
  await waitForActiveRecord(page, original);
  expect(await activeRecordBytes(page)).toEqual(original);

  const downloadEvent = page.waitForEvent('download');
  await page.locator('#exportAddress').click();
  const download = await downloadEvent;
  const path = await download.path();
  if (!path) throw new Error('Browser did not expose the completed download path');
  const container = await readFile(path);

  expect(container).toHaveLength(UIA2_HEADER_BYTES + RAW_ADDRESS_BYTES);
  expect(container.subarray(0, 4).toString('ascii')).toBe('UIA2');
  expect(container.readUInt32BE(4)).toBe(2);
  expect(container.readUInt32BE(8)).toBe(2);
  expect(container.readUInt16BE(12)).toBe(16);
  expect(container.readUInt16BE(14)).toBe(3);
  expect(container.readUInt16BE(16)).toBe(0);
  expect(container.readUInt16BE(18)).toBe(0);
  expect(Array.from(container.subarray(UIA2_HEADER_BYTES))).toEqual(original);
});
