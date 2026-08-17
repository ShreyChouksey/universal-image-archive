import { expect, test, type Page } from '@playwright/test';
import { FIXED_COORDINATE, TEST_LOCATION, waitForArchiveBoot } from './support/archive';

/**
 * Adversarial characterization (M3a): Protocol routing must be surgical.
 * Changing or reconciling `view` / `pv` may alter no archive identity key
 * (`c`, `a`, `g`, `r`, `d`, `n`, `o`), no unknown parameter, and no
 * `history.state` — under normal, malformed, no-GPU, and history paths.
 *
 * The three writers this pins down:
 *   URL  → panel : silent reconciliation (never writes the URL beyond view/pv)
 *   panel → URL  : route-only writer (edits view/pv, preserves everything else)
 *   archive → URL: the full permalink writer (syncUrl), unchanged here
 */

const OTHER_COORDINATE = 'f0e0d0c0b0a090807060504030201000';

function hashParams(url: string): URLSearchParams {
  return new URLSearchParams(new URL(url).hash.slice(1));
}

async function panelOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => !(document.getElementById('protocolObservatory') as HTMLElement).hidden);
}

async function selectedView(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('[data-protocol-view]')].find((b) => b.getAttribute('aria-selected') === 'true')
        ?.dataset.protocolView ?? null,
  );
}

/** Raw hash segments minus the route keys — byte-for-byte, no re-serialisation. */
const rawWithoutRoute = (url: string): string =>
  new URL(url).hash
    .slice(1)
    .split('&')
    .filter((seg) => seg !== '' && !/^(view|pv)(=|$)/.test(seg))
    .join('&');

test('in-page navigation to a different coordinate with view=protocol keeps that coordinate and unknown params', async ({ page }) => {
  await page.goto(TEST_LOCATION);
  await waitForArchiveBoot(page);
  expect(hashParams(page.url()).get('c')).toBe(FIXED_COORDINATE);

  // A user (or a link) changes the whole hash in-page: new coordinate, an
  // unknown parameter, and a request to open the panel.
  await page.evaluate((c) => {
    location.hash = `c=${c}&g=plane&r=px2&d=d48&n=12&x=keep&view=protocol`;
  }, OTHER_COORDINATE);
  await expect.poll(() => panelOpen(page)).toBe(true);

  const params = hashParams(page.url());
  expect(params.get('c')).toBe(OTHER_COORDINATE); // must not be rewritten to the archive's in-memory seed
  expect(params.get('x')).toBe('keep'); // unknown parameters survive
  expect(params.get('view')).toBe('protocol');
  expect(params.get('n')).toBe('12');
});

test('opening and closing the panel edits only view/pv and preserves history.state and unknown params', async ({ page }) => {
  await page.goto(TEST_LOCATION);
  await waitForArchiveBoot(page);
  // Add unknown params and a history.state AFTER boot. The archive's own full
  // permalink writer (syncUrl) rebuilds the hash from archive state on
  // archive changes and does not carry unknown keys — pre-existing behaviour
  // at ad60742, out of scope here. This test isolates the panel → URL writer:
  // from this point on, only clicks on the panel touch the URL.
  // Deliberately non-canonical byte forms: a percent-encoded slash and space,
  // a bare flag with no '=', a duplicate unknown key. A writer that
  // round-trips through URLSearchParams would re-serialise these.
  const RAW_EXTRA = 'x=a%2Fb~c%20d&flag&zz=1&zz=2';
  await page.evaluate((extra) => {
    history.replaceState({ marker: 42 }, '', `#${location.hash.slice(1)}&${extra}`);
  }, RAW_EXTRA);

  const beforeRaw = rawWithoutRoute(page.url());
  expect(beforeRaw).toContain(RAW_EXTRA);
  await page.locator('#protocolOpen').click();
  await expect(page.locator('#protocolObservatory')).toBeVisible();
  expect(rawWithoutRoute(page.url())).toBe(beforeRaw); // byte-identical apart from view/pv
  let after = hashParams(page.url());
  expect(after.get('view')).toBe('protocol');
  expect(after.get('x')).toBe('a/b~c d');
  expect(after.getAll('zz')).toEqual(['1', '2']);
  expect(await page.evaluate(() => history.state)).toEqual({ marker: 42 });

  await page.locator('#protocolMatrixTab').click();
  expect(rawWithoutRoute(page.url())).toBe(beforeRaw);
  after = hashParams(page.url());
  expect(after.get('pv')).toBe('matrix');
  expect(await page.evaluate(() => history.state)).toEqual({ marker: 42 });

  await page.keyboard.press('Escape');
  await expect(page.locator('#protocolObservatory')).toBeHidden();
  expect(rawWithoutRoute(page.url())).toBe(beforeRaw);
  after = hashParams(page.url());
  expect(after.get('view')).toBeNull();
  expect(after.get('pv')).toBeNull();
  expect(await page.evaluate(() => history.state)).toEqual({ marker: 42 });
});

test('no-GPU boot with a malformed pv shows Map and normalises only the pv key', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgpu') return null;
      return (original as (this: HTMLCanvasElement, t: string, ...r: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  await page.goto(`${TEST_LOCATION}&x=keep&view=protocol&pv=bogus`);
  await expect(page.locator('#pipelineText')).toHaveText('no GPU');
  await expect(page.locator('#protocolObservatory')).toBeVisible();
  expect(await selectedView(page)).toBe('map');

  await expect.poll(() => hashParams(page.url()).get('pv')).toBeNull(); // malformed key dropped
  const params = hashParams(page.url());
  expect(params.get('view')).toBe('protocol');
  expect(params.get('c')).toBe(FIXED_COORDINATE); // untouched even though boot never reached syncUrl
  expect(params.get('x')).toBe('keep');
  expect(params.get('n')).toBe('12');
});

test('clicking Protocol creates no browser history entry (routing uses replaceState by decision)', async ({ page }) => {
  await page.goto(TEST_LOCATION);
  await waitForArchiveBoot(page);
  const lengthBefore = await page.evaluate(() => history.length);

  await page.locator('#protocolOpen').click();
  await expect(page.locator('#protocolObservatory')).toBeVisible();
  await page.locator('#protocolDecisionsTab').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#protocolObservatory')).toBeHidden();

  expect(await page.evaluate(() => history.length)).toBe(lengthBefore);
  // Real user flow: with no entry pushed, Back does not act on the panel; the
  // panel is a URL-restorable view, not a navigation step. Documented in
  // test/browser/README.md and docs/protocol/CORRECTIONS.md (M3).
});
