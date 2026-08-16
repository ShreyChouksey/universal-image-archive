# Measured Corrections and Known-Open Claims

- **Status:** Evidence ledger; not an ADR and not a protocol-security result
- **Checkpoint date:** 2026-08-14
- **Protocol effect:** None. No gate, decision, primitive, or implementation is
  advanced by this document.

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
| Baseline | `7af2394` | — | Published baseline; `main` and `origin/main`; `.github/workflows/deploy.yml` deploys `main` to Pages on push | — |
| M0 | `2830091` | `7af2394` | Evidence-only: Playwright/Chromium harness plus red generated and imported 2 × 2 RGB16 reload/export characterizations; no `src/` changes | Characterizations intentionally red against `7af2394` |
| M1 | `18fabae` | `2830091` | `src/core/activeAddressSnapshot.ts` v1 (derived/opaque, fail-closed); `src/main.ts` address lifecycle; same assertions green; workflow renamed "Address identity browser gate"; one-line commit message, no measured body | 3/3 Chromium (recorded in `test/browser/README.md` and the `b52d96d` body) |
| AG checkpoint | `4e63490` | `7af2394` | AG research and Protocol Observatory draft; two AG specs only (`imported_address.spec.ts`, `restored_address.spec.ts`); no canonical M1 specs present | Not measured standalone in this ledger. Its commit body records both AG specs red in pre-checkpoint artifacts (16-byte UIA2 header fixture; empty IndexedDB record read before export). The five-file 3 pass / 2 fail run was measured on the pre-retirement merge working tree, not on this tree (M2 integration evidence above). |
| M2 merge | `b52d96d` | `4e63490` + `18fabae` | Two-parent integration; AG specs retired (sources at `4e63490`) | typecheck x2 pass; build 27 modules; engine 142/142; Chromium 3/3 |
| M2 docs | `ad60742` | `b52d96d` | `design-qa.md`, `CORRECTIONS.md` M2 evidence; G0/G1 active, G2–G10 blocked, 0/11 | Reproduced cold 2026-08-15 by a second agent (above) |

Nothing in this lineage has been pushed; `main` and `origin/main` remain at
`7af2394`. Because `deploy.yml` publishes `main` to GitHub Pages on push, the
Pages deployment tracks `main` = `7af2394` until the founder pushes. Local Git
notes exist on `89a51ce` and `8f74ed2` only.

## M0–M2 process deviations and evidence-locality boundaries

Recorded so that later work does not mistake a shortcut for a policy.

| Location | Instructed or expected handling | Measured handling | Status | Boundary |
|---|---|---|---|---|
| `test/browser/imported_address.spec.ts`, `test/browser/restored_address.spec.ts` (AG duplicate specs) | Quarantine in-tree with `test.fixme` and a written reason after the failing run | Both files deleted in merge `b52d96d`; sources recoverable only with `git show 4e63490:test/browser/<name>`; raw failure contexts preserved outside the repository (see backup row). Defects not disputed: 16-byte header fixture against the real 20-byte UIA2 header (`test/browser/support/archive.ts:6`, `src/core/address.ts:443`) and an IndexedDB record read before export. Not a finding against the M1 assertions those specs duplicated. | known-open; awaiting founder disposition — restore both as `test.fixme` at `4e63490` content, or ratify retirement in writing | QUARANTINED |
| Git notes on corrected commits | Notes expected on more of the 8 corrected commits | Local notes on 2 of 8 (`89a51ce`, `8f74ed2`); none on `2830091`, `18fabae`, `4e63490`, `b52d96d`, `ad60742`; `refs/notes/commits` unpublished. The tracked table above is authoritative; the absence of a note reinstates nothing. | known-open; optional duplication | QUARANTINED |
| Commit `18fabae` (M1) | Commit body naming measured results | One-line message, no body; evidence lives in `test/browser/README.md` and the `b52d96d` merge body. | known-open; record only | QUARANTINED |
| `.github/workflows/browser-characterization.yml` | CI execution of the address-identity gate | Triggers only `pull_request` and `workflow_dispatch`; branch unpushed, so the workflow has never executed on GitHub. All browser results in this ledger are local runs. | known-open; CI evidence absent | QUARANTINED |
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
3. Publication of branch `agent/ag-3072-protocol` and `refs/notes/commits`
   (currently local; `main`/`origin` at `7af2394`). Consequence while
   undecided: `.github/workflows/deploy.yml` deploys `main` to Pages on push,
   so the Pages deployment tracks `7af2394`, which still contains the
   address-identity defect characterised in `2830091` and none of the
   corrections in this ledger. Repairing the deployed archive requires the
   founder to merge or fast-forward `main` to a revision at or after `18fabae`
   and push; no agent may do this. Whether to publish the protocol documents
   in the same push is a separate choice.
4. Whether the browser characterization gate becomes a required prerequisite
   of `.github/workflows/deploy.yml` (or of merging to `main`) before any
   publication. Today `deploy.yml` runs on push to `main` and already runs
   `npm ci`, `npm test` (engine suite), and `npm run build`; only the browser
   suite is missing from it, and the gate workflow triggers only on
   `pull_request` and `workflow_dispatch`. Recommended by the M3 audit; not applied, because it
   changes the deployment path and is the founder's call.

**Next goal (planned 2026-08-16, not started): M4 — gate deployment on the
browser characterization suite.** M0–M3 are complete and cited by SHA
(`2830091`, `18fabae`, `b52d96d`, `ad60742`, `52af539`, `9757201`, `3b184a8`).
The audit's publication precondition (b) — the browser gate as a required
prerequisite of the deployment path — is the remaining agent-doable step
before the founder can publish the P0 fix. Facts the goal is designed around,
verified on 2026-08-16: `git ls-tree main .github/workflows/` lists only
`deploy.yml`, so `browser-characterization.yml` is unregistered on GitHub and
cannot be `workflow_dispatch`ed on the branch — the first CI observation must
come from a `pull_request` run after a founder push; no Docker daemon is
available locally, so the Linux runner cannot be rehearsed here; the Playwright
reporter is `list` only, so `playwright-report/` is never produced. Planned
shape: `browser-characterization.yml` gains `workflow_call` and a failure
upload of `test-results/`; `deploy.yml` gains a `browser-gate` job that
`deploy` needs alongside `build`, fail-closed, `contents: read` only. Evidence
ceiling before a founder push: "wired; unobserved on GitHub". No test, config,
engine, or Protocol status change. Executor and auditor to be assigned by the
founder; measured results land in an M4/M4c pair on the M3b/M3c pattern.

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
