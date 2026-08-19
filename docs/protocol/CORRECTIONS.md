# Measured Corrections and Known-Open Claims

- **Status:** Evidence ledger; not an ADR and not a protocol-security result
- **Checkpoint date:** 2026-08-14
- **Protocol effect:** None. No gate, decision, primitive, or implementation is
  advanced by this document.
- **Project status:** paused and sealed by the founder on 2026-08-19 (see the
  sealing entry at the end of this file). The ledger is complete to that date.

This file preserves corrections that cannot be expressed safely by rewriting
published history. `SHIPS` means the affected source is in `src/main.ts`'s
transitive application import closure. `QUARANTINED` means it is outside that
closure, including research modules and tests. Neither marker means secure.

The current Protocol Observatory is a manually maintained evidence index. Its
structural validator checks model shape and references; it does not inspect the
truth of citations or derive status badges from test results.

## Published commit-message corrections

| Commit | Published claim | Measured reality | Status | Boundary |
|---|---|---|---|---|
| `89a51ce` | “Philox96x32 ARX-Feistel cipher” | The custom 96-word generator is not a specified, reviewed cipher or proven permutation. | known-open | QUARANTINED |
| `8f74ed2` | “ZK-Plates” and “WebRTC P2P Mesh” | `zkPlate` is a seeded rolling-checksum demo, not zero knowledge. `p2pMesh` instantiates WebRTC objects but lacks a complete signaling, request-serving, framing, authentication, and backpressure protocol. | known-open | SHIPS |
| `6ba6d80` | “memory-bound ASIC-resistant mining” | The bespoke mining experiment has no independent cryptanalysis or demonstrated memory-hardness/ASIC-resistance result. | known-open | QUARANTINED |
| `49f0c75` | “full cross-word ... diffusion” | Default-round counter influence is incomplete; the claim is not established by the implementation or tests. | known-open | QUARANTINED |
| `55f9c8f` | “full 3072-bit uncompressed vector sparsity engine” | The function compresses a larger scratchpad to 384 output bytes; output width is not entropy preservation or a security proof. | known-open | QUARANTINED |
| `a4ccfb3` | “post-quantum signatures & ZK state tree” | No standardized signature scheme or zero-knowledge state tree exists; the ledger uses compatibility fingerprints and an injected authorizer boundary. | known-open | QUARANTINED |
| `0ccb40a` | “zero-knowledge STARK proof generator & verifier” | The module states it is not a STARK or public proof, and its public compatibility verifier rejects. | known-open | QUARANTINED |
| `7af2394` | “WebRTC P2P block & transaction broadcast mesh relay” | `p2pBroadcast3072` is a transport-agnostic callback relay and contains no WebRTC transport. | known-open | QUARANTINED |

These corrections are also eligible for Git notes. At M2 closeout, local notes
exist on `89a51ce` and `8f74ed2`; the tracked table above is the authoritative
correction record for all eight commits. Absence of a local note on another row
does not reinstate its published claim. Notes remain local unless
`refs/notes/commits` is explicitly published; this checkpoint pushes neither
the branch nor notes.

## Source and behavior corrections

| Location | Former or current claim | Measured reality | Remedy | Boundary |
|---|---|---|---|---|
| `src/core/zkPlate.ts` (`computeCommitmentHash`, mint/verify comments) | “SHA-256 style 256-bit,” zero-knowledge, Schnorr/Feistel, mathematical consistency | Four 32-bit rolling lanes yield a bespoke 128-bit checksum. `r0/r1` are not verified; a supplied seed only permits checksum recomputation. | fixed comments; behavior remains experimental | SHIPS |
| `src/core/zkPlate.ts` (`proof.verified`) | `verified: true` could be read as a verifier result | It is a legacy demo flag and is not trusted by `verifyZkPlateClaim`. | fixed adjacent comment | SHIPS |
| `src/core/sparsity.ts:51` | “SHA-256 style 256-bit hash” | Four independent bespoke 32-bit rolling accumulators plus four XOR-derived output words are not SHA-256 or a reviewed cryptographic hash. | known-open | QUARANTINED |
| `src/core/philox96.ts:54` | “full cross-word diffusion” | Default-round influence is incomplete and diffusion/security is not established. | known-open | QUARANTINED |
| `src/core/ledger3072.ts:220` | deterministic state ordering | `localeCompare` varies by locale and can produce different ordering across nodes. | known-open; promotion blocker | QUARANTINED |
| `src/core/ledger3072.ts:336-337` | accepted block roots | `applyBlock` overwrites header roots after mining rather than validating immutable commitments. | known-open; promotion blocker | QUARANTINED |
| `src/main.ts` (`stepHead`) | UI reports that the head was stepped | The handler changes readout metadata but not worker bytes or rendered/exported artifact identity. | known-open | SHIPS |
| `src/main.ts` keyboard focus guard / `index.html` Space help | global shortcuts remain available after clicking controls | Focused buttons trigger the broad interactive-element guard, so Space and other shortcuts are ignored until focus leaves. | help copy corrected; behavior known-open | SHIPS |
| `src/core/protocolProgress.ts` evidence strings | “Current evidence” can appear machine-derived | Citations and statuses are hand-authored; no badge is produced by a test run. | fixed evidence-policy disclosure | SHIPS |

## Test-name and coverage corrections

Passing counts show only that registered tests ran. They are not a coverage or
security score. These tests remain frozen during M2 and need separate repair:

| Location | Test-name implication | What is actually checked | Status | Boundary |
|---|---|---|---|---|
| `test/engine.test.ts:134` | exact multiplication against BigInt | No BigInt oracle is computed; output is only checked for uint32 shape. | known-open | QUARANTINED |
| `test/engine.test.ts:1863` | general quaternion yaw/pitch correctness | Only the identity quaternion and manager flags are checked. | known-open coverage gap | QUARANTINED |
| `test/engine.test.ts:1875` | P2P node identifier generation | The caller supplies `test-node-1`; the test only observes the same value and an empty peer set. | known-open coverage gap | QUARANTINED |
| `test/engine.test.ts:1902` | deterministic, populated Philox96 output | Two fresh zero-filled arrays would also compare equal if the function did nothing. | known-open | QUARANTINED |
| `test/engine.test.ts:1914` | materialisation produced pixels | The assertion checks the length of the buffer allocated by the test, not its contents. | known-open | QUARANTINED |
| `test/engine.test.ts:1991` | sparsity difficulty behavior | Only zero difficulty is exercised, which accepts without proving nonzero-target behavior. | known-open | QUARANTINED |

## Human-facing record corrections

- `HANDOFF.md` is retained as historical context under a dated stale banner. Its
  old test counts, source-size estimate, tail-patch size/probability, clean-tree,
  deployment, and “Nothing is broken” statements are not current evidence.
- `design-qa.md` is scoped to the exercised Protocol Observatory panel path.
  Its historical engine-suite count did not cover the separate browser suite,
  and its screenshots are not repository artifacts.
- All Protocol Observatory status values remain unchanged. ADR-001 remains
  proposed, D-001 through D-015 remain open, and no production gate passes as a
  result of this checkpoint.

## M2 integration evidence

The isolated M0/M1 address-identity branch was reconciled with the AG
Observatory checkpoint on 2026-08-14. This is implementation and evidence-index
maintenance, not Protocol completion.

- The merge tree passed application and browser-suite typechecks, production
  build, 142 registered engine tests, and the canonical 3-test Chromium
  address-identity suite.
- A pre-retirement run of all five discovered browser files produced 3 passes
  and 2 failures. The two duplicate failures used invalid or mistimed evidence
  boundaries. Their source files remain recoverable in checkpoint `4e63490`;
  raw run metadata and error contexts remain in the verified M2 evidence
  archive and dirty-tree backup.
- The rendered Observatory preserved its static status: G0 and G1 active,
  G2–G10 blocked, 0/11 passed/current, 84 obligations, 12 systems, and D-001
  through D-015 open.
- The Observatory remains manually maintained. These measured test results do
  not automatically update its evidence entries or status badges.

## Independent reproduction — performed 2026-08-15, recorded 2026-08-16

A second agent reproduced the M2 checkpoint cold from committed revision
`ad60742` on branch `agent/ag-3072-protocol` with a clean tree. This is
evidence-index maintenance only; it advances no gate, decision, item status,
or claim, and it does not make the archive or the research rail secure.

Commands run by the reproducer, with the result each printed:

```sh
npm run typecheck            # exit 0
npm run typecheck:browser    # exit 0
npm run build                # pass, 27 transformed modules
npm test                     # 142 registered engine tests pass, 0 fail
npm run test:browser         # 3 pass, 0 fail (Chromium)
```

Repository checks run at `ad60742` (clean tree) on 2026-08-16 while preparing
this record:

```sh
git log --format='%h %p' 7af2394..HEAD
#  ad60742 b52d96d / b52d96d 4e63490 18fabae / 4e63490 7af2394 / 18fabae 2830091 / 2830091 7af2394
git diff --quiet 7af2394 HEAD -- src/core/philox.ts src/gpu/shaders.ts \
  src/core/sphere.ts src/core/offset.ts src/gpu/renderer.ts src/core/plate.ts \
  src/core/png.ts src/core/raster.ts src/core/address.ts src/core/format.ts
#  exit 0: the ten-module engine set is byte-identical to baseline
git rev-parse --short main                  # 7af2394
git rev-parse --short origin/main           # 7af2394
git notes list | wc -l                      # 2
git ls-tree -r --name-only 4e63490 -- test/browser
#  imported_address.spec.ts, restored_address.spec.ts (no canonical M1 specs in that tree)
grep -c '^\s*test(' test/engine.test.ts     # 135
grep -c '^  test(' test/engine.test.ts      # 4 (lines 211, 229, 645, 777, inside for loops)
```

- Engine count reconciliation: 135 `test(` declarations are 131 top-level plus
  4 inside `for` loops. The `bpc` loops at lines 210 and 644 register their
  bodies twice and the PNG scanline `filter` loop at line 776 registers five,
  so the four in-loop declarations register 11 tests and 131 + 11 = 142. 135
  declarations and 142 registrations describe one suite; neither is a coverage
  or security score; the thin tests listed above remain known-open.
- The 3 Chromium tests are `harness.spec.ts`,
  `restored-generated-address.spec.ts`, and
  `restored-imported-address.spec.ts` against the 2 × 2 RGB16 fixtures in
  `test/browser/README.md`.
- The unchanged-file check covers the ten-module engine set only. `src/main.ts`
  and `test/engine.test.ts` are outside that set; `src/main.ts` changed in both
  M1 (`18fabae`) and the AG checkpoint (`4e63490`), and `test/engine.test.ts`
  changed in the AG checkpoint.
- Not reproduced: no fresh developer-console or GPU-probe log was captured, so
  this pass, like M2, makes no zero-console-error claim. Nothing was fetched
  from or pushed to any remote.

## Checkpoint lineage

| Checkpoint | SHA | Parent(s) | Content | Measured on that tree |
|---|---|---|---|---|
| Baseline | `7af2394` | — | Published baseline; GitHub default branch and Pages deployment from 2026-08-12 until superseded by `ddbf12d` on 2026-08-17; `.github/workflows/deploy.yml` deploys `main` to Pages on push | — |
| M0 | `2830091` | `7af2394` | Evidence-only: Playwright/Chromium harness plus red generated and imported 2 × 2 RGB16 reload/export characterizations; no `src/` changes | Characterizations intentionally red against `7af2394` |
| M1 | `18fabae` | `2830091` | `src/core/activeAddressSnapshot.ts` v1 (derived/opaque, fail-closed); `src/main.ts` address lifecycle; same assertions green; workflow renamed "Address identity browser gate"; one-line commit message, no measured body | 3/3 Chromium (recorded in `test/browser/README.md` and the `b52d96d` body) |
| AG checkpoint | `4e63490` | `7af2394` | AG research and Protocol Observatory draft; two AG specs only (`imported_address.spec.ts`, `restored_address.spec.ts`); no canonical M1 specs present | Not measured standalone in this ledger. Its commit body records both AG specs red in pre-checkpoint artifacts (16-byte UIA2 header fixture; empty IndexedDB record read before export). The five-file 3 pass / 2 fail run was measured on the pre-retirement merge working tree, not on this tree (M2 integration evidence above). |
| M2 merge | `b52d96d` | `4e63490` + `18fabae` | Two-parent integration; AG specs retired (sources at `4e63490`) | typecheck x2 pass; build 27 modules; engine 142/142; Chromium 3/3 |
| M2 docs | `ad60742` | `b52d96d` | `design-qa.md`, `CORRECTIONS.md` M2 evidence; G0/G1 active, G2–G10 blocked, 0/11 | Reproduced cold 2026-08-15 by a second agent (above) |

Publication state (2026-08-18): the branch was pushed on 2026-08-16 and
merged into GitHub's default branch by
[PR #1](https://github.com/ShreyChouksey/universal-image-archive/pull/1) as
merge commit `ddbf12d` (parents `7af2394`, `544e2da`; tree identical to
`544e2da`'s) on 2026-08-17. `origin/main` = `ddbf12d`. The
[Deploy run](https://github.com/ShreyChouksey/universal-image-archive/actions/runs/32028169087)
on that push completed `build`, `browser-gate / browser-characterization`, and
`deploy` with `success`, and GitHub Pages deployment `5944630790` names sha
`ddbf12d`. Later commits (M6 onward) are recorded here as they are made; their
own CI runs and deployments are GitHub's SHA-keyed run and deployment records
and are cited, not copied. Local Git notes exist on `89a51ce` and `8f74ed2`
only; `refs/notes/commits` is unpublished.

## M0–M2 process deviations and evidence-locality boundaries

Recorded so that later work does not mistake a shortcut for a policy.

| Location | Instructed or expected handling | Measured handling | Status | Boundary |
|---|---|---|---|---|
| `test/browser/imported_address.spec.ts`, `test/browser/restored_address.spec.ts` (AG duplicate specs) | Quarantine in-tree with `test.fixme` and a written reason after the failing run | Both files deleted in merge `b52d96d`; sources recoverable only with `git show 4e63490:test/browser/<name>`; raw failure contexts preserved outside the repository (see backup row). Defects not disputed: 16-byte header fixture against the real 20-byte UIA2 header (`test/browser/support/archive.ts:6`, `src/core/address.ts:443`) and an IndexedDB record read before export. Not a finding against the M1 assertions those specs duplicated. | known-open; awaiting founder disposition — restore both as `test.fixme` at `4e63490` content, or ratify retirement in writing | QUARANTINED |
| Git notes on corrected commits | Notes expected on more of the 8 corrected commits | Local notes on 2 of 8 (`89a51ce`, `8f74ed2`); none on `2830091`, `18fabae`, `4e63490`, `b52d96d`, `ad60742`; `refs/notes/commits` unpublished. The tracked table above is authoritative; the absence of a note reinstates nothing. | known-open; optional duplication | QUARANTINED |
| Commit `18fabae` (M1) | Commit body naming measured results | One-line message, no body; evidence lives in `test/browser/README.md` and the `b52d96d` merge body. | known-open; record only | QUARANTINED |
| `.github/workflows/browser-characterization.yml` | CI execution of the address-identity gate | Triggers `pull_request`, `workflow_dispatch`, and — from the M4 commit — `workflow_call`, called by `deploy.yml` job `browser-gate` (SHA in the M4 entry). Standalone `pull_request` runs observed on PR #1 (first: https://github.com/ShreyChouksey/universal-image-archive/actions/runs/31954025398, head `a503023`), all `success`; the deploy-time `workflow_call` job `browser-gate / browser-characterization` observed once in Deploy run https://github.com/ShreyChouksey/universal-image-archive/actions/runs/32028169087 on `ddbf12d`, `success`. No failing gate has been observed. | known-open; standalone and deploy-time runs observed, all green; no red observed | QUARANTINED |
| Browser console / GPU probe | Fresh capture at M2 closeout | Browser control refused; the recorded browser evidence is the 3-test Chromium suite result and the M0/M1 committed artifacts only. | known-open | QUARANTINED |
| `src/core/zkPlate.ts` | Removal, rename, or quarantine outside the shipping closure | Remains in `src/main.ts`'s import closure (`src/main.ts:65`, `window.UIA_FRONTIER.zkPlate` at `src/main.ts:2546-2550`) with corrected comments and unchanged bespoke 128-bit rolling-checksum behaviour and legacy `verified: true` flag; tracked by Observatory item `auth-legacy-transcripts` (experimental) and D-009. Root `index.html` carries no forbidden vocabulary. | known-open; awaiting founder disposition — remove, rename, quarantine, or retain with labelling | SHIPS |
| Auditor-reported uniqueness percentages and dead-bit counts (session-only) | Cited as measured evidence | No fixture, script, or output file exists in the repository or in Git notes at `ad60742`; the values cannot be reproduced and are not restated here. Divergent values across auditors remain unresolved. | not citable; re-derive from a committed script before any future use | QUARANTINED |
| M2 dirty-tree backup, M0/M1 bundle, and raw red-test evidence | Location named in the integration record | Held outside the repository, verified present on 2026-08-16: `~/uia-dirty-backup-20260814-163512.tgz` (SHA-256 `6a7ed1c1b97e05be57f82692cadfdda6a3334505c929343e9ea191a38155a77e`), `~/uia-m0-m1-20260814-163512.bundle` (SHA-256 `a5095daf47766d44f670e8371471aaabcbc0e8ba356d3d08b2fe068bb41b508f`; `git bundle verify` reports a complete history), `~/uia-m2-red-evidence-20260814-163512/` (`.last-run.json` plus the two AG spec error-context directories). Not evidence for any status; not repository artifacts. | recorded; retain until the founder ratifies or restores the AG spec disposition | QUARANTINED |

## Founder dispositions required

None of these is a protocol decision and none is entered in the decision
register; each is a governance or product call this ledger cannot make.

1. Retirement of the two AG duplicate specs: ratify in writing, or restore
   both as `test.fixme` at `4e63490` content.
2. Disposition of `src/core/zkPlate.ts` inside the shipping closure: remove,
   rename, quarantine, or retain with labelling.
3. Publication of branch `agent/ag-3072-protocol` and `refs/notes/commits`.
   Branch: published 2026-08-16 and merged into the default branch as
   `ddbf12d` on 2026-08-17 (PR #1); the deployed archive no longer carries the
   address-identity defect characterised in `2830091` (Pages deployment
   `5944630790`, sha `ddbf12d`). Notes: `refs/notes/commits` (2 local notes)
   remains unpublished; whether to publish it is still the founder's call.
4. Whether the browser characterization gate becomes a required prerequisite
   of deployment. Applied as a **proposal** on branch `agent/ag-3072-protocol`
   at the M4 commit (SHA in the M4 entry): `browser-characterization.yml`
   gains `workflow_call`; `deploy.yml` gains job `browser-gate` that `deploy`
   needs alongside `build`, fail-closed, `contents: read` only. Part (i), by the
   criterion this item set ("accepts by merging"): accepted when the default
   branch received `b618c5f` in `ddbf12d` on 2026-08-17. `deploy.yml` on
   `ddbf12d` declares `deploy.needs: [build, browser-gate]` — `build` and
   `browser-gate` jointly gate the `deploy` job — and in the one observed
   Deploy run both completed `success` before `deploy` ran; that a red gate
   withholds deployment is declared semantics, not yet an observed result.
   Part (ii): a required status check `browser-characterization` for merging
   to `main` is unset (`branches/main/protection` → 404, rulesets `[]`,
   2026-08-17); a repository-settings change no agent can make; remains open.

**Next goal as planned on 2026-08-16 (superseded — executed as M4 at `b618c5f`
and observed on GitHub in M5–M6): M4 — gate deployment on the browser
characterization suite.** Record of the plan as written that day: M0–M3 were
complete and cited by SHA (`2830091`, `18fabae`, `b52d96d`, `ad60742`,
`52af539`, `9757201`, `3b184a8`); the audit's publication precondition (b) —
the browser gate as a required prerequisite of the deployment path — was the
remaining agent-doable step before the founder could publish the P0 fix. Facts
the plan was designed around, as verified on 2026-08-16: `git ls-tree main
.github/workflows/` listed only `deploy.yml`, so `browser-characterization.yml`
was then unregistered on GitHub and could not be `workflow_dispatch`ed on the
branch, making a `pull_request` run after a founder push the first possible CI
observation; no Docker daemon was available locally, so the Linux runner could
not be rehearsed; the Playwright reporter was `list` only, so
`playwright-report/` was never produced. Planned shape (as delivered at
`b618c5f`): `browser-characterization.yml` gained `workflow_call` and a failure
upload of `test-results/`; `deploy.yml` gained a `browser-gate` job that
`deploy` needs alongside `build`, fail-closed, `contents: read` only. The
evidence ceiling stated that day was "wired; unobserved on GitHub"; the runs
that lifted it are cited in M5 and M6. No test, config, engine, or Protocol
status changed. Executed by Claude, audited by CodeX.

The treatment of the application provenance vocabulary (`derived`/`opaque`,
`OpaqueSource`) is decided only by the accepted D-002 ADR; it is recorded as a
non-resolving input in `open-decisions.md` and requires no separate
disposition.

None of the four dispositions above is the protocol's blocking decision. That
remains D-001 (primary protocol outcome), whose only path is founder
acceptance of an ADR-000 revision; the Observatory's downstream `blocked`
statuses do not move on any of the items in this ledger. The Observatory
itself is static hand-authored data (`src/core/protocolProgress.ts`); it
cannot move on its own, and any status change is a source edit that must be
recorded here with its evidence.

No Protocol Observatory status, gate, decision, or measured count changes as a
result of these entries.

## M3 — Protocol Observatory route persistence, and audit corrections (recorded 2026-08-16)

Scope: shell UI (`src/main.ts` routing, `src/ui/protocolObservatory.ts`),
browser tests (`test/browser/protocol-panel-restore.spec.ts`,
`test/browser/protocol-route-isolation.spec.ts`, README), the CI workflow name,
protocol documents, and provenance/evidence strings in
`src/core/protocolProgress.ts`. No engine module, no Observatory status, gate,
decision, or count changed. This entry advances nothing in the protocol;
it records a measured working-tree state and the wording corrections applied
after an independent audit.

**Commit: `9757201` (M3b).** Tests committed first as `52af539` (M3a, =
`ad60742` + `test/browser/protocol-route-isolation.spec.ts` only). Both on
branch `agent/ag-3072-protocol`, committed by the founder on 2026-08-16. This
paragraph is the M3c record: a commit cannot contain its own SHA, so the M3b
commit body called this entry provisional and this follow-up names the SHA and
the cold-run on that exact tree.

Measured at `52af539` in a detached worktree (feature absent — `src/main.ts` is
`ad60742`'s), `npx playwright test test/browser/protocol-route-isolation.spec.ts`:
3 failed, 1 passed — the panel never opens on `hashchange` (`expect.poll(panelOpen)`
false), a click writes no `view` (`Received: null`), the no-GPU deep link stays
hidden (`toBeVisible` failed); the no-history test passes. This is the
feature-absent red; the identity-overwrite red (`f0e0…` → `000102…`) was
measured on the uncommitted first M3 draft, recorded under M3a below, and is
not reproducible from any commit because that draft was never committed.

Measured at `9757201` (clean tree, `git status --porcelain` empty), 2026-08-16:

```sh
npx tsc --noEmit                              # exit 0
npx tsc --noEmit -p tsconfig.browser.json     # exit 0
npm test                                      # 142 tests, 142 pass, 0 fail
npm run build                                 # 27 modules transformed
npx playwright test                           # 11 passed (5 spec files)  [port-4193 override, see below]
git diff 7af2394 --stat -- <ten engine paths> # prints nothing
node … validateProtocolProgressModel          # 0 84 0 15
```

**What changed (behaviour).** The open state and sub-view of the Protocol
Observatory ride in the URL hash (`view=protocol`, `pv=<matrix|decisions>`,
map omitted) beside the address permalink. Three URL writers are kept apart in
`src/main.ts`:

- URL → panel: `applyProtocolRouteFromHash()` — silent reconciliation. Called
  at boot immediately after mount and before `createRenderer` (so a renderer
  failure cannot strand a `view=protocol` link), and on `hashchange` and
  `popstate`. It never triggers the full permalink writer; afterwards it
  normalises only the panel keys through the route-only writer, so a
  malformed `pv` is dropped and archive keys and unknown parameters are left
  exactly as found.
- panel → URL: `syncProtocolRoute()` — the route-only writer, reached from the
  Observatory's change callback. It edits the hash as raw `&`-separated
  segments: every segment whose key is not `view`/`pv` is kept byte-for-byte
  and in order (no re-serialisation through `URLSearchParams`, so
  non-canonical or duplicate unknown parameters survive untouched); all
  existing `view`/`pv` segments, duplicates included, are replaced by one
  trailing canonical pair, or removed when the panel is closed;
  `history.state` is preserved (`history.replaceState(history.state, …)`); it
  writes nothing when nothing changes.
- archive → URL: `syncUrl()` — the full permalink writer, driven by archive
  state and unchanged in scope. It emits `view`/`pv` from the panel so a
  reload keeps the panel, and is never triggered by the panel. Pre-existing at
  `ad60742` and unchanged: on archive-state changes it rebuilds the hash from
  archive state and does not carry unknown keys.

`open()`/`close()` are idempotent. Protocol clicks create no browser history
entry (decision recorded below).

**M3a — adversarial evidence, red before the fix.** The first M3 draft opened
the panel non-silently on `hashchange`, which ran the full permalink writer and
rewrote the hash from in-memory archive state. Reproduced by the audit and by
`test/browser/protocol-route-isolation.spec.ts` before M3b, on this machine:

```
✘ in-page navigation to a different coordinate with view=protocol keeps that coordinate and unknown params
    Expected: "f0e0d0c0b0a090807060504030201000"   Received: "000102030405060708090a0b0c0d0e0f"
    Expected: "keep"                                Received: null
✘ opening and closing the panel edits only view/pv and preserves history.state and unknown params
✘ no-GPU boot with a malformed pv shows Map and normalises only the pv key
    Received: "bogus"
✓ clicking Protocol creates no browser history entry
3 failed, 1 passed
```

**M3b — after the fix**, the same four tests pass and the whole suite is
11/11 (5 spec files). The three-writer separation above is what changed.

**Adversarial verification of M3b (2026-08-16).** Three independent agents ran
about twenty-five real Playwright probes against the route writer (boot
ordering with `a=` deep links and malformed `pv` under GPU and no-GPU; writer
crosstalk with archive actions — step, rounds change, seed change, traverse —
while the panel was open; search/tab/card-driven `setView` writes; rapid double
`hashchange`; foreign `history.state`; missing panel DOM before and after boot;
repeated `close()` via Escape, backdrop and button; three-entry Back/Forward).
Verdict from all three: no leak of archive identity or `history.state`;
`view`/`pv` survive archive-driven `syncUrl` rewrites; no `inert`/`aria-hidden`
residue after repeated close. Two P3 observations, both recorded:
(1) an in-page hash edit made *during* boot (before the canvas is live) is
overwritten by boot's terminal `syncUrl` — the pre-existing archive → URL
writer, out of scope, and the panel itself reconciled correctly in every case;
(2) the first M3b writer round-tripped through `URLSearchParams`, so
non-canonical unknown values were re-serialised (`x=a%2Fb~c%20d` →
`x=a%2Fb%7Ec+d`, bare `flag` → `flag=`) — semantically equal but not
byte-identical as claimed. Fixed the same day by editing raw segments (above);
`test/browser/protocol-route-isolation.spec.ts` now asserts raw byte equality
of every non-route segment using deliberately non-canonical values and a
duplicate unknown key. Probe files and temporary configs were deleted; the
committed Playwright config was not edited.

**History decision (audit item 5).** Protocol clicks do not push history
entries; routing uses `replaceState`, consistent with the rest of the app.
Consequence, stated plainly: Back does not close the panel — Back leaves the
archive as it always did. The panel is a URL-restorable view, not a navigation
step. `popstate` reconciliation exists for entries created by other means and
is tested with pushed entries; the real click flow is tested to leave
`history.length` unchanged. Reversible later by one decision if a Back-closes
behaviour is wanted.

**"Refresh", stated exactly.** The Observatory's data is compiled into the
build from `src/core/protocolProgress.ts`. Opening the panel renders the
served build's data; a reload shows newer data only once a newer build is
served. `#protocolSource` names the evidence revision on screen. There is no
live repository channel and none is claimed.

**Commands run on the pre-commit working tree (superseded by the `9757201` record above; kept because the numbers matched):**

```sh
npx tsc --noEmit                              # exit 0
npx tsc --noEmit -p tsconfig.browser.json     # exit 0
npm test                                      # 142 tests, 142 pass, 0 fail
npm run build                                 # 27 modules transformed
npx playwright test                           # 11 passed (5 spec files)
#  run through a temporary port-4193 override of playwright.config.ts because an
#  unrelated process held [::1]:4173 on the measuring machine; the committed
#  config was not edited and the override was deleted after the run
git diff 7af2394 --stat -- src/core/philox.ts src/gpu/shaders.ts src/core/sphere.ts \
  src/core/offset.ts src/gpu/renderer.ts src/core/plate.ts src/core/png.ts \
  src/core/raster.ts src/core/address.ts src/core/format.ts   # prints nothing
node --import ./test/register.mjs -e "import('./src/core/protocolProgress.ts').then(m=>console.log(m.validateProtocolProgressModel().length, m.PROTOCOL_WORK_ITEMS.length, m.PROTOCOL_GATES.filter(g=>g.status==='pass').length, m.OPEN_PROTOCOL_DECISIONS.length))"
#  0 84 0 15  (validator errors, obligations, gates passed, decisions)
```

**Browser gate.** `test/browser/protocol-panel-restore.spec.ts` adds four
tests and `test/browser/protocol-route-isolation.spec.ts` adds four adversarial
tests (identity and unknown-parameter preservation under in-page navigation,
panel clicks, and no-GPU boot with malformed `pv`; no history entry on click).
The first file's tests: reload restores open state and sub-view and a closed panel stays closed;
a protocol deep link opens with both GPU backends removed by an init script
(`#pipelineText` reads `no GPU`, canvas never becomes live); same-page hash
add/remove reconciles and a malformed `pv` falls back to map and is dropped
from the URL; Back/Forward across pushed entries reconciles via `popstate`.
The workflow `.github/workflows/browser-characterization.yml` is renamed
"Browser characterization gate"; `test/browser/README.md` states 11 tests in
5 spec files and keeps the historical M1/M2 "3/3" records as statements about
those revisions. Scope stated exactly: the routing tests use the 2 × 2
coordinate permalink; the large-address `a=` permalink, which `syncUrl`
abbreviates to head…tail above 4096 hex characters, is not exercised and
remains known-open.

**Wording corrections applied after the audit** (each in the named file):

| File | Was | Now |
|---|---|---|
| `docs/protocol/open-decisions.md` (D-002 input) | `.uia` "proves exact bytes and format" | encodes and round-trips them; no authenticity or cryptographic-integrity proof |
| `docs/protocol/open-decisions.md` (D-002 input) | baseline "recorded no such distinction" | baseline already held runtime-only `seed \| foreign` and persisted only bytes; on restore that runtime state was not re-established |
| this file (independent reproduction) | `git rev-parse --short main origin/main` (fails: "Needed a single revision") | two separate commands, one per ref |
| `docs/protocol/observatory-progress-model.md` | SHA requirement stated for all evidence | scoped to evidence recorded after `ad60742`; pre-existing "current working tree" boundaries migrate when next touched |
| `docs/protocol/evidence-and-integration-discipline.md` §6.4 | blanket security-vocabulary rule | restricted to claims about the experimental prototypes; normative documents may state positive security requirements and targets |
| `docs/protocol/charter-000.md` §8 | "unless an accepted ADR names it" | "explicitly adopts that evidence as satisfying a named criterion … a mention is not an adoption" |
| `test/browser/README.md`, code comment | "refresh" implied | build-time data model stated; no live channel |

**Measured, for the record.** Item `mission-primary-outcome` (D-001) has 4
direct dependants and 57 transitive dependants of 84 obligations, computed by
walking `dependencies` in `src/core/protocolProgress.ts` on this tree. By
transitive dependants it ranks fifth: `mission-charter` 77, `grammar-adr` 63,
`grammar-envelope` 59, `mission-slos` 58, then D-001 at 57. It is critical and
not the sole or largest blocker; the earlier informal "blocks a third" and
"largest single upstream" are both withdrawn in favour of these numbers.

**Not done, stated plainly.** `syncUrl` (archive → URL) still rebuilds the
hash from archive state on archive changes and drops unknown keys; that is
pre-existing behaviour at `ad60742` and outside this goal. No fresh GPU-probe
or console capture beyond the Playwright runs (the browser pane used for manual checks reported no console
errors on the reload path; that is an observation, not a recorded artifact).
Nothing pushed; `main` and `origin/main` remain at `7af2394` and the Pages
deployment still tracks that revision. The browser gate is not yet a
prerequisite of `.github/workflows/deploy.yml`; making it one is a founder
decision recorded under "Founder dispositions required".

No Protocol Observatory status, gate, decision, or measured count changes as a
result of this entry.

## M4 — Gate deployment on the browser characterization suite (recorded 2026-08-16)

Scope: two workflow files and this ledger. No test, spec, fixture, or Playwright
config content changed; no `src/` file; no engine module; no Observatory
status, gate, decision, or count. This entry advances nothing in the protocol;
it records a wiring change and the offline checks that were possible.

**Commit:** recorded in the M4c line below (a commit cannot contain its own
SHA; M3b/M3c pattern). Start of work: `8c344c5`, clean tree, `main` =
`origin/main` = `7af2394`, `git ls-tree main .github/workflows/` = `deploy.yml`
only.

**Why.** The M3 audit's publication precondition (b): the browser gate must be
incorporated into, or made a required prerequisite of, the deployment path.
Before M4, `deploy.yml` ran `npm ci`, `npm test`, `npm run build`, then
deployed; the browser workflow triggered only on `pull_request` and
`workflow_dispatch` and had never executed on GitHub.

**What changed.**

`.github/workflows/browser-characterization.yml` — `on:` gains `workflow_call:`
(alongside `pull_request:` and `workflow_dispatch:`); `timeout-minutes` 10 → 15
(cold first run: no npm cache, apt + browser download, typecheck, 11 serial
tests; a job-timeout kill is a cancel with no failure artifact); a final step
`if: failure()` → `actions/upload-artifact@v4` with `name: playwright-traces`,
`path: test-results/`, `if-no-files-found: ignore`, `retention-days: 14`. The
reporter is `list` only, so `playwright-report/` is never produced and is not
uploaded. No test command changed. `permissions: contents: read` unchanged.
Name unchanged.

`.github/workflows/deploy.yml` — new job:

```yaml
  browser-gate:
    uses: ./.github/workflows/browser-characterization.yml
    permissions:
      contents: read
```

and `deploy.needs` changes from `build` to `[build, browser-gate]`. The `build`
job is byte-identical to `8c344c5` (verified by diff). Top-level `permissions`
and `concurrency` unchanged. The gate runs in parallel with `build`; `deploy`
cannot start unless both succeed. No `continue-on-error`, no `if:` on
`browser-gate` or `deploy`. Job-level `permissions: contents: read` on the
`uses:` job strips `pages: write` / `id-token: write` from the gate.

**Offline checks that ran (this machine, working tree above `8c344c5`):**

```sh
ruby -ryaml -e 'YAML.load_file(".github/workflows/deploy.yml"); YAML.load_file(".github/workflows/browser-characterization.yml"); puts "yaml ok"'
#  yaml ok; deploy jobs: browser-gate,build,deploy; browser-gate keys: uses,permissions;
#  deploy.needs: ["build","browser-gate"]; gate on: pull_request,workflow_dispatch,workflow_call;
#  gate timeout-minutes: 15; gate steps: 7
which actionlint    # ABSENT — actionlint was NOT run; the reusable-workflow call,
                    # the allowed key set on the uses: job, and the local path are
                    # verified only by the first GitHub run
diff <build job at 8c344c5> <build job now>   # identical
git diff --name-only    # .github/workflows/browser-characterization.yml, .github/workflows/deploy.yml
```

**Stated plainly.** CI execution is pending a founder push. Nothing here has
run on GitHub. `browser-characterization.yml` is not on `main`, so it is
unregistered: it cannot be started with `workflow_dispatch` on the branch. The
first CI observation path is founder-only: push the branch (disposition 3 —
publishes every commit on it), open a pull request to `main` (the
`pull_request` trigger needs no registration; `deploy.yml` has no
`pull_request` trigger, so nothing deploys), read the run. That proves the
standalone mode only; the `workflow_call` edge from `deploy.yml` is first
exercised on the first push to `main`, and if that edge fails, deploy fails
closed and Pages keeps its previous deployment. Green → the founder may
merge/fast-forward `main`. Red → the `playwright-traces` artifact is the next
goal's evidence; do not merge. No Docker daemon on the development machine, so
the Linux runner was not rehearsed locally.

**M4c — commit `b618c5f`, measured 2026-08-16.** `git diff --name-only
8c344c5..b618c5f` = `.github/workflows/browser-characterization.yml`,
`.github/workflows/deploy.yml`, `docs/protocol/CORRECTIONS.md`. Cold-run at
`b618c5f` with `git status --porcelain` empty:

```sh
npx tsc --noEmit                              # exit 0
npx tsc --noEmit -p tsconfig.browser.json     # exit 0
npm test                                      # 142 tests, 142 pass, 0 fail
npm run build                                 # 27 modules transformed
npx playwright test                           # 11 passed (5 spec files) — committed config,
                                              # port 4173 free on this machine; no override used
git diff 7af2394 --stat -- <ten engine paths> # prints nothing
node … validateProtocolProgressModel          # 0 84 0 15 12 11
```

Still true after M4c: nothing has run on GitHub; nothing is pushed; `main` =
`origin/main` = `7af2394`. The next observation of this gate can only come from
the founder's push and pull request (M4 entry, "Stated plainly").

## M5 — First CI observation of the browser gate (recorded 2026-08-16)

Scope: this ledger only. No test, config, workflow, `src/`, engine, or
Observatory change. This entry advances nothing in the protocol; it records the
first GitHub Actions observation of the standalone browser gate and keeps
merge-readiness expectations separate from evidence.

**Commit:** recorded in the M5c line below (a commit cannot contain its own SHA).

**Observed.** PR [#1](https://github.com/ShreyChouksey/universal-image-archive/pull/1)
is open, `MERGEABLE`, and `CLEAN`, with `headRefOid`
`a503023910294cc802152ba441631ee79a968119`, `baseRefOid`
`7af2394aa082a5083870e20784cc2ed51a89df40`, and test-merge commit
`bff6bd32b8c841f5dce68e187b5b0227085f0740` (`refs/pull/1/merge`). GitHub
Actions run
[31954025398](https://github.com/ShreyChouksey/universal-image-archive/actions/runs/31954025398)
reports `event: pull_request`,
`headSha: a503023910294cc802152ba441631ee79a968119`, and
`conclusion: success`; check `browser-characterization` and every substantive
job step succeeded. Runner Image `ubuntu-24.04` / Version `20260810.271.1`.
The install log reports:

```text
Chrome Headless Shell 151.0.7922.34 (playwright chromium-headless-shell v1234) downloaded to /home/runner/.cache/ms-playwright/chromium_headless_shell-1234
```

Playwright's reporter lines were:

```text
Running 11 tests using 1 worker
  11 passed (25.2s)
```

The observed suite was **11 tests / 5 files**: `harness` (1),
`protocol-panel-restore` (4), `protocol-route-isolation` (4),
`restored-generated-address` (1), and `restored-imported-address` (1).

**Stated plainly.** Standalone `pull_request` mode observed; the `workflow_call`
edge from `deploy.yml` is unexercised until the first push to `main`. Because
the measured base remained `7af2394aa082a5083870e20784cc2ed51a89df40` and the
PR-head and test-merge commits both report tree
`3b9c0831f13d9abe11ee352d701eed8bd770ff0f`, the test-merge tree was identical
to the PR-head tree.

**Merge-readiness (expectation, not evidence).** The founder may choose (A) a
merge commit with
`gh pr merge 1 --merge --match-head-commit a503023910294cc802152ba441631ee79a968119`,
or (B) fetch, check out `main`, fast-forward it to local
`agent/ag-3072-protocol`, and push `main`. Do not squash or rebase: those
methods rewrite the cited lineage. All three GitHub merge methods are enabled,
so no settings change is needed for method (A) or (B). The merge push is
expected to start `Deploy to Pages` with jobs
`browser-gate / browser-characterization`, `build`, and `deploy`; `deploy`
targets environment `github-pages`, whose branch policy permits `main` only.
Pages leaves `7af2394` only if all three jobs succeed. Do not push to `main`
again until that run completes because deployment concurrency group `pages`
uses `cancel-in-progress: true`. After this first run makes the check
discoverable, the founder should consider protecting `main` with required
status-check context `browser-characterization` (the job id, not the workflow
name or deploy-time rendering); this is a recommendation, not evidence or an
executor action.

No Protocol Observatory status, gate, decision, or measured count changes as a
result of this entry.

**M5c — commit `60b0584`, measured 2026-08-16.** `git diff --name-only
a503023..60b0584` = `docs/protocol/CORRECTIONS.md`; second standalone run
[31954608243](https://github.com/ShreyChouksey/universal-image-archive/actions/runs/31954608243),
`conclusion: success`; reporter line: `11 passed (23.9s)`.

## M6 — Publication state after PR #1 (recorded 2026-08-18)

Scope: this ledger and `evidence-and-integration-discipline.md` §4/§7 only —
undated statements that became false at publication are corrected above; the
dated M3, M4, M4c, M5, and M5c entries stand as records of 2026-08-16. No
test, config, workflow, `src/`, engine, or Observatory change.

**Observed (cited, not copied — GitHub holds the SHA-keyed record).**
[PR #1](https://github.com/ShreyChouksey/universal-image-archive/pull/1)
merged as `ddbf12d` (parents `7af2394`, `544e2da`; tree identical to
`544e2da`'s), 2026-08-17. Standalone `pull_request` gate runs on that PR: three,
all `success`. [Deploy run
32028169087](https://github.com/ShreyChouksey/universal-image-archive/actions/runs/32028169087)
on `ddbf12d`: `build`, `browser-gate / browser-characterization`, `deploy` all
`success` (the `workflow_call` edge, first exercised). Pages deployment
`5944630790` names sha `ddbf12d`; the served bundle contains
`uia-philox4x32-image` and the `PROTOCOL_SOURCE_REVISION` string naming
`ad60742` and `9757201`, both absent from `src/` at `7af2394`. GitHub's default
branch and `origin/main` are `ddbf12d`; a local `main` ref that has not been
fast-forwarded still reads `7af2394` and must not be used for audit. `main` has
no branch protection or rulesets. `refs/notes/commits` unpublished.

**Unchanged by publication.** Protocol: 0/11 gates, D-001–D-015 open, ADR-000
draft with FD-001, FD-002, FD-003 unanswered, ADR-001 proposed, Observatory
84 · 12 · 11 (0) · 15. Dispositions 1 (AG spec retirement) and 2 (`zkPlate.ts`
in the shipping closure) open; six thin engine tests; deferred archive items.

**Anti-loop rule adopted.** No commit is made whose sole purpose is to record a
previous commit's SHA or CI run. This entry's own pull-request run and the
Deploy run of its merge are GitHub's records and are not transcribed here.
Bookkeeping ends with this entry; the primary track is ADR-000 (FD-001–003).

No Protocol Observatory status, gate, decision, or measured count changes as a
result of this entry.

## Seal — project paused by the founder (recorded 2026-08-19)

Scope: `README.md` status note and this entry only. No code, test, workflow,
Observatory, decision-register, or ADR change.

**Decision.** The founder paused and sealed the project on 2026-08-19 after
concluding, with Claude, CodeX, and AG in agreement, that the founding aim — a
cryptocurrency whose security advantage derives from the 2^3072 state space of
the 8 × 8 RGB16 tile — is not achievable: the state space is representational
cardinality (Charter §2.1, ADR-000 settled constraint 2); collision security
of any hash is at most half its output, so 3,072-bit collision security from a
384-byte value is impossible; primitives and signature standards cap near
256-bit and security past that is physically meaningless, quantum included
(Grover gives only a square-root speedup; Shor attacks structure, not size);
and a new primitive designed here would have no path to trust without years of
public cryptanalysis. No current use case for the archive alone was identified.
Honest directions, if revived: the archive as product; visual commitments and
fingerprints (a 256-bit-secure hash rendered as a tile); a small specification
with conformance vectors; image existence proofs via existing anchors
(OpenTimestamps, C2PA) without a new chain.

**State at seal.** GitHub default branch `main` = `3ed8106` (merge of PR #3,
ADR-000 Batch 1). Chain M0–M6 recorded above, SHA-cited. Pages deployment
tracks the last gated Deploy run (GitHub record). Observatory 0/11 gates,
84 obligations, 12 systems, 15 open decisions; D-001–D-015 OPEN; ADR-000
DRAFT with FD-001/002/003 decided (option A+R, negative necessity case
accepted, calendar review **2027-08-13**); ADR-001 PROPOSED. Anti-loop rule
(§4.4 of the discipline document) in force.

**Open at seal, unchanged.** Founder dispositions 1 (AG duplicate specs
retired, sources at `4e63490`), 2 (`src/core/zkPlate.ts` in the shipping
closure with corrected comments), 3 residue (`refs/notes/commits` unpublished),
4(ii) (no branch protection or rulesets); six thin engine tests; deferred
archive items (large-address `a=` permalink abbreviation, `syncUrl` drops
unknown keys, head-step control, delete/save races, worker revision tokens);
no fresh GPU-probe capture since M1.

**How to resume.** Read this file's "Checkpoint lineage" and publication-state
paragraphs, then ADR-000 §3. Run the gates before trusting any number: `npm
run typecheck && npm run typecheck:browser && npm test && npm run build &&
npm run test:browser`. The "bigger bits = more secure" question is settled and
should not be reopened; the FD-003 review on 2027-08-13 is the only scheduled
protocol event.

No Protocol Observatory status, gate, decision, or measured count changes as a
result of this entry.
