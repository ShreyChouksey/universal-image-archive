# ADR-000: Protocol Outcome and Sovereign-Ledger Requirements

- **Status:** DRAFT — Batch 1 (FD-001, FD-002, FD-003) decided by the founder on 2026-08-19; acceptance pending the §9 checklist
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

## 3. Founder Decision Batch 1 — decided 2026-08-19

Decision record: the text below was proposed by an assistant, adversarially
reviewed, and then **chosen and adopted by the founder on 2026-08-19** as the
founder's own decision (option "A+R", review date 2027-08-13, negative
necessity case accepted). It is founder text from this date; §1's prohibition
on assistant-filled decisions is satisfied by explicit adoption, recorded here.

Term used throughout. An *address* is the exact byte string of a format
(row-major pixels, big-endian channels). Protocol identity of an address is the
pair **(format descriptor, bytes)**, where a format descriptor is (width,
height, bits-per-channel ∈ {8, 16}, channels = 3, geometry ∈ {plane, sphere}).
Hex and decimal renderings are derived and non-normative.

### FD-001 — Exact primary guarantee

**DECIDED (founder, 2026-08-19).**

> UIA enables any party holding a format descriptor and either the exact
> address bytes or a derivation recipe (generator identifier and version, four
> 32-bit seed words, round count, signed offset) to materialise the exact
> address bytes of that format and to encode or decode them in the versioned
> address container, and independently verifying nodes — any conforming
> implementation, with no network, ledger, or trusted party — can establish by
> recomputation alone that a given (format descriptor, recipe) yields exactly
> one byte string, that a given container decodes to exactly one (format
> descriptor, bytes) pair or is rejected, and that these results agree with the
> published conformance vectors, under the assumptions that the format,
> generator, and container specifications are versioned and published with
> positive, boundary, and rejection vectors, and that recipes and addresses are
> public inputs with no confidentiality assumed; no finality, availability,
> uniqueness-of-recipe, authenticity, or time result is claimed.

Explicitly not claimed: that a byte string has only one recipe (distinct
seed/rounds/offset triples may reach the same bytes); that an address, recipe,
or container evidences who produced it, when, or that anyone else holds it;
that any implementation stores, serves, or preserves bytes; that screen pixels
are identical across renderers (only bytes and container bytes are
conformance-checked; the same bytes are a different picture as plane versus
sphere); or any ownership, authorship, identity, permanence, truth,
decentralization, or security property (§4). Freezing the specifications is a
G1 act (ADR-001), not an act of this ADR.

FD-001 is **neutral on D-002**: whether a derivation recipe is part of artifact
identity or only a derivation path remains OPEN for ADR-001
(`repr-artifact-identity`). The `.uia` container carries no provenance, so this
guarantee does not extend to recipe identity through the file.

Evidence available today is application evidence only (Charter §8), not gate
evidence: the M1 identity contract, the UIA2 container round-trip, and the
browser oracles recorded in `test/browser/README.md`. The founder MAY later
nominate the archive application as a candidate reference implementation, to
be judged against the frozen specification and immutable vectors
(`assurance-reference`); until then it remains application evidence.

### FD-002 — V1 capability matrix

**DECIDED (founder, 2026-08-19).** Decision cells are exactly one of
Required / Deferred / Excluded; re-entry conditions live in their own column.

| Capability | Decision | Exact V1 result if required | Re-entry trigger |
|---|---|---|---|
| Exact archive addressing and materialization | **Required** | From the same (format descriptor, recipe) every conforming implementation produces identical address bytes; from the same container bytes every conforming implementation decodes identical (format descriptor, bytes) or rejects; the container encoding of a given (format descriptor, bytes) is identical. Generator and container specifications are versioned; positive, boundary, and rejection vectors are published covering: format tuple; generator id + version; four uint32 seed words; the generator's counter/key layout; the declared round range (12–24; 11 and 25 rejected); signed offset including the safe-integer bound and wrap at both ends; expected bytes; expected 20-byte container header + payload; malformed containers (bad magic, truncation, header/payload length mismatch, bpc ∉ {8,16}, channels ≠ 3, zero width/height, non-integer offset); and the three decoder ambiguities decided rather than inherited (geometry field ∉ {0,1}, currently read as plane; reserved ≠ 0, currently ignored; legacy 16-byte UIA1, currently accepted as plane). At least two independently written implementations pass all vectors. No uniqueness, authenticity, confidentiality, storage, or availability result is included. | — |
| Authenticated media/registration claims | **Deferred** | — | A named ADR after Batch 4 resolves claim predicate, issuer authority, privacy/takedown, and redress |
| Transferable value or scarce assets | **Deferred** | — | FD-003 reopen |
| General-purpose or constrained programmable execution | **Excluded** | — | Requires reopening this ADR |
| Public permissionless block production/validation | **Deferred** | — | FD-003 reopen |

Under this matrix V1 uses only the raw raster bytes (`RawTile3072` is the
8 × 8 RGB16 instance of the general raster format; Charter §2.1 unchanged) and
the versioned address container. `BlockCommit512`, `VisualCommit3072`,
`CanonicalTranscriptV1`, and `WideTelemetry3072-v0` (Charter §2.2) have no V1
purpose and no V1 claim; Charter §3 rows other than "Raw visual namespace" are
not applicable to V1 and are neither proven nor claimed. Batch 5 vocabulary:
native token = **conditional** (on FD-003 reopen), not "none". The current
generator identifier `uia-philox4x32-image`/1, the UIA2 magic and header
layout, and the 12–24 round range are candidate inputs to ADR-001, **not**
frozen production identifiers (§8).

### FD-003 — Sovereign-chain necessity and kill criterion

**DECIDED (founder, 2026-08-19): option A+R; review date 2027-08-13; negative
necessity case accepted as satisfying the G0 "necessity case" requirement.**

> UIA requires a sovereign ledger because of one candidate property and no
> other: permissionless, censorship-resistant ordering of address-bound state
> whose security budget and governance are independent of any other chain — a
> property that no FD-002 Required V1 capability needs.
>
> **DEFERRED on acceptance:** no FD-002 Required capability needs
> permissionless ordering or native scarce value.
> **REOPENED for design only when BOTH** (a) a later accepted ADR promotes a
> capability to Required that needs that property, **and** (b) that ADR's
> Batch 2 requirement profile lists at least one §6 axis row fully filled
> (comparator + version, workload/adversary, metric, threshold, measurement
> method, expiry) that a transparency log with external checkpoints, a named
> existing L1/L2, and an application-specific rollup each fail by the stated
> metric — measured by a named reviewer who is not the author and recorded in
> `docs/protocol/CORRECTIONS.md`.
> **ABANDONED** (Charter §1 objective 2 changes from "active research" to
> "closed; re-entry requires a new ADR") at the first scheduled ADR-000 review
> on or after **2027-08-13**, if on that date no §6 axis row 2–6 is fully
> filled, or every filled row's reproducible measurement shows UIA ≤ comparator.
> **NARROWED** if a subset of axes survive. The review date is calendar-fixed
> and does not depend on a reopen.

This is a negative necessity case, accepted by the founder as such.

**Research track (the "R" in A+R).** The sovereign ledger is recorded as a
named research track with its own non-production, fail-closed gates, none of
which touches authoritative validation (Charter §4):

- **R0** — necessity case (`mission-sovereign-case`): negative today; the
  completion item "No-chain alternative compared" is not met and requires the
  comparator rows.
- **R1** — a Batch 2 requirement profile for the hypothetical Required
  capability.
- **R2** — a reproducible comparator measurement on a fully filled §6 axis row,
  by a named reviewer who is not the author.
- **R3** — a promotion ADR that flips an FD-002 row from Deferred to Required.

Each R-gate produces Observatory evidence only under `mission-sovereign-chain`
and `mission-sovereign-case`. Charter §1 objective 2 stays "active research"
until the review date acts. Existing 3,072-bit prototypes keep an experimental,
non-authoritative home under `govern-research`; they are not promoted by this
decision.

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

- [x] FD-001 supplies one exact primary guarantee (decided 2026-08-19).
- [x] FD-002 classifies every V1 capability (decided 2026-08-19).
- [x] FD-003 supplies a sovereign-chain necessity and kill criterion (decided 2026-08-19; negative case accepted; review 2027-08-13).
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
