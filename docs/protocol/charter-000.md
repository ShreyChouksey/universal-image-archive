# Charter-000: UIA-3072 Mission and Security Model

- **Status:** Draft v0.1
- **Date:** 2026-08-12
- **Scope:** The 3,072-bit archive representation and any future UIA ledger
- **Open decisions:** [open-decisions.md](./open-decisions.md)
- **Terminology:** [glossary.md](./glossary.md)

This charter records the principles that are sufficiently verified to guide the
next specifications. It does not select a consensus mechanism, monetary model,
state model, wire grammar, implementation library, or production launch plan.
Those choices remain explicitly open and must not be inferred from prototype
code.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** describe intended
requirements for later protocol specifications. This document remains a draft
until the open product and consensus decisions are accepted.

## 1. Mission

UIA has two related research objectives:

1. Preserve the exact, bijective archive representation in which a fixed-format
   image is its byte address.
2. Investigate a sovereign UIA ledger that can exceed existing networks on
   named, independently measurable axes, rather than claiming one universal
   number of “bits of security.”

The sovereign-ledger objective remains active. It is not yet a production
claim. A token, permissionless validation, proof of work, proof of stake, or BFT
committee MUST be justified by the state and security model rather than copied
from an existing chain.

## 2. Settled representation facts

### 2.1 RawTile3072

For the 8 × 8, 16-bit-per-channel RGB format, `RawTile3072` is exactly 384
bytes:

- 64 pixels;
- row-major pixel order;
- channel order R, G, B;
- each 16-bit channel encoded most-significant byte first.

The format therefore has exactly \(2^{3072}\) possible byte values. This is
representational cardinality. It is not collision resistance, signature
strength, proof-of-work security, entropy automatically present in a generated
tile, or consensus security.

### 2.2 Separate protocol types

The protocol MUST distinguish at least these roles:

| Type | Role | Security status |
|---|---|---|
| `RawTile3072` | Exact 384-byte image value/address | Representation, not a hash |
| `CanonicalTranscriptV1` | Typed, versioned and bounded protocol object | Encoding to be specified |
| `BlockCommit512` | Compact authoritative commitment identifier | Target: 256-bit classical generic collision resistance |
| `VisualCommit3072` | 384-byte standards-derived commitment rendered as an 8 × 8 RGB16 tile | Target: 256-bit generic security, not 3,072-bit security |
| `WideTelemetry3072-v0` | Output from experimental wide-state research | Non-authoritative; no security claim |

A raw tile MAY be an element of a canonical transcript. It is not the source of
every transcript: transactions, blocks, votes, key updates, and governance
objects are independently typed protocol objects.

`VisualCommit3072` occupies a typed subset of the raw 384-byte value space. Its
output length does not make it a bijection over all raw tiles and does not raise
the claimed generic strength of TupleHash256 above 256 bits.

## 3. Security targets

Security properties MUST be stated separately.

| Axis | Draft target | Required wording |
|---|---|---|
| Raw visual namespace | \(2^{3072}\) byte values | Exact representational space |
| Authoritative commitments | 256-bit classical generic collision target | Requires at least 512-bit outputs and a sound full construction |
| Generic preimage resistance | At least a 256-bit design target for the reference suite | Must identify the primitive and attack model |
| Transaction authentication | NIST security strength Category 5 candidate | Must not be converted into an exact guaranteed operation count |
| Consensus | Open | Must be described through safety, liveness, Sybil resistance, finality, and attack cost |
| Experimental wide construction | None | Research telemetry only |

A 512-bit root field is necessary but not sufficient for the collision target.
The eventual commitment ADR MUST also define canonical leaf encodings,
leaf-versus-node domain separation, tree shape, empty-tree behavior, odd-node
behavior, proof verification, and complete binding of body and authentication
data.

The standards reference candidate is TupleHash256 from NIST SP 800-185. Its
exact tuple elements, output lengths, customization strings, compact/visual
relationship, and test vectors remain ADR decisions. No implementation may
silently substitute SHA-512, SHA-256, a concatenation hash, or a prototype
fingerprint.

ML-DSA-87 is the current Category-5 authentication candidate. Selection is not
complete until the protocol specifies ML-DSA versus HashML-DSA, context and
domain rules, deterministic versus hedged signing policy, randomness profile,
public-key registration, key identifiers, rotation, recovery, revocation,
implementation requirements, and validation vectors.

## 4. Authoritative and research rails

Only the standards rail MAY influence authoritative validation.

The research rail MUST NOT influence:

- transaction or block acceptance;
- transaction or block identifiers;
- header bytes or commitment roots;
- state transitions, balances, rewards, or fees;
- fork choice, finality, validator votes, or difficulty;
- mandatory resource consumption by conforming nodes.

Research telemetry MUST be optional and computed over already canonical bytes.
Promotion requires a new versioned protocol decision, public specification,
independent analysis, known-answer vectors, independent implementations, and an
explicit activation rule. A bounty or an absence of known attacks is not a
security proof.

## 5. Object and data boundaries

A future block MUST logically separate:

1. a structured header;
2. a bounded body;
3. transaction authentication witnesses; and
4. any consensus certificate required by the selected consensus family.

No complete block, transaction, public key, signature, or certificate is
required to fit in a 384-byte tile. A 384-byte structured header is permitted if
a future ADR can justify it, but the same 384 bytes cannot simultaneously be an
arbitrary raw image, a parseable header, and a full hash output.

Authentication witnesses may be outside the header, but they MUST be bounded,
available, validated, and committed by the authoritative block commitment.
“External” MUST NOT mean optional or uncommitted.

Whether UIA needs separate semantic and witnessed transaction identifiers is
open. Hedged ML-DSA can produce different signer-generated signatures for the
same message, but this is not evidence of Bitcoin-style third-party signature
malleability. The transaction/state model must be chosen before ID semantics
are fixed.

## 6. Threat-model baseline

Specifications MUST assume hostile peers can submit malformed, ambiguous,
oversized, replayed, conflicting, or computationally expensive inputs.

At minimum, later threat models MUST cover:

- canonicalization and parser disagreement;
- signature forgery, replay, key compromise, loss, rotation, and downgrade;
- commitment collisions, second preimages, multi-target attacks, and malformed
  trees;
- resource exhaustion in codecs, execution, storage, GPU, and networking;
- equivocation, censorship, reorganization, eclipse, data withholding, and
  validator/miner collusion;
- upgrade, genesis, checkpoint, and recovery governance;
- classical and quantum attack models as separate analyses.

## 7. Claims policy

Until the relevant gates pass, UIA MUST NOT claim:

- “3,072-bit cryptographic security”;
- “3,072-bit collision, preimage, signature, or consensus security”;
- a production post-quantum chain;
- proven ASIC resistance or memory hardness;
- a secure STARK, zero-knowledge proof, or cryptographic Merkle tree from the
  current prototypes;
- superiority to Bitcoin, Ethereum, Solana, or TRON as a whole.

UIA MAY accurately state:

- the exact \(2^{3072}\) state space of `RawTile3072`;
- that a specified 3,072-bit TupleHash256 output is renderable as a UIA tile;
- the 256-bit generic security claim of the selected standards construction,
  once correctly implemented and tested;
- Category-5 authentication as a design target, until implemented and
  independently validated;
- targeted superiority only on measured, named axes.

## 8. Specification gates

No new production consensus behavior may be implemented before:

1. the open mission, state, token, and consensus decisions are resolved;
2. ADR-001 fixes the canonical object grammar and rejection behavior;
3. ADR-002 fixes the authoritative and visual commitment constructions;
4. ADR-003 fixes authentication and key lifecycle;
5. positive and negative vectors are produced;
6. at least two independent implementations agree on every vector.

The consensus header and body ADR follows those decisions. Prototype code may
be tested and studied, but it MUST remain clearly experimental and fail closed
at every missing authorization or consensus boundary.

## 9. References

- [NIST FIPS 202: SHA-3 and SHAKE](https://doi.org/10.6028/NIST.FIPS.202)
- [NIST SP 800-185: cSHAKE, KMAC, TupleHash, and ParallelHash](https://doi.org/10.6028/NIST.SP.800-185)
- [NIST FIPS 204: ML-DSA](https://doi.org/10.6028/NIST.FIPS.204)
- [NIST FIPS 205: SLH-DSA](https://doi.org/10.6028/NIST.FIPS.205)
- [3,072-bit experimental subsystem plan](../3072-subsystem-plan.md)
