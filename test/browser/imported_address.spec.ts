import { expect, test } from '@playwright/test';

/**
 * Deliverable C: Imported Foreign Address Export Corruption Assertion
 *
 * Specification:
 *  import foreign container file -> persist -> reload -> export
 *  assert: imported_file_bytes == displayed_bytes == downloaded_uia_bytes
 *
 * Failure Mode on un-fixed app:
 *  An imported image has no coordinate seed recipe to fall back to.
 *  When state.held is lost on page reload, exportAddress() triggers resolveAddress()
 *  which materializes state.seed noise, corrupting the exported .uia container payload.
 */

test.describe('Deliverable C: Imported Foreign Address Export Corruption Assertion', () => {
  test('imported foreign address file must survive reload and export without corruption', async ({ page }) => {
    // 1. Initial application boot at 2x2 resolution (#r=px2)
    await page.goto('/#r=px2');
    await page.waitForSelector('canvas[data-live="true"]', { timeout: 15000 });
    await page.waitForTimeout(300);

    // 2. Build a valid 2x2 .uia address container file (UIA2 container format)
    // Header (16 bytes):
    // [0..3]: 0x55494132 ("UIA2")
    // [4..7]: width (2)
    // [8..11]: height (2)
    // [12..13]: bpc (16)
    // [14]: channels (3)
    // [15]: geometry (0 = plane)
    // Payload (24 bytes): 4 pixels * 6 bytes
    const uiaHeader = new Uint8Array(16);
    const dv = new DataView(uiaHeader.buffer);
    dv.setUint32(0, 0x55494132, false); // "UIA2"
    dv.setUint32(4, 2, false); // width 2
    dv.setUint32(8, 2, false); // height 2
    dv.setUint16(12, 16, false); // 16 bpc
    dv.setUint8(14, 3); // 3 channels (RGB)
    dv.setUint8(15, 0); // plane geometry

    const foreignPayloadBytes = new Uint8Array([
      0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54,
      0x32, 0x10, 0x0f, 0x1e, 0x2d, 0x3c,
      0x4b, 0x5a, 0x69, 0x78, 0x87, 0x96,
      0xa5, 0xb4, 0xc3, 0xd2, 0xe1, 0xf0,
    ]);

    const uiaFileBytes = new Uint8Array(16 + 24);
    uiaFileBytes.set(uiaHeader, 0);
    uiaFileBytes.set(foreignPayloadBytes, 16);

    const importedPayloadHex = Array.from(foreignPayloadBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // 3. Upload foreign .uia container file via hidden fileInput
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles({
      name: 'foreign_test.uia',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(uiaFileBytes),
    });

    await page.waitForTimeout(500);

    // 4. Reload page context
    await page.reload();
    await page.waitForSelector('canvas[data-live="true"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    // 5. Export binary address (.uia)
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.evaluate(() => {
      const btn = document.getElementById('exportAddress') as HTMLButtonElement | null;
      if (btn) btn.click();
    });
    const download = await downloadPromise;

    // Read downloaded .uia payload
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const downloadedBuffer = Buffer.concat(chunks);

    let downloadedPayloadHex = '';
    if (downloadedBuffer.length >= 16 + 24) {
      const payloadBytes = downloadedBuffer.subarray(16, 16 + 24);
      downloadedPayloadHex = Array.from(payloadBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } else {
      downloadedPayloadHex = downloadedBuffer.toString('hex');
    }

    console.info(`[Imported Test] Imported Foreign Payload Hex: ${importedPayloadHex}`);
    console.info(`[Imported Test] Downloaded Export Payload Hex:  ${downloadedPayloadHex}`);

    // STRICT ASSERTION:
    // Downloaded export bytes MUST match the imported foreign image payload bytes
    expect(downloadedPayloadHex).toBe(importedPayloadHex);
  });
});
