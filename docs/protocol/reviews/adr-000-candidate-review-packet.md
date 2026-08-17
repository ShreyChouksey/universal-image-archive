# ADR-000 Candidate Review Packet: Narrow Artifact-Output Ledger

- **Status:** REVIEW CANDIDATE — NON-NORMATIVE
- **Date:** 2026-08-13
- **For review by:** Founder, AG, independent protocol reviewers
- **May not resolve:** D-001, D-002, D-003, D-004, D-005, or any gate
- **Normative draft:** [ADR-000](../adr-000-protocol-outcome-and-sovereign-ledger-requirements.md)

## Review instruction

For every statement below, mark **ACCEPT**, **REJECT**, or **NEEDS FOUNDER
DECISION**. A rejection must name the violated requirement or give a concrete
counterexample. Passing tests or similarity to another chain is not acceptance
evidence.

## 1. Candidate synthesis

The proposed direction is:

> Bitcoin-shaped purpose and state scope; Ethereum-grade deterministic
> transition, resource accounting, typed evolution, and upgrade discipline;
> UIA-native artifact identity; no general-purpose virtual machine in V1.

This imports design lessons, not Bitcoin's monetary constants, Ethereum's EVM,
or either system's cryptographic and consensus choices.

## 2. Candidate FD-001 — primary guarantee

> UIA enables participants to create authenticated, canonically ordered records
> and transfer uniquely consumable protocol capabilities bound to exact,
> versioned UIA artifact identifiers, while independent validating nodes
> establish that every accepted transition is canonically encoded, authorized,
> non-replayed, unique where exclusivity applies, and produces the same
> committed state under the selected cryptographic, data-availability, network,
> and consensus fault assumptions.

This candidate does **not** claim that UIA proves:

- the first real-world creation of an artifact;
- creator identity, authorship, copyright, legal title, or non-infringement;
- the truth of an authenticated assertion;
- permanent availability of referenced bytes; or
- finality beyond the exact later-selected finality predicate.

## 3. Candidate FD-002 — V1 scope

| Capability | Candidate | Exact boundary |
|---|---|---|
| Exact archive addressing/materialization | **Required** | Existing mathematical archive remains Layer 0; chain records use a separately versioned ArtifactID profile. |
| Authenticated media assertions | **Required, narrow** | The protocol proves that an authorized key asserted typed bytes and their chain ordering; it does not prove external truth. |
| Artifact-bound scarce state | **Required** | A uniquely consumable capability may reference one ArtifactID and move only through authorized state transitions. |
| Native fungible currency | **Conditional** | Required only if the later consensus/security/resource model demonstrates an indispensable function. |
| Constrained protocol operations | **Required** | Fixed, typed, bounded transitions with deterministic reads, writes, cost, and errors. |
| Arbitrary user-deployed execution | **Excluded from V1** | No EVM/WASM, bytecode, dynamic calls, recursion, reentrancy, or arbitrary contract storage. |
| Independent full validation | **Required** | Any conforming full node can recompute validity and state from the accepted bootstrap. |
| Permissionless block production | **Proposed required** | No identity allowlist; eligibility follows the later-selected Sybil-resistance rule. Founder acceptance is required. |

## 4. Candidate FD-003 — sovereign necessity

> UIA requires a sovereign ledger if neutral canonical ordering and uniquely
> consumable transfer of artifact-bound protocol objects must be independently
> verifiable under UIA's own security, availability, upgrade, and
> censorship-resistance policy rather than another chain's consensus, fee
> asset, sequencer, bridge, governance, or upgrade policy.

Candidate kill criterion:

> Defer or narrow the sovereign ledger if a signed log, existing L1/L2, or
> application-specific rollup meets every accepted UIA safety, availability,
> censorship, latency, cost, and artifact-semantics requirement under the same
> adversarial workload; or if the UIA testnet cannot meet its named
> participation, fault, availability, performance, and sustainable-security
> thresholds while demonstrating a material advantage on at least one
> indispensable axis.

Numerical thresholds remain Founder Decision Batch 2. They must not be invented
inside a consensus or implementation ADR.

## 5. Candidate narrow state

The candidate is a deliberately small hybrid rather than the existing
account/nullifier prototype:

```text
State = {
  artifactOrigins: authenticated set of previously registered ArtifactIDs,
  artifactRecords: append-only typed artifact references,
  assertions: append-only authenticated assertions and status links,
  capabilities: uniquely consumable artifact-bound outputs,
  keyState: key epochs, delegation, rotation, recovery and revocation,
  valueOutputs: optional, only if D-004 selects a native fungible unit
}
```

Candidate V1 operation families:

1. `REGISTER_ARTIFACT`
2. `ISSUE_ASSERTION`
3. `SUPERSEDE_OR_REVOKE_ASSERTION`
4. `CREATE_ARTIFACT_CAPABILITY`
5. `TRANSFER_ARTIFACT_CAPABILITY`
6. `ROTATE_OR_REVOKE_KEY`
7. optional `TRANSFER_VALUE`, only after D-004
8. bounded atomic `BATCH`, with no dynamic calls and no cycles

Core invariants:

- an input or capability is consumed at most once;
- every transition satisfies its exact authorization condition;
- replay protection binds domain, chain, protocol, operation and key epoch;
- one exact typed ArtifactID has at most one origin registration;
- transfer consumes exactly one capability and creates exactly one successor
  for the identical ArtifactID;
- no operation silently changes an ArtifactID or assertion predicate;
- assertions are corrected by explicit supersession/revocation records, never
  by rewriting history;
- value is conserved except for explicitly specified issuance or burn;
- all bytes, lists, witnesses, reads, writes, durable growth and verification
  work are bounded;
- the state transition is deterministic and atomic; and
- validators compute roots and compare them with immutable commitments rather
  than rewriting a previously accepted header.

## 6. Ethereum lessons retained without an EVM

- Define a total transition:

  ```text
  apply(preState, typedOperation, validatedWitness, context)
      -> accept(postState, receipt) | reject(canonicalReason)
  ```

- Separate execution validity from the later Sybil/consensus mechanism.
- Use typed, versioned operations; new types never reinterpret old bytes.
- Bind the type and complete canonical meaning into authorization and
  commitments.
- Meter resource dimensions independently: canonical bytes, cryptographic
  verification, state reads, state writes, durable state growth, availability
  bytes and network bytes.
- Fix per-operation, per-transaction and per-block limits in versioned profiles.
- Activate upgrades explicitly and test migrations, downgrade rejection and
  cross-version replay.

Resource metering does not itself require a token. Fees, quotas, deposits,
external payment or protocol issuance are later economic choices.

## 7. Retrofit boundary

This is an architectural retrofit with a clean production namespace, not a
promotion of the existing prototypes.

Preserve:

- the archive UI, renderer, address walking and materialization;
- `format.ts` and `address.ts` representation mathematics;
- `.uia` application containers as non-protocol files;
- `RawTile3072` as one exact representation profile;
- Charter-000, ADR-000, ADR-001, the decision register and Observatory; and
- Philox96/GPU work only as research or visualization evidence.

Replace for production:

- `BlockContainer384` with separate immutable header, bounded body, witnesses
  and consensus certificate;
- `Tx384` with typed operations derived from the accepted state model;
- account balances plus arbitrary nullifiers with an accepted output/object
  model;
- deterministic fingerprints with reviewed, domain-separated commitments;
- bespoke key/proof helpers with the accepted authentication/key-lifecycle
  profile;
- copied issuance constants with an economics/security-budget decision;
- prototype PoW/sparsity with the later-selected consensus mechanism; and
- callback gossip with a bounded node transport, admission pipeline, mempool,
  synchronization and durable storage.

Proposed clean boundary:

```text
src/protocol/
  codec/
  model/
  crypto/
  state/
  consensus/   # empty until G4 selects a mechanism
  node/        # later operational work

test/protocol/
  vectors/
  codec/
  state/
  differential/
```

Legacy block, transaction, proof and mining bytes receive no production decoder
or automatic upgrade. There is no deployed chain history or balance state to
migrate; production genesis can begin cleanly.

## 8. Required challenges for AG and reviewers

1. Is authenticated assertion plus artifact capability sufficient to justify a
   sovereign L1, or can a log/existing L1/rollup satisfy it?
2. Is transferable artifact-bound state indispensable to UIA's primary outcome?
3. Should native value and artifact capabilities be separate output types?
4. Is an output-plus-origin-registry model the narrowest state satisfying the
   accepted guarantee?
5. What exact object identifies media: source bytes, canonical pixels,
   `RawTile3072`, coordinate/seed, or a typed combination?
6. What availability obligation applies to the full artifact bytes?
7. What exact predicates may authenticated assertions express?
8. Is permissionless production required, or only independent validation?
9. What measurable result kills the sovereign-chain branch?
10. Is PQ authentication a V1 requirement or a migration requirement?
11. Can an attacker front-run an artifact registration, exhaust the namespace,
    exploit equivalent representations, or turn recovery governance into
    confiscation?
12. Which candidate invariant cannot be tested by two independent transition
    implementations?

## 9. Decision state

This packet records a candidate, not a choice. Until Founder Decision Batch 1
accepts or edits Sections 2–4:

- ADR-000 remains `DRAFT`;
- D-001 remains open;
- production schemas and identifiers remain unassigned; and
- the Observatory remains `0 / 11`.
