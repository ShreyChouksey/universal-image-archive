import { expect, test, type Page } from '@playwright/test';
import { FIXED_COORDINATE, TEST_LOCATION, waitForArchiveBoot } from './support/archive';

/**
 * Characterizes shell-panel routing: the Protocol Observatory's open state
 * and sub-view ride in the URL hash beside the address permalink, and the
 * panel is reconciled with the hash at boot, on hashchange, and on popstate.
 *
 * Scope, stated exactly: these tests use the 2 × 2 coordinate permalink
 * (`c=` + format keys). They do not exercise the large-address `a=` permalink,
 * which syncUrl abbreviates to head…tail above 4096 hex characters; that is
 * the known-open permalink-semantics item in README.md, untouched here.
 */

function hashParams(url: string): URLSearchParams {
  return new URLSearchParams(new URL(url).hash.slice(1));
}

async function panelState(page: Page): Promise<{ open: boolean; bodyOpen: string | undefined; selected: string | null }> {
  return page.evaluate(() => ({
    open: !(document.getElementById('protocolObservatory') as HTMLElement).hidden,
    bodyOpen: document.body.dataset.protocolOpen,
    selected:
      [...document.querySelectorAll<HTMLElement>('[data-protocol-view]')].find((b) => b.getAttribute('aria-selected') === 'true')
        ?.dataset.protocolView ?? null,
  }));
}

test('open state and sub-view survive reload; close removes the keys and survives reload', async ({ page }) => {
  await page.goto(TEST_LOCATION);
  await waitForArchiveBoot(page);

  const panel = page.locator('#protocolObservatory');
  await expect(panel).toBeHidden();
  expect(hashParams(page.url()).get('view')).toBeNull();

  await page.locator('#protocolOpen').click();
  await expect(panel).toBeVisible();
  let params = hashParams(page.url());
  expect(params.get('view')).toBe('protocol');
  expect(params.get('pv')).toBeNull(); // default map view is omitted
  expect(params.get('c')).toBe(FIXED_COORDINATE);
  expect(params.get('g')).toBe('plane');
  expect(params.get('r')).toBe('px2');

  await page.locator('#protocolMatrixTab').click();
  await expect(page.locator('#protocolMatrixTab')).toHaveAttribute('aria-selected', 'true');
  expect(hashParams(page.url()).get('pv')).toBe('matrix');

  await page.reload();
  await waitForArchiveBoot(page);
  await expect(panel).toBeVisible();
  expect(await panelState(page)).toEqual({ open: true, bodyOpen: 'true', selected: 'matrix' });
  params = hashParams(page.url());
  expect(params.get('view')).toBe('protocol');
  expect(params.get('pv')).toBe('matrix');
  expect(params.get('c')).toBe(FIXED_COORDINATE);
  expect(params.get('g')).toBe('plane');
  expect(params.get('r')).toBe('px2');
  expect(params.get('d')).toBe('d48');
  await expect(panel).toContainText('Protocol Observatory');
  // The evidence revision is on screen; "refresh" means this build's data.
  await expect(panel.locator('#protocolSource')).toContainText('evidence measured at');

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  params = hashParams(page.url());
  expect(params.get('view')).toBeNull();
  expect(params.get('pv')).toBeNull();
  expect(params.get('c')).toBe(FIXED_COORDINATE);

  await page.reload();
  await waitForArchiveBoot(page);
  await expect(panel).toBeHidden();
  expect(hashParams(page.url()).get('view')).toBeNull();
});

test('a protocol deep link opens the panel even when no GPU backend is available', async ({ page }) => {
  // Remove both backends before any script runs: no WebGPU adapter and a
  // canvas that refuses webgl2. createRenderer then throws and boot returns
  // early; the panel must already be open by then and the link must survive.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgpu') return null;
      return (original as (this: HTMLCanvasElement, t: string, ...r: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  await page.goto(`${TEST_LOCATION}&view=protocol&pv=decisions`);
  await expect(page.locator('#pipelineText')).toHaveText('no GPU');
  await expect(page.locator('#canvas')).not.toHaveAttribute('data-live', 'true');

  await expect(page.locator('#protocolObservatory')).toBeVisible();
  expect(await panelState(page)).toEqual({ open: true, bodyOpen: 'true', selected: 'decisions' });
  const params = hashParams(page.url());
  expect(params.get('view')).toBe('protocol');
  expect(params.get('pv')).toBe('decisions');
  expect(params.get('c')).toBe(FIXED_COORDINATE);
});

test('same-page hash edits reconcile the panel: add opens, remove closes, malformed pv normalises', async ({ page }) => {
  await page.goto(TEST_LOCATION);
  await waitForArchiveBoot(page);
  const panel = page.locator('#protocolObservatory');
  await expect(panel).toBeHidden();

  // Same-page hash edit (no reload): null deletes a key, a string sets it.
  const setHash = (changes: Record<string, string | null>) =>
    page.evaluate((entries) => {
      const p = new URLSearchParams(location.hash.slice(1));
      for (const [key, value] of Object.entries(entries)) {
        if (value === null) p.delete(key);
        else p.set(key, value);
      }
      location.hash = p.toString();
    }, changes);

  await setHash({ view: 'protocol', pv: 'matrix' });
  await expect(panel).toBeVisible();
  expect(await panelState(page)).toEqual({ open: true, bodyOpen: 'true', selected: 'matrix' });

  await setHash({ pv: 'bogus' });
  // Unknown sub-view falls back to map, and the malformed key is dropped.
  await expect.poll(async () => (await panelState(page)).selected).toBe('map');
  await expect.poll(() => hashParams(page.url()).get('pv')).toBeNull();
  expect(hashParams(page.url()).get('view')).toBe('protocol');

  await setHash({ view: null, pv: null });
  await expect(panel).toBeHidden();
  expect(await panelState(page)).toMatchObject({ open: false, bodyOpen: 'false' });
  expect(hashParams(page.url()).get('c')).toBe(FIXED_COORDINATE);
});

test('back/forward across pushed panel entries reconciles the panel via popstate', async ({ page }) => {
  await page.goto(TEST_LOCATION);
  await waitForArchiveBoot(page);
  const panel = page.locator('#protocolObservatory');

  // The app itself uses replaceState, so build two real history entries.
  await page.evaluate(() => {
    const p = new URLSearchParams(location.hash.slice(1));
    p.set('view', 'protocol');
    p.set('pv', 'decisions');
    history.pushState(null, '', `#${p.toString()}`);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(panel).toBeVisible();
  expect(await panelState(page)).toEqual({ open: true, bodyOpen: 'true', selected: 'decisions' });

  await page.goBack();
  await expect(panel).toBeHidden();
  expect(hashParams(page.url()).get('view')).toBeNull();

  await page.goForward();
  await expect(panel).toBeVisible();
  expect(await panelState(page)).toEqual({ open: true, bodyOpen: 'true', selected: 'decisions' });
  expect(hashParams(page.url()).get('pv')).toBe('decisions');
});
