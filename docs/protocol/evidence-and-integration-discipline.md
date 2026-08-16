# Evidence and Integration Discipline

- **Status:** WORKING POLICY — NON-NORMATIVE
- **Date:** 2026-08-16
- **Governing draft:** [Charter-000](./charter-000.md) §7–§8
- **Ledger:** [CORRECTIONS.md](./CORRECTIONS.md)
- **Protocol effect:** None. This document adds no gate, passes none,
  resolves no decision, and changes no Observatory status.

## 1. Purpose

This policy records how this repository produces, records, and integrates
evidence. It was drawn from the M0–M2 archive address-identity checkpoint.
That work is archive-application evidence, not protocol-gate evidence; the
rules below apply to both.

## 2. Measured numbers only

1. A number appears in a commit message, ledger, card, or document only if a
   named command printed it, or a cited source line states it, on the cited
   tree in the same session.
2. Every restated number names the revision that measured it. Numbers measured
   at `ad60742` and reusable as such: 142 registered engine tests
   (135 `test(` declarations, 4 of them loop-expanded), 3 Chromium tests,
   27 build modules, 84 Observatory obligations, 12 systems, 11 gates
   (0 pass), 15 open decisions, 8 corrected commits, 2 local Git notes.
3. Divergent auditor values for one property are recorded as unresolved, never
   averaged or selected. Unfixtured audit numbers may not be cited.
4. Passing counts are run evidence, not coverage or security evidence.

## 3. Committed fixtures

1. A defect claim is committed as failing evidence before its fix, naming the
   exact observed bytes or values (precedent: `2830091` against `7af2394`).
   Exceptions: an actively exploited security defect, data loss in progress,
   or a broken build may be fixed first; the characterization is then
   committed within the same change set or the next one, and the ledger row
   states that the fix preceded the evidence and why.
2. Fixtures carry exact bytes in the repository and are cited by file, never
   restated in policy documents (precedent: the two fixed 2 × 2 RGB16 cases
   and the 44-byte UIA2 file with 20-byte header in `test/browser/README.md`;
   `UIA2_HEADER_BYTES = 20` in `src/core/address.ts:443`).
3. An oracle observes the real boundary it names — worker bytes, renderer
   readback, persisted record, downloaded file, URL — not a proxy such as
   buffer length, UI text, or a comparison that also passes on empty output.
4. A fixture that does not match the real format invalidates the test that
   uses it, not the code under test (precedent: 16-byte header versus
   `UIA2_HEADER_BYTES = 20`).

## 4. Independent reproduction

1. A checkpoint is reproduced cold, from the committed tree, by a party other
   than the author, and the results are recorded against the exact SHA in
   `CORRECTIONS.md` with the commands used.
2. Reproduction confirms a measurement; it does not upgrade any status.
3. What was not reproduced is recorded (precedent: no fresh console or GPU
   probe at M2; browser gate never run in CI).

## 5. Backup before integrate; provenance-preserving merges

1. Before integrating, the dirty tree and any uncommitted evidence are backed
   up outside the working tree, and the backup paths and content hashes are
   recorded in `CORRECTIONS.md`. Precedent: the M2 dirty-tree tarball, the
   M0/M1 bundle, and the raw red-test evidence directory, recorded with
   SHA-256 in the ledger's deviations table on 2026-08-16.
2. Divergent lineages are integrated with a two-parent merge that preserves
   both histories (precedent: `b52d96d` = `4e63490` + `18fabae`), never by
   squash or rewrite of published commits.
3. Integration into `main` or any push is accompanied by a recorded,
   independently reproduced measurement of the merged tree (typecheck, build,
   engine suite, browser suite). Publication itself is a founder decision.

## 6. Quarantine, retirement, corrections, and notes

1. A test that fails because of a defective fixture or a mistimed evidence
   boundary is quarantined in-tree with its reason (`test.fixme`) after the
   failing run is shown. Removal is permitted only when the source is
   preserved at a named commit and the removal is recorded in
   `CORRECTIONS.md`. Silent deletion is forbidden. Deviation from the M2
   instruction (quarantine with `test.fixme`) recorded: the two AG duplicate
   specs were instead removed in `b52d96d`; the removal met the preservation
   (sources at `4e63490`) and ledger (`CORRECTIONS.md`, M2 integration
   evidence) conditions above, and the founder disposition is tracked in
   `CORRECTIONS.md`.
2. Published claims that exceed measured behaviour are corrected in the
   tracked ledger `CORRECTIONS.md`, which is authoritative. Git notes may
   duplicate corrections; the absence of a note reinstates nothing.
3. Every ledger row carries `SHIPS` or `QUARANTINED` by membership in
   `src/main.ts`'s transitive import closure. Neither marker means secure.
4. Commit messages, comments, and documents that describe the experimental
   prototypes obey Charter-000 §7 and the subsystem-plan vocabulary policy:
   only "experimental", "deterministic", "structurally decoded"; no forbidden
   security terms except in negation or when quoting a published claim being
   corrected in `CORRECTIONS.md`. This restricts claims about what the
   prototypes are; it does not restrict normative documents. An ADR or the
   charter may state positive security requirements and targets (for example
   a collision target or an authentication category) as requirements, so long
   as no prototype is described as meeting them until the relevant gate passes.

## 7. Checkpoint log

Checkpoint lineage (SHAs, parents, content, and what was measured on each
tree) is recorded in `CORRECTIONS.md` under "Checkpoint lineage". Because
`.github/workflows/deploy.yml` publishes `main`, the Pages deployment tracks
`main` = `7af2394` until the founder pushes; nothing in the lineage has been
pushed.
