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
