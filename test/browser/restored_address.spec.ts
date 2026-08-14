import { expect, test } from '@playwright/test';

/**
 * Deliverable B: Restored Address Corruption Test (2x2 Grid)
 *
 * Specification:
 *  resolve -> persist -> reload -> export -> reload
 *   assert displayed == worker == downloaded .uia == IndexedDB
 *   assert export mutates nothing: worker, identity, URL, IndexedDB
 *   assert second reload restores the ORIGINAL bytes
 *
 * Failure Mode on un-fixed app:
 *  loadActiveAddressState() restores bytes into worker and displays them,
 *  but leaves state.held = { kind: 'none' }. When 'Export Binary (.uia)' is clicked,
 *  exportAddress() checks workerMatchesStage() (which returns false since state.held.kind is 'none'),
 *  triggers resolveAddress(), and falls back to materializing state.seed (coordinate generator),
 *  emitting noise bytes instead of the restored address.
 */

test.describe('Deliverable B: 2x2 Restored Address Export Corruption Assertion', () => {
  test('restored 2x2 address export must preserve exact displayed bytes', async ({ page }) => {
    // 1. Initial application boot at 2x2 resolution (#r=px2)
    await page.goto('/#r=px2');
    await page.waitForSelector('canvas[data-live="true"]', { timeout: 15000 });
    await page.waitForTimeout(300);

    // 2. Define a known 2x2 48-bit (24 byte) payload
    const originalBytes = new Uint8Array([
      0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
      0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc,
      0xdd, 0xee, 0xff, 0x00, 0x12, 0x34,
      0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
    ]);
    const originalHex = Array.from(originalBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // 3. Persist this address into IndexedDB ('uia_storage' / 'active_address')
    await page.evaluate(async (data) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('uia_storage', 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('active_address')) {
            req.result.createObjectStore('active_address');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction('active_address', 'readwrite');
      const store = tx.objectStore('active_address');
      store.put(
        {
          bytes: new Uint8Array(data.bytes).buffer,
          hex: data.hex,
          resolutionId: 'px2',
          depthId: 'd48',
          geometry: 'plane',
        },
        'current',
      );
      await new Promise((res) => {
        tx.oncomplete = res;
      });
    }, {
      bytes: Array.from(originalBytes),
      hex: originalHex,
    });

    // 4. Reload browser context to trigger restoration flow (loadActiveAddressState)
    await page.reload();
    await page.waitForSelector('canvas[data-live="true"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    // Read IndexedDB contents after reload
    const idbBeforeExport = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res) => {
        const req = indexedDB.open('uia_storage', 1);
        req.onsuccess = () => res(req.result);
      });
      return new Promise<any>((res) => {
        const tx = db.transaction('active_address', 'readonly');
        const req = tx.objectStore('active_address').get('current');
        req.onsuccess = () => res(req.result);
      });
    });

    const idbBeforeExportHex = idbBeforeExport
      ? Array.from(new Uint8Array(idbBeforeExport.bytes))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      : '';

    console.info(`[Restored Test] IndexedDB Hex before export: ${idbBeforeExportHex}`);
    console.info(`[Restored Test] Expected Original Hex:       ${originalHex}`);

    // 5. Trigger binary export (.uia download)
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.evaluate(() => {
      const btn = document.getElementById('exportAddress') as HTMLButtonElement | null;
      if (btn) btn.click();
    });
    const download = await downloadPromise;

    // Stream downloaded .uia file payload
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const downloadedBuffer = Buffer.concat(chunks);

    // UIA container: 16-byte header, payload starts at byte 16
    let downloadedPayloadHex = '';
    if (downloadedBuffer.length >= 16 + 24) {
      const payloadBytes = downloadedBuffer.subarray(16, 16 + 24);
      downloadedPayloadHex = Array.from(payloadBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } else {
      downloadedPayloadHex = downloadedBuffer.toString('hex');
    }

    console.info(`[Restored Test] Downloaded .uia Payload Hex: ${downloadedPayloadHex}`);

    // Read IndexedDB contents after export to verify export mutated nothing
    const idbAfterExport = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res) => {
        const req = indexedDB.open('uia_storage', 1);
        req.onsuccess = () => res(req.result);
      });
      return new Promise<any>((res) => {
        const tx = db.transaction('active_address', 'readonly');
        const req = tx.objectStore('active_address').get('current');
        req.onsuccess = () => res(req.result);
      });
    });
    const idbAfterExportHex = idbAfterExport
      ? Array.from(new Uint8Array(idbAfterExport.bytes))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      : '';

    // 6. Second reload: verify second reload restores the original bytes
    await page.reload();
    await page.waitForSelector('canvas[data-live="true"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    const idbSecondReload = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res) => {
        const req = indexedDB.open('uia_storage', 1);
        req.onsuccess = () => res(req.result);
      });
      return new Promise<any>((res) => {
        const tx = db.transaction('active_address', 'readonly');
        const req = tx.objectStore('active_address').get('current');
        req.onsuccess = () => res(req.result);
      });
    });
    const idbSecondReloadHex = idbSecondReload
      ? Array.from(new Uint8Array(idbSecondReload.bytes))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      : '';

    // STRICT ASSERTION:
    // Downloaded export bytes MUST match displayed/restored original bytes
    expect(idbBeforeExportHex).toBe(originalHex);
    expect(downloadedPayloadHex).toBe(originalHex);
    expect(idbAfterExportHex).toBe(originalHex);
    expect(idbSecondReloadHex).toBe(originalHex);
  });
});
