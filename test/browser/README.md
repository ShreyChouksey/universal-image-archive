# Address-identity browser regression gate

This suite records and permanently guards the address-identity failure first
captured by M0. It runs in a real Chromium browser against the Vite development
build and crosses the actual worker, renderer texture/offscreen probe,
IndexedDB, reload, and download boundaries.

## Install and run

```sh
npm ci
npx playwright install chromium
npm run typecheck:browser
npm run test:browser:harness
npm run test:browser
```

`test:browser:harness` and the full three-test suite must pass. Commit `2830091`
preserves the red M0 characterization against baseline `7af2394`; the M1 tip
turns those same byte-identity assertions green and adds the adversarial cases
described below.

## Fixed cases

### Generated address

- Coordinate: `000102030405060708090a0b0c0d0e0f`
- Format: plane, 2×2, RGB16, 14 rounds, offset +7
- Exact 24-byte address:
  `b7ba761936097b1d3078effdbe54a0c3aa0a336c6849f3ef`

The test materialises and persists the address, removes URL-carried identity,
reloads from IndexedDB, exports UIA2, and reloads again. It requires the exact
bytes, generator/version, seed, rounds, signed total offset, renderer output,
URL and complete IndexedDB snapshot to remain unchanged. It also proves that a
full exact-address link gets its own opaque identity, a pending visual offset is
refused rather than silently committed by export, and an address whose runtime
identity is missing cannot reach materialisation, persistence, or stepping.

### Imported address

- Format: plane, 2×2, RGB16
- Exact 24-byte UIA2 payload:
  `fedcba98765432100f1e2d3c4b5a69788796a5b4c3d2e1f0`

The test imports a valid 44-byte UIA2 file, persists it, removes URL-carried
identity, reloads from IndexedDB, exports, and reloads again. It requires the
exact bytes plus the opaque source, label and return coordinate to survive.
It then injects a genuine pre-M1 record and proves that its bytes are restored
as runtime `legacy-unknown`, exported observationally, and never rewritten as
invented provenance.

Every run prints the original and resulting worker, renderer, download, URL,
identity, and IndexedDB evidence as hex/JSON. On baseline M0, the substituted
bytes vary because the hidden boot seed is random; on M1, all surfaces remain
equal to the fixed original values.

## What the tests prove—and do not prove

The harness proves that automation reaches live app boot, the renderer, real
Worker RPC, real IndexedDB transaction completion, and a real browser download
with an exact UIA2 header and payload. The two lifecycle tests add reload,
provenance, fail-closed, and byte-for-byte non-mutation assertions. The
visual oracle is an offscreen readback through the real WebGL2 address texture
and shader pipeline; it is deliberately not described as a canvas screenshot.

This suite does not make malformed/ambiguous permalink precedence safe, define
head-step semantics, define rounds changes for opaque addresses, serialize all
IndexedDB delete/save races, add worker revision tokens, or validate crypto,
P2P, protocol ADRs, and unrelated experimental modules.

## Files in this evidence slice

- `playwright.config.ts`
- `tsconfig.browser.json`
- `.github/workflows/browser-characterization.yml`
- `test/browser/support/archive.ts`
- `test/browser/harness.spec.ts`
- `test/browser/restored-generated-address.spec.ts`
- `test/browser/restored-imported-address.spec.ts`
- `test/browser/README.md`
- `src/core/activeAddressSnapshot.ts`
- the bounded address-identity lifecycle changes in `src/main.ts`
- package scripts/dependency lock and generated-report ignore rules
