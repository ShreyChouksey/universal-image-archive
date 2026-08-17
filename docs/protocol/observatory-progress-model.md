# Protocol Observatory Progress Model

- **Status:** WORKING MODEL — NON-NORMATIVE
- **Date:** 2026-08-13
- **Applies to:** the in-app Protocol Observatory and project planning only
- **Does not define:** protocol validity, consensus, security, activation, or production readiness

## Purpose

The Observatory makes unresolved work visible without turning activity into a
security claim. It indexes the current working tree, draft protocol documents,
prototype evidence, open decisions, and explicit completion tests.

The model intentionally provides no overall percentage, security-bit total, or
single maturity score. Representation size, collision resistance, signature
forgery, consensus capture, availability, economics, implementation compromise,
and operational recovery are independent properties.

## Status vocabulary

| Status | Meaning |
|---|---|
| `Verified` | The narrowly stated fact has direct mathematical, code, or test evidence. |
| `Recorded` | An objective or policy boundary is documented; feasibility and security are not proven. |
| `Active` | Drafting or implementation work is underway. |
| `Open` | A required decision is deliberately unresolved. |
| `Blocked` | An upstream decision, specification, or artifact is missing. |
| `Conditional` | Required only if its architecture branch is selected. |
| `Experimental` | Prototype or research evidence only; never authoritative. |
| `Queued` | Necessary later after named dependencies exist. |

These statuses apply only to each card's exact objective and evidence boundary.
They are not interchangeable with “secure,” “complete,” “audited,” or
“production-ready.”

## Proposed G0–G10 planning stages

The displayed stages are a proposed project-management model, not adopted
protocol law and not a strictly linear dependency graph. Consensus, timing,
network behavior, availability/storage, and cryptoeconomics are deliberately a
coupled co-design stage. Work can move backward when evidence invalidates an
assumption.

| Stage | Planning question |
|---|---|
| G0 Guarantee | Is a sovereign chain necessary, and are mission, adversaries, product predicates, privacy duties, and measurable targets explicit? |
| G1 Grammar | Are canonical bytes, limits, schemas, and rejection vectors frozen? |
| G2 Crypto | Are authoritative commitment and authentication profiles specified and independently reproduced? |
| G3 State | Is execution deterministic, bounded, authorized, and reproducible? |
| G4 Co-design | Do consensus, timing, network, storage/availability, and economics satisfy one safety/liveness/resource model? |
| G5 Governance | Are genesis, upgrades, emergency powers, and launch governance explicit? |
| G6 Reference | Does one traceable implementation conform to immutable specifications and vectors? |
| G7 Operations | Is node lifecycle crash-safe and is the release supply chain reproducible and governed? |
| G8 Independent | Do independent implementation, adversarial parity, and scoped reviews resolve critical/high findings? |
| G9 Testnet | Does a sustained multi-actor testnet survive partitions, reorgs, upgrades, halts, and recovery? |
| G10 Launch | Is there an explicit genesis/launch decision with named residual risks, authorities, monitoring, and abort/recovery procedures? |

A stage result is one of `active`, `blocked`, `pass`, or `stale`. A pass applies
only to the cited specification and implementation revisions. A material change
to grammar, cryptography, state transition, consensus, timing, economics, or
network assumptions makes dependent evidence stale until revalidated.

## Evidence boundary

Every card must state:

1. the exact property or objective in scope;
2. the artifact, specification version, or code revision cited;
3. the assurance source and assumptions;
4. what was and was not covered;
5. unresolved findings and completion criteria; and
6. the change condition that expires the evidence.

“Unit tests,” “formal,” “model checked,” “independent implementation,”
“testnet,” “audit,” and “operational” are evidence descriptors, never security
warranties. Independent clients must agree on rejecting adversarial objects and
fork-identical behavior, not only happy-path interoperability.

## Reproducibility and measured numbers

Evidence recorded after checkpoint `ad60742` and cited by a card, a stage
result, or the correction ledger must be reproducible by a named command or a
cited source line from a committed revision cited by SHA, with the observed
result recorded beside it. Cards whose evidence boundary still reads
"revision: current working tree" predate this rule; they are not thereby
wrong, and each is migrated to a SHA-cited entry the next time its evidence is
touched rather than in one sweep. When a
second party has reproduced a measurement cold from the same SHA, that
reproduction is recorded beside it; it confirms the measurement and upgrades
no status. When independent auditors report divergent values for one property,
the divergence is recorded as unresolved and values are neither averaged nor
selected; unfixtured numbers that appear in no repository file cannot be cited.
Passing counts are run evidence and never raise a card. Working detail,
including quarantine and integration rules, lives in
[evidence-and-integration-discipline.md](./evidence-and-integration-discipline.md)
(non-normative).

## Relationship to normative work

Normative decisions remain in accepted ADRs and protocol specifications. The
Observatory may point to those artifacts, but it cannot accept an ADR, activate
a version, resolve a decision, or declare production by changing a UI status.
The current ADR-001 remains `PROPOSED`; therefore D-006 remains `OPEN` and G1
has not passed.
