# UIA-3072 Protocol Glossary

- **Status:** Draft
- **Date:** 2026-08-12
- **Governing draft:** [Charter-000](./charter-000.md)

These definitions prevent representational, cryptographic, authentication, and
consensus properties from being collapsed into one “security” number.

| Term | Definition |
|---|---|
| **Address** | In the archive application, the exact byte value of an image in a fixed format, interpreted as a base-256 integer. It is not automatically a blockchain or cryptographic address. |
| **RawTile3072** | The exact 384-byte, 8 × 8 RGB16 tile using row-major RGB and big-endian 16-bit channels. It has \(2^{3072}\) possible values. |
| **Seed** | A smaller input deterministically expanded to an archive address. Expansion does not create entropy and generally reaches only a subset of the full address space. |
| **Canonical protocol object** | A typed, versioned and bounded object with exactly one valid byte encoding and explicit rejection rules. |
| **CanonicalTranscriptV1** | The eventual canonical tuple of fields supplied to a commitment or signature function. Its grammar is not yet specified. |
| **Commitment** | A digest that binds specified canonical data under an exact, domain-separated construction. Output width alone does not establish its strength. |
| **BlockCommit512** | Placeholder name for the future 64-byte authoritative block commitment. Its primitive and domain remain open. |
| **VisualCommit3072** | A future 384-byte standards-derived commitment output rendered as a UIA tile. It is distinct from raw image data and has no 3,072-bit security claim. |
| **Authentication witness** | Signature and associated algorithm/key references needed to authorize a transaction. It may be physically outside the header but must be available, validated, bounded, and committed. |
| **Semantic transaction ID** | A possible identifier for transaction meaning independently of exact witness bytes. Whether UIA needs this is open. |
| **Witness transaction ID** | A possible identifier that also binds exact authentication bytes. Whether UIA needs this is open. |
| **Authoritative rail** | The sole specified path whose outputs may affect acceptance, identifiers, state, rewards, fork choice, or finality. |
| **Research rail** | Optional, non-authoritative telemetry over canonical bytes. It cannot affect protocol validity before a versioned promotion. |
| **Generic collision resistance** | Work expected for a generic attacker to find two different inputs with the same digest. For an ideal 512-bit digest, the classical birthday target is about \(2^{256}\). |
| **Preimage resistance** | Work expected to find an input matching a chosen digest. It is distinct from collision resistance. |
| **NIST security strength category** | A comparative security class under defined computation models. It is not a promise of one exact number of operations. |
| **Post-quantum authentication** | Authentication using an algorithm intended to resist known attacks by large quantum computers. It does not make the commitment, consensus, transport, implementation, or whole system post-quantum. |
| **Consensus** | The rules and mechanism by which nodes agree on ordered authoritative state, including safety, liveness, Sybil resistance, fork choice, and finality. A hash and signature suite is not consensus. |
| **Security target** | A precisely scoped design objective under a named attack model. It is not proof that an implementation or deployed system achieves the objective. |
| **Security proof/review** | Formal reasoning and/or independent analysis supporting a defined property. Passing local tests, running a bounty, or observing no attacks is not by itself a proof. |
| **Application address provenance** | The archive application's `derived` / `opaque` provenance record (`src/core/activeAddressSnapshot.ts`) is application-local storage vocabulary, recorded as a non-resolving input to D-002 in `open-decisions.md` (Inputs on file). It is not a protocol identifier and its terms are not defined here until an accepted ADR adopts or rejects them. |
| **SHIPS** | Marker used in `CORRECTIONS.md`: the affected source is in `src/main.ts`'s transitive application import closure and therefore reaches the built archive. It does not mean secure, reviewed, or protocol-authoritative. |
| **QUARANTINED** | Marker used in `CORRECTIONS.md`: the affected source is outside the shipping import closure, including research modules and tests. It does not mean removed, reviewed, or secure. |
| **Checkpoint (repository)** | A committed revision, cited by SHA, whose measured typecheck, build, and test results are recorded in `CORRECTIONS.md`. It is an evidence term only and is distinct from consensus, sync, or transparency-log checkpoints under D-013. |
| **Characterization test** | A test that records the observed behaviour of a named revision — including behaviour later judged wrong — so a fix can be shown to change exactly that observation. `2830091` committed the red address-identity characterizations against baseline `7af2394`; `18fabae` turned the same assertions green. A red characterization is evidence of a defect, not of a fix. |
