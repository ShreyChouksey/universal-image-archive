# Browser characterization gate

This suite records and permanently guards the address-identity failure first
captured by M0, and characterizes shell routing added after M2. It runs in a
real Chromium browser against the Vite development build and crosses the
actual worker, renderer texture/offscreen probe, IndexedDB, reload, history,
and download boundaries.

Current suite: 11 tests in 5 spec files (`harness`, `restored-generated-address`,
`restored-imported-address`, `protocol-panel-restore`, `protocol-route-isolation`). Historical records
that say "three tests" or "3/3" describe the M1 (`18fabae`) and M2 (`ad60742`)
trees, which had the first three specs only; they remain correct for those
revisions and are not restated.

## Install and run

```sh
npm ci
npx playwright install chromium
npm run typecheck:browser
npm run test:browser:harness
npm run test:browser
```

`test:browser:harness` and the full suite must pass. Commit `2830091`
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

### Protocol panel routing (`protocol-panel-restore.spec.ts`)

Four tests characterize the Protocol Observatory's URL routing: `view=protocol`
and `pv=<map|matrix|decisions>` in the hash beside the address permalink.
Covered: reload restores open state and sub-view, Escape removes the keys and
the closed state survives reload; a deep link opens the panel when neither
WebGPU nor WebGL2 is available (both backends removed with an init script, so
`createRenderer` throws and boot returns early); same-page hash add/remove
reconciles the panel and a malformed `pv` falls back to map and is dropped
from the URL; Back/Forward across pushed entries reconciles through
`popstate`.

Scope stated exactly: these tests use the 2 × 2 coordinate permalink (`c=` and
format keys). They do not exercise the large-address `a=` permalink, which
`syncUrl` abbreviates to head…tail above 4096 hex characters. That remains the
known-open permalink-semantics item above. The Observatory's data is compiled
into the build (`src/core/protocolProgress.ts`); "refresh" shows the served
build's data and `#protocolSource` names the evidence revision on screen. There
is no live repository channel.

### Protocol route isolation (`protocol-route-isolation.spec.ts`)

Four adversarial tests pin the three-writer separation in `src/main.ts`:
URL → panel is silent reconciliation; panel → URL (`syncProtocolRoute`) edits
only `view`/`pv` and preserves every other key, unknown parameters, and
`history.state`; archive → URL (`syncUrl`) is the full permalink writer and is
never triggered by the panel. Covered: in-page navigation to a different
coordinate with `view=protocol` keeps that coordinate and an unknown parameter;
open, sub-view change, and Escape alter only `view`/`pv`; no-GPU boot with a
malformed `pv` shows Map and drops only `pv`; clicking Protocol pushes no
history entry. These were red before the route-only writer existed (recorded in
`docs/protocol/CORRECTIONS.md`, M3a).

History decision: Protocol clicks use `replaceState` and create no history
entry, so Back does not close the panel — it leaves the archive as before. The
panel is a URL-restorable view, not a navigation step. `popstate`
reconciliation is tested with pushed entries. Pre-existing and unchanged:
`syncUrl` rebuilds the hash from archive state on archive changes and does not
carry unknown keys.

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

## Retired duplicate specs

Two AG-authored duplicates of these characterizations
(`imported_address.spec.ts`, `restored_address.spec.ts`) were run once red on
the pre-retirement merge tree and removed in merge `b52d96d`; their sources
remain at `4e63490` (`git show 4e63490:test/browser/<name>`). Their failures
came from a 16-byte header fixture against the 20-byte UIA2 header and from an
IndexedDB read before export, not from the assertions above. Disposition
(restore as `test.fixme` or ratify retirement) is recorded in
`docs/protocol/CORRECTIONS.md`.
