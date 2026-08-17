# ADR-000: Protocol Outcome and Sovereign-Ledger Requirements

- **Status:** DRAFT — FOUNDER DECISIONS REQUIRED
- **Date:** 2026-08-13
- **Primary decision:** D-001
- **Related decisions:** D-004, D-005, D-014
- **Governs:** the acceptance boundary for Charter-000 and the inputs to later
  grammar, cryptography, state, consensus, economics, networking, governance,
  operations, and assurance ADRs
- **Does not select:** an object registry, commitment primitive, signature
  profile, state model, token design, PoW/PoS/BFT mechanism, or launch plan

## 1. Purpose

This decision record must define what a future UIA protocol is for before the
project freezes production object schemas, limits, state, consensus, or token
mechanics. It separates an ambitious sovereign-ledger research objective from a
testable product and security requirement.

This draft contains only constraints already accepted by the project. Text
marked **FOUNDER DECISION REQUIRED** is deliberately unresolved and MUST NOT be
filled by implementation convenience, prototype behavior, or an assistant's
recommendation.

Accepting this ADR would resolve D-001 only. It would not by itself pass G0.
G0 additionally requires accepted threat/fault assumptions, measurable service
targets, a sovereign-chain necessity case, and the applicable privacy, issuer,
and redress decisions.

## 2. Settled constraints

The following statements may be carried into the decision without reopening
their narrow factual scope:

1. `RawTile3072` is an exact 384-byte, 8 × 8, RGB16 representation with
   \(2^{3072}\) possible byte values.
2. That cardinality is representation, not a 3,072-bit cryptographic hash or
   3,072-bit collision, preimage, signature, entropy, proof-of-work, or
   consensus security.
3. UIA does not currently supersede Bitcoin, Ethereum, Solana, or TRON as a
   complete security system. Any superiority claim must name one axis, a
   comparator configuration, a workload, a metric, and reproducible evidence.
4. A sovereign UIA ledger remains an active research objective, not a
   production fact or proof that a native chain is necessary.
5. Structured protocol objects, block headers, bodies, witnesses, and
   certificates are not required to fit inside a 384-byte raw tile.
6. Only a standards-based authoritative rail may determine protocol validity.
   Custom wide-state research remains optional, non-authoritative telemetry
   unless promoted through a separate versioned decision and independent
   evidence.
7. Existing 3,072-bit ledger, proof, mining, gossip, and commitment helpers are
   prototypes. They do not select a production state model, consensus family,
   token, authentication profile, or commitment construction.

## 3. Founder Decision Batch 1 — required now

### FD-001 — Exact primary guarantee

**FOUNDER DECISION REQUIRED.** Supply one sentence of the following form:

> UIA enables `[named actors]` to `[perform exact operation]` over
> `[identified objects/state]`, and independently verifying nodes can establish
> `[exact safety/finality/availability result]` under `[named assumptions]`.

The sentence MUST describe a protocol-verifiable result. It MUST NOT promise
legal ownership, authorship, identity, permanence, truth, decentralization, or
security unless the corresponding authority and failure model are defined.

### FD-002 — V1 capability matrix

Mark every row **required**, **deferred**, or **excluded**. “Research objective”
is not a V1 capability state.

| Capability | Decision | Exact V1 result if required |
|---|---|---|
| Exact archive addressing and materialization | **FOUNDER DECISION REQUIRED** | |
| Authenticated media/registration claims | **FOUNDER DECISION REQUIRED** | |
| Transferable value or scarce assets | **FOUNDER DECISION REQUIRED** | |
| General-purpose or constrained programmable execution | **FOUNDER DECISION REQUIRED** | |
| Public permissionless block production/validation | **FOUNDER DECISION REQUIRED** | |

The selected rows define which later objects have a legitimate purpose. This
ADR does not yet define their wire schemas.

### FD-003 — Sovereign-chain necessity and kill criterion

**FOUNDER DECISION REQUIRED.** Name the indispensable property that cannot be
met adequately by a signed database, transparency log, existing L1/L2, or
application-specific rollup. Then state a falsifiable kill criterion:

> UIA requires a sovereign ledger because `[indispensable property]`.
> The sovereign-ledger design will be abandoned, deferred, or narrowed if
> `[measurable condition showing no material advantage or unacceptable cost]`.

This is not a request to choose PoW, PoS, or BFT. Mechanism selection belongs
to the later consensus/economics/network co-design stage.

## 4. Explicit non-guarantees

Unless later accepted ADRs and evidence establish otherwise, V1 MUST NOT be
described as proving:

- 3,072-bit cryptographic or consensus security;
- legal ownership, copyright, authorship, identity, or non-infringement;
- permanent availability merely because a commitment exists;
- decentralization merely because multiple nodes or keys exist;
- post-quantum system security merely because one signature candidate is PQ;
- ASIC resistance, memory hardness, zero knowledge, or STARK security from the
  current prototypes; or
- superiority to another network as a whole.

## 5. Required follow-on decision batches

These inputs are required for G0 but should be answered after Batch 1 fixes the
primary outcome.

### Batch 2 — measurable requirements

For every required V1 capability, specify:

- object classes and maximum expected sizes;
- sustained and burst arrival rates;
- confirmation and finality latency targets;
- availability and recovery objectives;
- state and history growth;
- supported node hardware and bandwidth envelope;
- operator/user cost envelope; and
- comparator, workload, metric, threshold, measurement method, and retest rule
  for every claimed superiority axis.

No throughput, fee, latency, or hardware number is currently accepted. Prior
figures suggested in discussion were proposals, not project decisions.

### Batch 3 — adversary and fault model

Specify actors, assets, trust boundaries, key compromise/loss, Byzantine node
capabilities, network delay/partition/eclipse, censorship, equivocation,
economic capture, clock faults, software/supply-chain compromise, governance
capture, data withholding, and classical versus quantum attack models. Select
fault thresholds only after the consensus participation model is known.

### Batch 4 — data, claims, authority, and redress

Decide:

- what is public, encrypted, committed-only, or never admitted;
- linkability and low-entropy/dictionary-attack treatment;
- retention, deletion, revocation, supersession, and takedown behavior;
- whether media claims exist and the exact predicate each claim expresses;
- issuer identity, assurance, accreditation, delegation, recovery, and
  compromise behavior; and
- correction, dispute, abuse, adjudication, and appeal authority.

If claims are excluded from V1, claim/issuer/redress branches may be marked not
applicable, but privacy and immutable-history consequences remain required.

### Batch 5 — token requirement boundary

Decide whether a native token is required, prohibited, or conditional. If
required, name its indispensable security or resource-allocation function.
Issuance, distribution, fees, staking/mining rewards, governance, and monetary
policy remain later decisions. A token is not justified solely by the desire
to create a chain.

## 6. Superiority target template

No row may use “overall security” or add unrelated bit counts.

| Axis | Comparator and version | Workload/adversary | Metric | UIA threshold | Measurement and expiry |
|---|---|---|---|---|---|
| Raw representation | Current UIA fixed tile | 8 × 8 RGB16 values | Exact reachable byte values | \(2^{3072}\) | Mathematical; expires if format changes |
| Commitment collision target | **OPEN** | **OPEN** | **OPEN** | **OPEN** | **OPEN** |
| Authentication | **OPEN** | **OPEN** | **OPEN** | **OPEN** | **OPEN** |
| Consensus safety/liveness | **OPEN** | **OPEN** | **OPEN** | **OPEN** | **OPEN** |
| Permissionless participation cost | **OPEN** | **OPEN** | **OPEN** | **OPEN** | **OPEN** |
| Availability/recovery | **OPEN** | **OPEN** | **OPEN** | **OPEN** | **OPEN** |

## 7. Alternatives that remain open

- no protocol beyond the mathematical archive;
- signed application records without a sovereign consensus layer;
- an append-only transparency log with external checkpoints;
- an application-specific rollup or existing-chain deployment;
- a sovereign ledger with a later-selected state and consensus model; or
- a deliberately staged combination whose trust boundaries are explicit.

Listing an alternative is not endorsement. Rejection requires evidence against
the accepted guarantee and requirement profile.

## 8. Downstream boundaries

Before this ADR is accepted, engineering MAY:

- refine architecture-neutral canonical grammar rules;
- prepare synthetic, explicitly non-production conformance vectors; and
- test prototype mechanisms behind fail-closed experimental boundaries.

Engineering MUST NOT infer or freeze:

- production domain, chain, object-type, or schema identifiers;
- production object/resource limits;
- transaction, block, vote, certificate, claim, or governance schemas;
- a state model, token, commitment, signature, PoW, PoS, or BFT profile; or
- user-visible legal, identity, provenance, finality, or availability claims.

## 9. Acceptance checklist

ADR-000 may move from `DRAFT` to `ACCEPTED` only when:

- [ ] FD-001 supplies one exact primary guarantee.
- [ ] FD-002 classifies every V1 capability.
- [ ] FD-003 supplies a sovereign-chain necessity and kill criterion.
- [ ] explicit non-guarantees are approved;
- [ ] measurable requirement batches are completed or assigned to named,
      blocking follow-on ADRs with no production assumption;
- [ ] applicable privacy, issuer, and redress branches are resolved;
- [ ] alternatives and consequences are reviewed;
- [ ] acceptance authority and reviewers are named; and
- [ ] Charter-000 is updated to cite the accepted outcome without selecting a
      later mechanism.

Acceptance resolves D-001. G0 passes only when every other G0 obligation has
accepted and current evidence. G1 and the project total therefore remain
`0 / 11` while this draft is being completed.
