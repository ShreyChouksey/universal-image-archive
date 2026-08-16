# 3,072-Bit Experimental Subsystem: Status and Protocol Plan

The specification phase now begins with [Charter-000](./protocol/charter-000.md).
Unresolved choices are tracked in the [open decision register](./protocol/open-decisions.md),
and protocol terminology is fixed in the [glossary](./protocol/glossary.md).
The current specification objective is the draft
[ADR-000 protocol outcome and sovereign-ledger requirements](./protocol/adr-000-protocol-outcome-and-sovereign-ledger-requirements.md).
Architecture-neutral grammar review continues in parallel under the proposed
[ADR-001 bounded canonical object grammar](./protocol/adr-001-bounded-canonical-object-grammar.md),
but no production object registry, schema, or limit may be inferred before the
G0 product and requirement decisions are accepted.
Visual status uses the non-normative
[Protocol Observatory progress model](./protocol/observatory-progress-model.md).
The charter is a draft: it freezes verified boundaries and targets without
silently selecting a state model, token, consensus family, or wire format.

## Current status

The subsystem is an isolated research prototype. It is not integrated into the
archive application, is not a blockchain consensus implementation, and must not
be presented as providing post-quantum signatures, zero-knowledge proofs,
cryptographic Merkle roots, ASIC resistance, verified WebRTC gossip, or secure
transactions.

`src/core/zkPlate.ts` is not part of this ten-module rail: it is imported by
`src/main.ts` and ships with the archive (marked `SHIPS` in
`docs/protocol/CORRECTIONS.md`), with corrected comments and unchanged
experimental behaviour.

The current code intentionally fails closed where the missing security boundary
would otherwise authorize a transaction:

- public verification of the bespoke transcript always rejects;
- the ledger rejects non-empty transaction sets unless a caller supplies an
  explicit authorizer;
- proof-of-work verification requires an independently supplied expected target
  and rejects zero difficulty;
- scalar encoders reject non-canonical and overflowing values;
- scratchpad memory, pass count, target, and attempt parameters are bounded;
- peer gossip performs structural decoding only and says so explicitly.

These are safety rails, not a completed protocol.

## Blocking design decisions

Do not implement more consensus behavior until these decisions are written as a
versioned specification and accepted together:

1. **Protocol identity and versioning**
   - Add an explicit protocol version and versioned algorithm-suite identifiers.
     Do not assume proof of work before the consensus decision is accepted.
   - Define canonical byte order, domain separators, genesis rules, chain ID,
     upgrade rules, and rejection behavior.
   - The classic 256-bit-prefix experiment and the 3,072-bit folded-vector
     experiment are incompatible algorithms; they cannot share an ambiguous
     `targetBits` field.

2. **Authenticated transaction envelope**
   - Select a standardized, reviewed signature or proof implementation and a
     maintained library. Do not extend the XOR/Philox transcript into a security
     primitive.
   - Specify exactly which bytes are signed, including chain ID, protocol
     version, typed operation payload, and replay protection. Sender/recipient,
     amount/fee, nonce, or nullifier fields depend on the accepted state model.
   - Redesign the wire format. The current block payload is 257 bytes, while one
     144-byte transaction plus the existing 128-byte transcript already needs
     272 bytes before framing. The present container cannot carry that data.

3. **Canonical block body and commitments**
   - Define how transactions are encoded in the block body and impose byte,
     count, and execution-cost limits.
   - Replace compatibility fingerprints with a standard cryptographic hash and
     canonical Merkle construction, with domain separation and published test
     vectors.
   - Commit the exact body, any producer/reward data, and the state transition
     in the immutable header before consensus validation.

4. **Consensus and work parameters**
   - Select the consensus/finality/Sybil-resistance model before freezing the
     header or certificate layout.
   - If proof of work is selected, define how every node derives the expected
     target from prior committed chain state. A miner-provided header target is
     never authoritative by itself.
   - Version and fix every selected proof-of-work parameter, including memory
     size, pass count, target interpretation, and nonce range.
   - Obtain external cryptanalysis before making memory-hardness or
     ASIC-resistance claims.

5. **Pure validation and atomic commit**
   - Make block processing a pure transition first: decode the canonical body,
     validate height and previous commitment, validate the selected consensus
     proof/certificate, authorize every transaction, execute within limits, and
     compute roots.
   - Compare computed commitments with immutable header commitments.
   - Commit chain/state once, only after every check succeeds. Validation must
     never rewrite bytes that were previously mined.

6. **Transport integration**
   - Put the callback gossip core behind the repository's real transport layer.
   - Bind sender identity to a connection object, add message-size/rate limits,
     backpressure, retry/ack policy, and a validator gate before long-lived
     deduplication.
   - Relay consensus-valid objects, not merely structurally decoded byte arrays.

7. **GPU execution contract**
   - Add browser/hardware tests comparing CPU and WGSL output for golden seeds,
     8-bit and 16-bit packing, round boundaries, high-carry multiplication, and
     two-dimensional dispatch.
   - Tile large output buffers. Raising requested device limits helps some
     adapters, but portable 5K/8K/16K materialisation cannot depend on one large
     storage binding.

## Implementation sequence and gates

### Phase A — specification and threat model

- Review Charter-000 and resolve its blocking open decisions through ADRs.
- Write protocol and wire-format ADRs.
- Define attacker capabilities, consensus invariants, resource limits, and
  cryptographic dependencies.
- Produce canonical binary fixtures and rejection vectors.

**Gate:** no security or decentralization claim is allowed before independent
review of the specification.

### Phase B — authenticated codec and pure transition

- Implement the versioned codecs and authenticated transaction envelope.
- Implement canonical cryptographic body/state commitments.
- Implement pure block validation and transition calculation.
- Add adversarial tests for forgery, malleability, replay, overflow, root/body
  mismatch, difficulty mismatch, invalid PoW, resource exhaustion, and rollback.

**Gate:** two independent implementations must agree on every acceptance and
rejection vector.

### Phase C — consensus and networking

- Implement the selected chain/finality rules, immutable headers, durable state,
  reorganization or view-change handling, and bounded validation. Derive work
  targets only if proof of work is selected.
- Integrate validation with the actual peer transport and add abuse controls.

**Gate:** multi-node deterministic simulations, restart/reorg tests, fuzzing,
and an external security review must pass.

### Phase D — GPU and application integration

- Add tiled WebGPU execution and real-adapter parity/capacity tests.
- Integrate only the components that pass their gates into the archive app.
- Benchmark on representative hardware and publish reproducible numbers.

**Gate:** unsupported devices and oversized formats must fail explicitly or use
a tested fallback; no silent `null` result in user-facing flows.

## Claims policy

Until all gates are met, use the terms “experimental,” “deterministic,” and
“structurally decoded.” Do not use “STARK,” “zero knowledge,” “post-quantum
signature,” “cryptographic Merkle root,” “ASIC-resistant,” “verified block,”
“true WebRTC mesh,” or performance guarantees for this subsystem.
