# Math & Engine Core Invariants Rule

This rule specifies the mandatory mathematical invariants for all past and future developments in the Universal Image Archive codebase.

## 1. WebGPU / CPU Self-Check Probe Bounds (`src/main.ts`)
- When running `runSelfChecks()`, the probe loop checks GPU-rendered pixels against `sampleSeed()`.
- **Invariant**: On small image grid resolutions (where `width < PROBE` or `height < PROBE`, e.g., `2 × 2`, `4 × 4`, `8 × 8`), `runSelfChecks()` MUST skip out-of-bound iterations (`if (x >= width) continue; if (y >= height) continue;`).
- **Rationale**: Sampling `y * width + x` out of bounds causes CPU `sampleSeed()` to evaluate invalid pixel indices while GPU clamps UV coordinates, triggering false `"Renderer disagrees with the address generator"` error toasts.

## 2. Bench Dropdown Select Control Synchronization (`src/main.ts`)
- Whenever `state.format` is modified programmatically (such as format auto-fix, permalink loading, or PNG drop), `applyFormat()` MUST immediately synchronize the `.value` DOM properties of the bench dropdown selects (`<select id="resolution">`, `<select id="depth">`, `<select id="geometry">`).
- **Rationale**: If the DOM `<select>` retains an outdated value, selecting the current resolution in the dropdown will not fire a `change` event because the browser registers `newValue === oldValue`.

## 3. BigInt & High-Precision Delta Arithmetic (`src/core/offset.ts`, `src/core/philox.ts`)
- All address offset and seed addition functions (`applyOffsetToTail`, `tailPatch`, `seedTailBytes`, `seedAdd`) MUST accept both `number` and `bigint` inputs.
- **Invariant**: Deltas exceeding $2^{53} - 1$ (`Number.MAX_SAFE_INTEGER`) MUST be evaluated through BigInt arithmetic (`typeof offset === 'bigint' ? offset : BigInt(Math.trunc(offset))`) rather than JS floating-point numbers.
- **Rationale**: JavaScript IEEE 754 double floats lose integer precision above $2^{53} - 1$, causing low-order bit corruptions in 128-bit seed additions or tail patches.

## 4. Stage Fit Readout & Relative Zoom Tolerance (`src/ui/stage.ts`)
- The stage `fitZoom` check in `updateReadouts()` MUST use relative tolerance `this.#atFit` (`Math.abs(view.zoom - fitZoom) < fitZoom * 1e-3`) rather than a fixed absolute threshold (`1e-6`).
- **Rationale**: Ultra-high-resolution grids (8K/16K UHD) have small `fitZoom` ratios where absolute floating-point differences exceed `1e-6`, causing the status bar to display raw percentage numbers instead of `fit · X%`.

## 5. Plate Minting & Verification Requirements (`src/core/plate.ts`)
- Plate minting and self-checks REQUIRE **4K UHD (3840×2160)** resolution at **48-bit depth**.
- `plateSupported(format)` MUST check both `format.resolution.id === 'uhd4k'` and `format.depth.bpc === 16`.
