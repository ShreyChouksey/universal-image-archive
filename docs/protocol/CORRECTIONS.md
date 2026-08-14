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
