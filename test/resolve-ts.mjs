/**
 * Lets Node resolve the source's extensionless relative imports.
 *
 * The product code is written for a bundler, where `from './format'` is normal.
 * Node's ESM resolver requires the extension. Rather than litter the source with
 * `.ts` suffixes to suit the test runner, this hook does the same lookup a
 * bundler would — which keeps the tests running against exactly the code that
 * ships, with no build step in between.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CANDIDATES = ['.ts', '.js', '/index.ts', '/index.js'];

export function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  const hasExtension = /\.[cm]?[jt]s$/.test(specifier);

  if (relative && !hasExtension && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    for (const ext of CANDIDATES) {
      const candidate = new URL(base.href + ext);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
