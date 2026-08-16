# UIA-3072 Open Decision Register

- **Status:** Active
- **Date:** 2026-08-12
- **Governing draft:** [Charter-000](./charter-000.md)
- **Current G0 draft:** [ADR-000: Protocol Outcome and Sovereign-Ledger Requirements](./adr-000-protocol-outcome-and-sovereign-ledger-requirements.md)
- **Parallel G1 proposal:** [ADR-001: Bounded Canonical Object Grammar](./adr-001-bounded-canonical-object-grammar.md)

This register prevents examples and prototype fields from silently becoming
protocol decisions. `OPEN` means implementation MUST NOT assume an answer.

| ID | Decision | Status | Blocks |
|---|---|---|---|
| D-001 | Exact primary outcome: archive addressing, signed registration, transferable state, general execution, or a defined combination | OPEN | Charter adoption, state model |
| D-002 | Artifact identity: source-file digest, canonical-pixel digest, `RawTile3072`, generated seed/address, and their relationship | OPEN | Canonical grammar, claim semantics |
| D-003 | State model: account, UTXO, append-only claims, object-capability, or hybrid | OPEN | Transaction grammar, execution, IDs |
| D-004 | Token purpose: fees, anti-spam, miner/validator security, governance, transfer asset, or no native token | OPEN | Economics, consensus, genesis |
| D-005 | Consensus family and finality: PoW, PoS, BFT/federated, or another specified model | OPEN | Header, certificates, fork choice |
| D-006 | Canonical binary grammar, integer encoding, length framing, maximum nesting, and rejection rules | OPEN | ADR-001, every identifier |
| D-007 | `BlockCommit512` primitive, customization/domain, and relation to `VisualCommit3072` | OPEN | ADR-002, header links |
| D-008 | State/body/authentication tree construction, empty/odd-node rules, proofs, and update model | OPEN | ADR-002, execution |
| D-009 | Authentication profile: ML-DSA or HashML-DSA, exact context, signing randomness, library, and conformance requirements | OPEN | ADR-003, transaction verification |
| D-010 | Key lifecycle: registration, stable subject identity, epochs, delegation, rotation, recovery, compromise, and revocation | OPEN | ADR-003, account/state model |
| D-011 | One transaction ID or semantic/witness IDs; exact fields committed by each | OPEN | ADR-003, Merkle/body rules |
| D-012 | Transaction, block-body, witness, execution, storage, and data-availability limits | OPEN | ADR-004, DoS model |
| D-013 | Chain ID, genesis, checkpoints, upgrade activation, rollback, and emergency governance | OPEN | Consensus and interoperability |
| D-014 | Privacy, public metadata, encrypted content, retention, takedown, revocation, and availability policy | OPEN | Product semantics, storage |
| D-015 | Research-rail promotion criteria, reviewers, minimum observation period, attack policy, and activation process | OPEN | Any use of wide-state research |

## Inputs on file (non-resolving)

An input is a measured fact or constraint made available to a resolving ADR.
Listing an input selects no option, imposes no requirement on the ADR, changes
no status, and narrows no decision. Every decision above remains `OPEN`;
resolution still requires an accepted ADR. Rows were recorded after `ad60742`
against sources measured at that revision.

| Decision | Input | Source | Measured against |
|---|---|---|---|
| D-002 | The archive application distinguishes a `derived` active address (recomputable from generator `uia-philox4x32-image` version 1, a four-word seed, a round count in 12–24, and a signed total offset) from an `opaque` one (exact bytes only, with a declared source `file`, `search`, `plate`, or `exact-link`), persisting both with identical bytes and format. Baseline `7af2394` already held a runtime-only `seed | foreign` provenance and persisted bytes, hex, and format metadata (resolution, depth, geometry) but no provenance; on restore that runtime state was not re-established, so restore/export replaced restored bytes with a materialised seed (`2830091`, red); `18fabae` made the distinction explicit, versioned, and fail-closed. Whether protocol artifact identity binds bytes and format only, or also this derivation or provenance record, is part of “their relationship” and is unresolved. | `src/core/activeAddressSnapshot.ts:25-52`; commits `2830091` (red), `18fabae` (fix); `test/browser/README.md` | `ad60742` (M2 checkpoint) |
| D-002 | The `.uia` file encodes and round-trips exact bytes and format only; it carries no provenance and provides no authenticity or cryptographic-integrity proof of either. Two exports of identical bytes from different provenance are indistinguishable as files. | `src/core/activeAddressSnapshot.ts:4-6`; `test/browser/support/archive.ts:6` (20-byte UIA2 header) | `ad60742` (M2 checkpoint) |
| D-002 | Integer stepping or a flushed offset on a persistable opaque address changes its bytes but leaves its declared source and label unchanged; whether such an address is still “from” that file, search, or plate, or has become a new derived artifact, is unresolved. | `src/main.ts:1043-1063` (`applyStep`), `src/main.ts:286-307` (`flushOffset`) | `ad60742` (M2 checkpoint) |
| D-002 | Bytes restored from a pre-M1 record carry runtime-only `legacy-unknown` provenance: viewable and exportable, never persisted or stepped, never rewritten as a declared source. Whether an identity profile classifies such bytes, and how, is unresolved. The application treats an opaque address's `returnSeed` as a navigation return point, not as identity. | `src/core/activeAddressSnapshot.ts:41, 83-88, 204-225`; `test/browser/restored-imported-address.spec.ts` | `ad60742` (M2 checkpoint) |

## Required decision record format

When resolving an item, its ADR MUST state:

1. the selected option and exact scope;
2. alternatives rejected and why;
3. security and operational consequences;
4. canonical bytes or algorithms affected;
5. migration and downgrade behavior;
6. positive, boundary, and rejection vectors;
7. independent-review requirements.

Resolution requires an accepted ADR. Editing this table from `OPEN` to a choice
without an ADR does not resolve the decision.
