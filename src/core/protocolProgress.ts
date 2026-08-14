/**
 * Evidence-backed protocol progress model for the in-app Observatory.
 *
 * This is a status index, not a source of consensus rules. Normative protocol
 * language lives in docs/protocol. A UI item may say that a prototype exists;
 * it must never upgrade that activity into specification or security evidence.
 */

export type ProtocolStatus =
  | 'verified'
  | 'recorded'
  | 'active'
  | 'open'
  | 'blocked'
  | 'conditional'
  | 'experimental'
  | 'queued';

export type ProtocolApplicability = 'required' | 'conditional' | 'undecided';

export interface ProtocolArea {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly axes: {
    readonly specification: string;
    readonly implementation: string;
    readonly verification: string;
    readonly deployment: string;
    readonly risk: string;
  };
}

export interface ProtocolWorkItem {
  readonly id: string;
  readonly areaId: string;
  readonly title: string;
  readonly status: ProtocolStatus;
  readonly applicability: ProtocolApplicability;
  readonly gate: string;
  readonly objective: string;
  readonly why: string;
  readonly evidence: readonly string[];
  readonly evidenceBoundary: string;
  readonly dependencies: readonly string[];
  readonly completion: readonly string[];
}

export interface ProtocolGate {
  readonly id: string;
  readonly label: string;
  readonly status: 'pass' | 'active' | 'blocked' | 'stale';
  readonly requirement: string;
}

export interface OpenProtocolDecision {
  readonly id: string;
  readonly title: string;
  readonly areaId: string;
  readonly blocks: string;
  readonly relatedWorkItemId: string;
}

export const PROTOCOL_SOURCE_REVISION =
  'Checkpoint evidence index · ADR-000 draft · Charter-000 draft v0.1 · ADR-001 proposed';

export const PROTOCOL_EVIDENCE_POLICY =
  'Every status is scoped to its cited artifact and current revision. A material upstream change makes dependent evidence stale; no badge is a security warranty. Evidence entries are hand-authored citations, not machine-verified results; no badge is produced by a test run.';

export const PROTOCOL_STATUSES: ReadonlyArray<{
  id: ProtocolStatus;
  label: string;
  meaning: string;
}> = [
  { id: 'verified', label: 'Verified', meaning: 'A scoped fact or boundary has direct evidence.' },
  { id: 'recorded', label: 'Recorded', meaning: 'An objective or policy boundary is documented, not proven feasible or secure.' },
  { id: 'active', label: 'Active', meaning: 'Specification or implementation work is underway.' },
  { id: 'open', label: 'Open', meaning: 'A decision is deliberately unresolved.' },
  { id: 'blocked', label: 'Blocked', meaning: 'An upstream decision or gate is missing.' },
  { id: 'conditional', label: 'Conditional', meaning: 'Required only if this architecture branch is selected.' },
  { id: 'experimental', label: 'Experimental', meaning: 'Prototype or research evidence; never authoritative.' },
  { id: 'queued', label: 'Queued', meaning: 'Necessary later, after its dependencies pass.' },
];

export const PROTOCOL_AREAS: readonly ProtocolArea[] = [
  {
    id: 'mission',
    label: 'Mission & threat model',
    shortLabel: 'Mission',
    description: 'Guarantees, non-guarantees, adversaries, trust boundaries, and measurable superiority axes.',
    axes: { specification: 'Draft', implementation: 'N/A', verification: 'Internal review', deployment: 'None', risk: 'Open' },
  },
  {
    id: 'representation',
    label: 'Representation & identity',
    shortLabel: 'Representation',
    description: 'Raw images, coordinates, identifiers, numeric ranges, profiles, and exact byte meaning.',
    axes: { specification: 'Draft', implementation: 'Archive foundation only', verification: 'Archive tests only', deployment: 'Protocol: none', risk: 'Open' },
  },
  {
    id: 'grammar',
    label: 'Canonical grammar',
    shortLabel: 'Grammar',
    description: 'One bounded byte language for every signed, committed, transmitted, and stored object.',
    axes: { specification: 'Proposed', implementation: 'Absent', verification: 'Vectors planned', deployment: 'None', risk: 'Open' },
  },
  {
    id: 'commitments',
    label: 'Commitments & cryptography',
    shortLabel: 'Commitments',
    description: 'Hash/XOF suite, domain separation, trees, randomness, algorithm agility, and security targets.',
    axes: { specification: 'No authoritative profile', implementation: 'Unrelated legacy prototype', verification: 'No protocol verification', deployment: 'None', risk: 'Blocking' },
  },
  {
    id: 'authentication',
    label: 'Authentication & keys',
    shortLabel: 'Authentication',
    description: 'Signatures, authorization, replay protection, custody, recovery, rotation, and PQ migration.',
    axes: { specification: 'No authoritative profile', implementation: 'Fail-closed private prototype', verification: 'No public-auth verification', deployment: 'None', risk: 'Blocking' },
  },
  {
    id: 'state',
    label: 'State & execution',
    shortLabel: 'State',
    description: 'State model, deterministic transitions, execution bounds, receipts, atomicity, and reorg behavior.',
    axes: { specification: 'Absent', implementation: 'Prototype', verification: 'Unit tests', deployment: 'None', risk: 'Blocking' },
  },
  {
    id: 'consensus',
    label: 'Ordering & consensus',
    shortLabel: 'Consensus',
    description: 'Sybil resistance, selection, fork choice, finality, timing, partitions, and mechanism branches.',
    axes: { specification: 'Absent', implementation: 'PoW experiment', verification: 'Smoke tests', deployment: 'None', risk: 'Blocking' },
  },
  {
    id: 'economics',
    label: 'Economics & resources',
    shortLabel: 'Economics',
    description: 'Token necessity, issuance, fees, rewards, spam pricing, MEV, supply, and security budget.',
    axes: { specification: 'Absent', implementation: 'Bitcoin-shaped prototype', verification: 'Unit tests', deployment: 'None', risk: 'Blocking' },
  },
  {
    id: 'network',
    label: 'Network & availability',
    shortLabel: 'Network',
    description: 'Framing, discovery, gossip, mempool, sync, data availability, storage, abuse controls, and recovery.',
    axes: { specification: 'Exploratory notes', implementation: 'Callback-only prototype', verification: 'Structural unit tests', deployment: 'None', risk: 'Blocking' },
  },
  {
    id: 'governance',
    label: 'Governance & upgrades',
    shortLabel: 'Governance',
    description: 'Decision rights, genesis, activation, migrations, emergency powers, releases, and accountability.',
    axes: { specification: 'Draft boundary', implementation: 'Absent', verification: 'None', deployment: 'None', risk: 'Open' },
  },
  {
    id: 'operations',
    label: 'Node operations & releases',
    shortLabel: 'Operations',
    description: 'Crash consistency, databases, snapshots, recovery, RPC safety, reproducible releases, and supply-chain integrity.',
    axes: { specification: 'Absent', implementation: 'No protocol node', verification: 'None', deployment: 'None', risk: 'Blocking' },
  },
  {
    id: 'assurance',
    label: 'Implementation & assurance',
    shortLabel: 'Assurance',
    description: 'Traceability, independent implementations, fuzzing, formal work, audit, testnet, and operations.',
    axes: { specification: 'Draft planning model', implementation: 'Prototype suite only', verification: 'No protocol conformance', deployment: 'None', risk: 'Blocking' },
  },
];

export const PROTOCOL_GATES: readonly ProtocolGate[] = [
  { id: 'G0', label: 'Guarantee', status: 'active', requirement: 'Sovereign-chain necessity, mission, threat model, measurable targets, and non-guarantees accepted.' },
  { id: 'G1', label: 'Grammar', status: 'active', requirement: 'Canonical grammar frozen with positive and rejection vectors.' },
  { id: 'G2', label: 'Crypto', status: 'blocked', requirement: 'Commitment and authentication profiles specified and independently reproduced.' },
  { id: 'G3', label: 'State', status: 'blocked', requirement: 'Deterministic transition specification and machine-checkable invariants.' },
  { id: 'G4', label: 'Co-design', status: 'blocked', requirement: 'Consensus, timing, network, storage/availability, and cryptoeconomics jointly satisfy one safety/liveness/resource model.' },
  { id: 'G5', label: 'Govern', status: 'blocked', requirement: 'Genesis, upgrades, emergency powers, and launch governance are specified and rehearsable.' },
  { id: 'G6', label: 'Reference', status: 'blocked', requirement: 'One conforming reference implementation with traceability and immutable fixtures.' },
  { id: 'G7', label: 'Operate', status: 'blocked', requirement: 'Crash-safe node lifecycle and reproducible, signed release supply chain are demonstrated.' },
  { id: 'G8', label: 'Indep.', status: 'blocked', requirement: 'Independent implementation/review and adversarial rejection parity resolve all critical/high findings.' },
  { id: 'G9', label: 'Testnet', status: 'blocked', requirement: 'Sustained multi-actor testnet passes halt, partition, reorg, upgrade, and recovery rehearsals.' },
  { id: 'G10', label: 'Launch', status: 'blocked', requirement: 'Genesis and launch-readiness decision names residual risks, authorities, monitoring, and abort/recovery procedures.' },
];

export const OPEN_PROTOCOL_DECISIONS: readonly OpenProtocolDecision[] = [
  { id: 'D-001', title: 'Primary protocol outcome', areaId: 'mission', blocks: 'State model and charter adoption', relatedWorkItemId: 'mission-primary-outcome' },
  { id: 'D-002', title: 'Artifact identity', areaId: 'representation', blocks: 'Grammar and claim semantics', relatedWorkItemId: 'repr-artifact-identity' },
  { id: 'D-003', title: 'State model', areaId: 'state', blocks: 'Transactions, execution, and identifiers', relatedWorkItemId: 'state-model' },
  { id: 'D-004', title: 'Token purpose', areaId: 'economics', blocks: 'Economics, consensus, and genesis', relatedWorkItemId: 'economics-token' },
  { id: 'D-005', title: 'Consensus and finality family', areaId: 'consensus', blocks: 'Header, certificates, and fork choice', relatedWorkItemId: 'consensus-choice' },
  { id: 'D-006', title: 'Canonical binary grammar', areaId: 'grammar', blocks: 'ADR-001 and every identifier', relatedWorkItemId: 'grammar-adr' },
  { id: 'D-007', title: 'Authoritative commitment suite', areaId: 'commitments', blocks: 'ADR-002 and chain links', relatedWorkItemId: 'commit-suite' },
  { id: 'D-008', title: 'State, body, and witness trees', areaId: 'commitments', blocks: 'ADR-002 and execution', relatedWorkItemId: 'commit-trees' },
  { id: 'D-009', title: 'Authentication profile', areaId: 'authentication', blocks: 'ADR-003 and transaction verification', relatedWorkItemId: 'auth-profile' },
  { id: 'D-010', title: 'Key lifecycle', areaId: 'authentication', blocks: 'ADR-003 and account/identity model', relatedWorkItemId: 'auth-key-lifecycle' },
  { id: 'D-011', title: 'Transaction identifier model', areaId: 'authentication', blocks: 'ADR-003 and body commitments', relatedWorkItemId: 'auth-tx-identifiers' },
  { id: 'D-012', title: 'Resource and availability limits', areaId: 'network', blocks: 'ADR-004 and DoS model', relatedWorkItemId: 'grammar-limits' },
  { id: 'D-013', title: 'Genesis and upgrade governance', areaId: 'governance', blocks: 'Consensus and interoperability', relatedWorkItemId: 'govern-genesis' },
  { id: 'D-014', title: 'Privacy, retention, and takedown', areaId: 'mission', blocks: 'Product semantics and storage', relatedWorkItemId: 'mission-privacy' },
  { id: 'D-015', title: 'Research promotion criteria', areaId: 'governance', blocks: 'Any authoritative wide-state use', relatedWorkItemId: 'govern-research' },
];

const item = (
  value: Omit<ProtocolWorkItem, 'evidenceBoundary'> & { readonly evidenceBoundary?: string },
): ProtocolWorkItem => ({
  evidenceBoundary:
    'Scope/property: stated item and citations only · revision: current working tree · assurance: internal unless named · coverage: cited checks only · unresolved: completion checklist · expires on material upstream change',
  ...value,
});

export const PROTOCOL_WORK_ITEMS: readonly ProtocolWorkItem[] = [
  item({ id: 'mission-charter', areaId: 'mission', title: 'Charter-000', status: 'active', applicability: 'required', gate: 'G0', objective: 'Freeze the mission, security axes, claim boundaries, and research isolation rules.', why: 'Every downstream protocol decision depends on what UIA promises and what it explicitly does not promise.', evidence: ['docs/protocol/charter-000.md · draft v0.1'], dependencies: [], completion: ['Open product decisions are resolved', 'Threat assumptions are reviewed', 'Charter status is accepted'] }),
  item({ id: 'mission-primary-outcome', areaId: 'mission', title: 'Primary protocol outcome', status: 'active', applicability: 'required', gate: 'G0', objective: 'Choose the exact combination of archive addressing, signed claims, transferable value/state, and general execution UIA will provide.', why: 'A protocol cannot choose state, authentication, consensus, economics, or privacy safely until its product predicate is explicit.', evidence: ['D-001', 'docs/protocol/adr-000-protocol-outcome-and-sovereign-ledger-requirements.md · draft, founder decisions required', 'Charter-000 §7 · open'], dependencies: ['mission-charter'], completion: ['Exact user-visible predicate accepted', 'Non-goals and alternatives recorded', 'Every downstream object has a stated purpose'] }),
  item({ id: 'mission-security-axes', areaId: 'mission', title: 'Security axes separated', status: 'recorded', applicability: 'required', gate: 'G0', objective: 'Track representation, collision, preimage, authentication, consensus, and economics independently.', why: 'Bit widths and unrelated security properties cannot be added into one system score.', evidence: ['Charter-000 §3 · draft doctrine', 'NIST SP 800-185', 'FIPS 204'], dependencies: [], completion: ['Terminology recorded', 'UI status model avoids aggregate score'] }),
  item({ id: 'mission-threat-model', areaId: 'mission', title: 'Adversary and failure model', status: 'active', applicability: 'required', gate: 'G0', objective: 'Specify key, node, economic, network, clock, supply-chain, and governance adversaries.', why: 'Safety claims are meaningless without the attacker capabilities and failure assumptions they survive.', evidence: ['Charter-000 §6 · baseline only'], dependencies: ['mission-charter'], completion: ['Capabilities enumerated', 'Fault thresholds selected', 'Classical and quantum models separated'] }),
  item({ id: 'mission-sovereign-chain', areaId: 'mission', title: 'Sovereign UIA ledger objective', status: 'recorded', applicability: 'required', gate: 'G0', objective: 'Keep a sovereign ledger as an active research objective without claiming a production chain.', why: 'The objective is deliberate; the mechanism and economics remain design work.', evidence: ['Charter-000 §1 · draft objective'], dependencies: [], completion: ['Objective recorded without selecting PoW, PoS, or BFT'] }),
  item({ id: 'mission-sovereign-case', areaId: 'mission', title: 'Sovereign-chain necessity and superiority targets', status: 'active', applicability: 'required', gate: 'G0', objective: 'Name the indispensable need for native ordering/economic security and the exact axes UIA intends to surpass.', why: 'A sovereign chain is a costly security architecture, not a maturity badge; measurable axis-by-axis goals prevent vague superiority claims.', evidence: ['Charter-000 §1 and §3 · partial', 'User reaffirmed sovereign-chain research objective'], dependencies: ['mission-sovereign-chain', 'mission-threat-model'], completion: ['Native scarce-value or permissionless-ordering need explicit', 'No-chain alternative compared', 'Targets and measurement methods accepted'] }),
  item({ id: 'mission-slos', areaId: 'mission', title: 'Latency, throughput, storage, and cost targets', status: 'open', applicability: 'required', gate: 'G0', objective: 'Set measurable service and protocol targets before choosing mechanisms.', why: 'Marketing TPS cannot substitute for bounded workloads and finality requirements.', evidence: ['No accepted target yet'], dependencies: ['mission-charter'], completion: ['Workload model accepted', 'Finality and availability SLOs accepted', 'Cost envelope accepted'] }),
  item({ id: 'mission-claim-semantics', areaId: 'mission', title: 'Claim and provenance semantics', status: 'open', applicability: 'undecided', gate: 'G0', objective: 'If UIA carries media claims, define the exact predicate: registration, key assertion, verified identity, authorship, license, or legal ownership.', why: 'A signature over an image identifier cannot decide what the assertion means or whether it is true in the real world.', evidence: ['D-001 unresolved', 'No accepted claim schema'], dependencies: ['mission-primary-outcome'], completion: ['Predicate vocabulary and non-guarantees accepted', 'Time semantics separated', 'Verification result wording fixed'] }),
  item({ id: 'mission-issuer-authority', areaId: 'mission', title: 'Issuer identity, assurance, and authority', status: 'blocked', applicability: 'undecided', gate: 'G0', objective: 'If claims exist, define issuer IDs, assurance levels, accreditation, delegation, authority scopes, and loss/compromise consequences.', why: 'Key possession authenticates a key, not a person, organization, authorship right, or legal authority.', evidence: ['No issuer/authority model'], dependencies: ['mission-claim-semantics'], completion: ['Authority source and scope modeled', 'Delegation/revocation verified at evaluation time', 'Identity assurance never overstated'] }),
  item({ id: 'mission-privacy', areaId: 'mission', title: 'Privacy, retention, and takedown policy', status: 'open', applicability: 'required', gate: 'G0', objective: 'Define public metadata, encrypted/private data, linkability, retention, deletion, revocation, supersession, and availability obligations.', why: 'Digest-only records can still identify private content, while irreversible publication can conflict with takedown and privacy duties.', evidence: ['D-014', 'No accepted privacy/content-governance profile'], dependencies: ['mission-primary-outcome'], completion: ['Data classification and retention schedule accepted', 'Takedown versus immutable-history semantics explicit', 'Privacy threat model reviewed'] }),
  item({ id: 'mission-redress', areaId: 'mission', title: 'Disputes, corrections, and redress', status: 'blocked', applicability: 'undecided', gate: 'G0', objective: 'If claims exist, define challenge, correction, revocation, supersession, abuse reporting, adjudication authority, and appeal evidence.', why: 'Immutable inclusion is not truth and does not resolve competing authorship, fraud, or legal claims.', evidence: ['No dispute or correction model'], dependencies: ['mission-claim-semantics', 'mission-issuer-authority', 'mission-privacy'], completion: ['State machine and authorities accepted', 'Conflicting claims remain auditable', 'Abuse and appeal procedures defined'] }),

  item({ id: 'repr-raw-tile', areaId: 'representation', title: 'RawTile3072 exact encoding', status: 'verified', applicability: 'required', gate: 'G0', objective: 'Fix 8 × 8 RGB16 as 384 row-major bytes with big-endian channels.', why: 'This is the exact representation behind the 2^3072 archive cardinality.', evidence: ['src/core/address.ts', 'Charter-000 §2.1', 'Archive round-trip tests'], dependencies: [], completion: ['Encoding and cardinality directly verified'] }),
  item({ id: 'repr-cardinality', areaId: 'representation', title: 'Cardinality is not security', status: 'verified', applicability: 'required', gate: 'G0', objective: 'Preserve the 2^3072 representation claim without converting it into cryptographic strength.', why: 'A large namespace does not automatically produce entropy, collision resistance, signatures, or consensus.', evidence: ['Charter-000 §2', 'Protocol glossary'], dependencies: ['repr-raw-tile'], completion: ['Claim boundary recorded and displayed'] }),
  item({ id: 'repr-coordinate', areaId: 'representation', title: 'Coordinate versus full address', status: 'verified', applicability: 'required', gate: 'G0', objective: 'Keep the 128-bit generator coordinate distinct from the full raw image address.', why: 'Deterministic expansion reaches only a subset and cannot create entropy.', evidence: ['src/core/address.ts', 'UI lane labels'], dependencies: [], completion: ['Types and UI language remain distinct'] }),
  item({ id: 'repr-artifact-identity', areaId: 'representation', title: 'Artifact identity profile', status: 'open', applicability: 'required', gate: 'G1', objective: 'Define source-file, canonical-pixel, raw-tile, generated-address, and claim identifiers.', why: 'Different representations answer different questions and must not collide semantically.', evidence: ['D-002'], dependencies: ['grammar-envelope', 'mission-primary-outcome', 'mission-privacy'], completion: ['Canonicalization profiles versioned', 'Identity relationships specified', 'Privacy implications recorded'] }),
  item({ id: 'repr-number-model', areaId: 'representation', title: 'Consensus numeric model', status: 'active', applicability: 'required', gate: 'G1', objective: 'Fix integer widths, endianness, overflow behavior, reserved ranges, and time representations.', why: 'Silent wrapping or alternate encodings create consensus splits.', evidence: ['ADR-001 §6 · proposed', 'Existing scalar rejection tests'], dependencies: ['grammar-adr'], completion: ['Every primitive range specified', 'Boundary and rejection vectors published'] }),

  item({ id: 'grammar-adr', areaId: 'grammar', title: 'ADR-001 bounded canonical grammar', status: 'active', applicability: 'required', gate: 'G1', objective: 'Specify one deterministic, size-bounded byte language with fail-closed decoding.', why: 'Stable hashes, signatures, transaction IDs, and consensus all begin with exact bytes.', evidence: ['docs/protocol/adr-001-bounded-canonical-object-grammar.md · proposed'], dependencies: ['mission-charter'], completion: ['Proposal reviewed', 'Open grammar decisions resolved', 'Status accepted'] }),
  item({ id: 'grammar-envelope', areaId: 'grammar', title: 'Typed protocol envelope', status: 'active', applicability: 'required', gate: 'G1', objective: 'Bind grammar, protocol, domain, object type, schema version, and payload length.', why: 'The same bytes must never acquire different meanings across objects, chains, or versions.', evidence: ['ADR-001 envelope · proposed'], dependencies: ['grammar-adr'], completion: ['Field assignments accepted', 'Chain/domain rules accepted', 'Golden bytes published'] }),
  item({ id: 'grammar-composites', areaId: 'grammar', title: 'Deterministic composite types', status: 'active', applicability: 'required', gate: 'G1', objective: 'Define bounded bytes, sequences, records, enums, optionals, and strict UTF-8 policy.', why: 'Generic maps, floats, implicit defaults, and normalization-on-accept invite alternate encodings.', evidence: ['ADR-001 type rules · proposed'], dependencies: ['grammar-adr'], completion: ['All types specified', 'Unknown/duplicate field behavior fixed'] }),
  item({ id: 'grammar-limits', areaId: 'grammar', title: 'Resource-limit profile', status: 'open', applicability: 'required', gate: 'G1', objective: 'Assign production values for byte, nesting, field, collection, and allocation limits.', why: 'Bounded grammar still needs agreed numbers tied to the workload and DoS model.', evidence: ['ADR-001 names limits but does not invent values', 'D-012'], dependencies: ['mission-slos', 'grammar-adr'], completion: ['Limit table accepted', 'Checked-arithmetic tests published', 'Capacity rationale measured'] }),
  item({ id: 'grammar-vectors', areaId: 'grammar', title: 'Positive and rejection vectors', status: 'queued', applicability: 'required', gate: 'G1', objective: 'Publish valid, boundary, invalid, truncated, duplicate, trailing-byte, and overflow fixtures.', why: 'Two parsers agreeing only on happy paths does not establish canonical behavior.', evidence: ['ADR-001 vector schema · proposed'], dependencies: ['grammar-envelope', 'grammar-composites', 'grammar-limits'], completion: ['Vectors immutable', 'Stable rejection stages assigned', 'Two decoders agree'] }),

  item({ id: 'commit-suite', areaId: 'commitments', title: 'BlockCommit512 suite', status: 'open', applicability: 'required', gate: 'G2', objective: 'Select the exact authoritative 64-byte commitment function and customization domains.', why: 'A 512-bit field only reaches the collision target if the entire construction is sound.', evidence: ['D-007', 'TupleHash256 is a candidate, not selected'], dependencies: ['grammar-vectors'], completion: ['Primitive and domains accepted', 'Known-answer vectors published', 'Composition reviewed'] }),
  item({ id: 'commit-visual', areaId: 'commitments', title: 'VisualCommit3072 profile', status: 'open', applicability: 'required', gate: 'G2', objective: 'Define the 384-byte standards-derived visual commitment and its relation to BlockCommit512.', why: 'The compact and visual outputs may be independent functions; prefix assumptions are unsafe.', evidence: ['Charter-000 §2.2', 'D-007'], dependencies: ['commit-suite'], completion: ['Relationship specified', 'Rendering type tagged', 'Vectors published'] }),
  item({ id: 'commit-trees', areaId: 'commitments', title: 'State, body, and witness trees', status: 'blocked', applicability: 'required', gate: 'G2', objective: 'Specify leaves, nodes, empty/odd cases, order, duplicates, proofs, and update semantics.', why: 'A reviewed hash cannot rescue malformed tree semantics.', evidence: ['D-008'], dependencies: ['commit-suite', 'state-model', 'auth-profile'], completion: ['Every domain separated', 'Proof rejection rules fixed', 'Independent vectors agree'] }),
  item({ id: 'commit-randomness', areaId: 'commitments', title: 'Randomness and entropy profile', status: 'open', applicability: 'required', gate: 'G2', objective: 'Specify entropy acquisition, conditioning, health failure, and deterministic test behavior.', why: 'Key generation, signatures, PoS selection, and other mechanisms may depend on trustworthy randomness.', evidence: ['No protocol profile yet'], dependencies: ['mission-threat-model'], completion: ['Sources and failure behavior accepted', 'Platform profiles tested'] }),
  item({ id: 'commit-wide-research', areaId: 'commitments', title: 'WideTelemetry3072-v0', status: 'experimental', applicability: 'undecided', gate: 'G2', objective: 'Study the bespoke 96-word mapping strictly outside authoritative validation.', why: 'Internal tests do not establish a permutation, hash, ASIC resistance, or cryptographic security.', evidence: ['src/core/philox96.ts · prototype', 'Charter-000 §4'], dependencies: ['govern-research'], completion: ['Public specification', 'Independent cryptanalysis', 'Versioned promotion decision'] }),

  item({ id: 'auth-profile', areaId: 'authentication', title: 'Category-5 authentication profile', status: 'open', applicability: 'required', gate: 'G2', objective: 'Select ML-DSA or HashML-DSA mode, contexts, randomness, library, and exact validation behavior.', why: 'Naming ML-DSA-87 is not a complete interoperable or secure transaction profile.', evidence: ['D-009', 'FIPS 204'], dependencies: ['grammar-vectors', 'commit-randomness'], completion: ['Profile accepted', 'KATs and rejection vectors pass', 'Implementation independently reviewed'] }),
  item({ id: 'auth-transcript', areaId: 'authentication', title: 'Signed transcript and replay protection', status: 'blocked', applicability: 'required', gate: 'G2', objective: 'Bind chain/domain, protocol version, operation semantics, key epoch, and replay protection.', why: 'A signature proves only control of a key over the exact bytes it covers.', evidence: ['ADR-003 not started'], dependencies: ['state-model', 'auth-profile', 'grammar-vectors'], completion: ['Every signed field normative', 'Cross-domain replay tests fail closed'] }),
  item({ id: 'auth-key-lifecycle', areaId: 'authentication', title: 'Key lifecycle and recovery', status: 'open', applicability: 'required', gate: 'G2', objective: 'Define registration, custody, epochs, delegation, rotation, loss, compromise, recovery, and revocation.', why: 'Identity cannot safely equal one permanent signing key.', evidence: ['D-010'], dependencies: ['state-model', 'auth-profile'], completion: ['Lifecycle state machine accepted', 'Historical validation rules fixed', 'Recovery abuse modeled'] }),
  item({ id: 'auth-tx-identifiers', areaId: 'authentication', title: 'Transaction identifier semantics', status: 'open', applicability: 'required', gate: 'G2', objective: 'Choose one ID or separate semantic and witnessed IDs with exact committed fields.', why: 'Hedged signatures may vary for one message, but this does not itself mandate Bitcoin-style IDs.', evidence: ['D-011'], dependencies: ['state-model', 'auth-transcript', 'commit-suite'], completion: ['Malleability model written', 'All ID vectors published', 'Block witness binding fixed'] }),
  item({ id: 'auth-legacy-transcripts', areaId: 'authentication', title: 'Legacy proof/transcript helpers', status: 'experimental', applicability: 'undecided', gate: 'G2', objective: 'Keep current private self-checks fail-closed and outside authorization.', why: 'The bespoke transcript and plate helper are not public ZK proofs or production provenance.', evidence: ['src/core/zk3072.ts', 'src/core/zkPlate.ts', 'Current fail-closed tests'], dependencies: [], completion: ['Removed, renamed, or formally replaced by ADR-003 implementation'] }),

  item({ id: 'state-model', areaId: 'state', title: 'State model', status: 'open', applicability: 'required', gate: 'G3', objective: 'Choose accounts, UTXO, append-only claims, object capability, or a precisely defined hybrid.', why: 'Transactions, concurrency, authorization, identifiers, roots, and economics all depend on this choice.', evidence: ['D-003'], dependencies: ['mission-charter', 'repr-artifact-identity'], completion: ['State objects specified', 'Invariants accepted', 'Alternatives and trade-offs recorded'] }),
  item({ id: 'state-transition', areaId: 'state', title: 'Deterministic state transition', status: 'blocked', applicability: 'required', gate: 'G3', objective: 'Specify pure validation, authorization, execution, root comparison, and atomic commit.', why: 'Nodes must derive identical results without mutating a block during validation.', evidence: ['Current ledger is an isolated prototype'], dependencies: ['state-model', 'commit-trees', 'auth-transcript'], completion: ['Normative transition algorithm', 'Positive/negative vectors', 'Machine-checkable invariants'] }),
  item({ id: 'state-resource-metering', areaId: 'state', title: 'Execution and state-growth metering', status: 'blocked', applicability: 'required', gate: 'G3', objective: 'Bound computation, storage, reads, writes, witnesses, and pathological operations.', why: 'Even a no-token system needs a resource and abuse model.', evidence: ['No accepted execution model'], dependencies: ['state-model', 'grammar-limits', 'economics-fees'], completion: ['Cost model accepted', 'Worst-case benchmarks pass', 'Admission policy separated from consensus'] }),
  item({ id: 'state-receipts', areaId: 'state', title: 'Receipts, events, and proof semantics', status: 'blocked', applicability: 'required', gate: 'G3', objective: 'Define what execution evidence exists and exactly what it proves.', why: 'Application-visible outcomes need canonical identity and reorg/finality semantics.', evidence: ['No specification'], dependencies: ['state-transition', 'consensus-finality'], completion: ['Receipt grammar and root binding accepted', 'Reorg behavior specified'] }),
  item({ id: 'state-reorg', areaId: 'state', title: 'Reorg and rollback handling', status: 'blocked', applicability: 'required', gate: 'G3', objective: 'Define state rollback, transaction resurrection, finalized boundaries, snapshots, and pruning.', why: 'A chain that can reorganize must make application and storage consequences deterministic.', evidence: ['Prototype has only local atomic rollback'], dependencies: ['state-transition', 'consensus-fork-choice', 'consensus-finality'], completion: ['Reorg state machine accepted', 'Restart and deep-reorg simulations pass'] }),

  item({ id: 'consensus-choice', areaId: 'consensus', title: 'PoW, PoS, BFT, or hybrid decision', status: 'open', applicability: 'required', gate: 'G4', objective: 'Select the ordering/finality family from explicit safety, decentralization, cost, and operating targets.', why: 'These branches are alternatives, not cumulative achievements, and require different headers and economics.', evidence: ['D-005'], dependencies: ['mission-threat-model', 'mission-slos', 'state-model', 'economics-token'], completion: ['Mechanism ADR accepted', 'Assumptions and failure thresholds explicit', 'Reopen triggers recorded'] }),
  item({ id: 'consensus-sybil', areaId: 'consensus', title: 'Sybil resistance', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Define the scarce resource or governed membership that limits voting/production power.', why: 'P2P identity alone does not stop one actor from creating unlimited participants.', evidence: ['No selected mechanism'], dependencies: ['consensus-choice', 'economics-security-budget'], completion: ['Attack-cost model accepted', 'Capture/concentration analysis reviewed'] }),
  item({ id: 'consensus-selection', areaId: 'consensus', title: 'Miner, proposer, or leader selection', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Specify eligibility, selection randomness/work, committee construction, and rotation.', why: 'Who may order state is the center of consensus power.', evidence: ['No selected mechanism'], dependencies: ['consensus-choice', 'consensus-sybil', 'commit-randomness'], completion: ['Selection algorithm specified', 'Bias and concentration modeled'] }),
  item({ id: 'consensus-fork-choice', areaId: 'consensus', title: 'Fork choice', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Define how nodes choose among competing valid histories.', why: 'A valid-block function without chain selection is not consensus.', evidence: ['No specification'], dependencies: ['consensus-choice', 'consensus-sybil'], completion: ['Rule formally stated', 'Tie and partition behavior tested', 'Safety argument reviewed'] }),
  item({ id: 'consensus-finality', areaId: 'consensus', title: 'Finality', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Separate probabilistic settlement, protocol finality, economic finality, and social/governance recovery; define whichever apply and how they fail.', why: 'Users and applications need to know which layer makes history stable and what reversion remains possible.', evidence: ['No specification'], dependencies: ['consensus-choice', 'consensus-fork-choice'], completion: ['Each applicable finality predicate separated', 'Latency and reversal curves measured', 'Failure and recovery authority specified'] }),
  item({ id: 'consensus-decentralization', areaId: 'consensus', title: 'Control concentration and decentralization', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Measure independent controlling entities, client/operator concentration, capture thresholds, and geographic/provider correlation.', why: 'Node or validator count can overstate decentralization when keys, stake, hash power, software, or infrastructure share control.', evidence: ['No selected mechanism or measurement baseline'], dependencies: ['consensus-sybil', 'consensus-selection', 'economics-security-budget'], completion: ['Entity-level metrics and methodology published', 'Capture thresholds modeled', 'Concentration guardrails accepted'] }),
  item({ id: 'consensus-timing', areaId: 'consensus', title: 'Consensus timing envelope', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Specify clock skew, network-delay assumptions, slots/rounds, timeouts, backoff, partition behavior, halt detection, and restart.', why: 'A logically correct protocol can fork or halt when its timing assumptions do not match the real network.', evidence: ['No normative timing model'], dependencies: ['consensus-choice', 'network-gossip', 'mission-slos'], completion: ['Timing assumptions and transitions normative', 'Adversarial delay/clock simulations pass', 'Halt recovery rehearsed'] }),
  item({ id: 'consensus-block-building', areaId: 'consensus', title: 'Block construction and ordering policy', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Define transaction selection, fee/priority ordering, bundles, proposer-builder roles, template validity, and censorship handling.', why: 'Ordering power creates safety, fairness, censorship, and extractable-value consequences beyond block validity.', evidence: ['No block-construction specification'], dependencies: ['consensus-selection', 'network-mempool', 'economics-fees', 'economics-mev'], completion: ['Template rules specified', 'Policy versus consensus fields separated', 'Censorship and MEV scenarios measured'] }),
  item({ id: 'consensus-pow', areaId: 'consensus', title: 'Proof-of-work branch', status: 'conditional', applicability: 'conditional', gate: 'G4', objective: 'If selected: specify puzzle, target, work accounting, timestamp rules, templates, and ASIC strategy.', why: 'The current memory/sparsity code is experimental and cannot define network consensus.', evidence: ['src/core/mining3072.ts · prototype only'], dependencies: ['consensus-choice', 'commit-suite', 'economics-security-budget'], completion: ['PoW selected', 'Independent cryptanalysis', 'Attack and energy model accepted'] }),
  item({ id: 'consensus-difficulty', areaId: 'consensus', title: 'Difficulty adjustment', status: 'conditional', applicability: 'conditional', gate: 'G4', objective: 'If PoW is selected: derive targets from committed history with bounded timestamp manipulation.', why: 'A miner-declared target is never authoritative by itself.', evidence: ['Prototype retarget tests are not consensus evidence'], dependencies: ['consensus-pow'], completion: ['Retarget rule and compact encoding specified', 'Adversarial timestamp simulations pass'] }),
  item({ id: 'consensus-pos', areaId: 'consensus', title: 'Proof-of-stake branch', status: 'conditional', applicability: 'conditional', gate: 'G4', objective: 'If selected: specify stake lifecycle, randomness, committees, rewards, slashing, finality, and weak subjectivity.', why: 'PoS security depends on capital, governance, and recovery rules—not signatures alone.', evidence: ['No implementation or specification'], dependencies: ['consensus-choice', 'economics-token', 'commit-randomness'], completion: ['PoS selected', 'Economic and long-range defenses reviewed', 'Finality model checked'] }),
  item({ id: 'consensus-bft', areaId: 'consensus', title: 'BFT or federated branch', status: 'conditional', applicability: 'conditional', gate: 'G4', objective: 'If selected: specify membership, quorums, locking, view changes, equivocation, and partial synchrony.', why: 'Committee consensus trades open participation for explicit membership and fault assumptions.', evidence: ['No implementation or specification'], dependencies: ['consensus-choice', 'govern-membership'], completion: ['BFT selected', 'Membership governance accepted', 'Protocol model checked'] }),

  item({ id: 'economics-token', areaId: 'economics', title: 'Native token purpose', status: 'open', applicability: 'undecided', gate: 'G4', objective: 'Prove which indispensable security/resource function requires a token, or select no token.', why: 'A token does not create provenance or consensus merely by existing.', evidence: ['D-004'], dependencies: ['mission-charter'], completion: ['Purpose and non-goals accepted', 'No-token alternative evaluated', 'Reopen triggers recorded'] }),
  item({ id: 'economics-issuance', areaId: 'economics', title: 'Issuance and supply', status: 'blocked', applicability: 'undecided', gate: 'G4', objective: 'If a token exists: define units, genesis distribution, issuance, caps/inflation, burns, and arithmetic.', why: 'The current 21M/halving prototype copies Bitcoin and is not accepted UIA economics.', evidence: ['src/core/sparsity.ts · prototype'], dependencies: ['economics-token', 'consensus-choice'], completion: ['Monetary model simulated', 'Distribution and governance reviewed', 'Overflow vectors pass'] }),
  item({ id: 'economics-fees', areaId: 'economics', title: 'Fees and resource pricing', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Define congestion, storage/state growth, execution, bandwidth, refunds, and spam deterrence.', why: 'Every shared system needs a bounded allocation policy, with or without a token.', evidence: ['No accepted model'], dependencies: ['state-model', 'mission-slos', 'economics-token'], completion: ['Pricing/quota model accepted', 'Congestion and spam simulations pass'] }),
  item({ id: 'economics-security-budget', areaId: 'economics', title: 'Long-run security budget', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Model token/asset price, hash or stake concentration, delegation, operator profitability, slashing correlation, bribery, borrowed power, censorship, and long-run fee/reward sufficiency.', why: 'Consensus safety degrades if honest operation is underfunded or capture is cheaper than defense.', evidence: ['No model'], dependencies: ['consensus-choice', 'economics-token', 'economics-fees'], completion: ['Sensitivity model and assumptions published', 'Concentration/bribery/censorship scenarios reviewed', 'Security budget survives target stress envelope'] }),
  item({ id: 'economics-mev', areaId: 'economics', title: 'MEV, censorship, and bribery', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Model ordering extraction, censorship incentives, proposer-builder separation, and mitigations.', why: 'A performant state machine can still centralize around privileged ordering revenue.', evidence: ['No analysis'], dependencies: ['state-model', 'consensus-selection', 'economics-fees'], completion: ['Threats measured', 'Policy/consensus mitigations separated'] }),

  item({ id: 'network-wire', areaId: 'network', title: 'Wire protocol and negotiation', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Specify message framing, capability/version negotiation, strict sizes, and transport boundaries.', why: 'Callback tests do not establish an interoperable or abuse-resistant network protocol.', evidence: ['src/core/p2pBroadcast3072.ts · prototype'], dependencies: ['grammar-vectors', 'grammar-limits'], completion: ['Wire ADR accepted', 'Cross-implementation fixtures pass', 'Unknown-version behavior fixed'] }),
  item({ id: 'network-session', areaId: 'network', title: 'Transport and session security', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Specify peer-channel authentication, encryption, handshakes, downgrade resistance, key rotation, replay, resumption, and metadata exposure.', why: 'Canonical messages can still be intercepted, downgraded, correlated, or injected through an underspecified session layer.', evidence: ['No transport/session security profile'], dependencies: ['network-wire', 'network-peers', 'auth-profile'], completion: ['Handshake transcript and algorithms specified', 'Downgrade/replay tests fail closed', 'Confidentiality and metadata limits stated'] }),
  item({ id: 'network-topology', areaId: 'network', title: 'Node roles and trust topology', status: 'open', applicability: 'required', gate: 'G4', objective: 'Define producer/validator/miner, full, archive, light, bootstrap, monitor/witness, indexer, and RPC roles and which must validate, retain, or serve what.', why: 'End-to-end security depends on role boundaries and trust assumptions, not a generic peer count.', evidence: ['No role/topology specification'], dependencies: ['mission-primary-outcome', 'consensus-choice', 'network-availability'], completion: ['Role capabilities and prohibited trust shortcuts explicit', 'Bootstrap and independent validation paths diagrammed', 'Failure of each role modeled'] }),
  item({ id: 'network-peers', areaId: 'network', title: 'Peer identity and discovery', status: 'open', applicability: 'required', gate: 'G4', objective: 'Define node identity, discovery, connection limits, NAT behavior, rotation, and privacy.', why: 'Peer IDs are not consensus identities, and discovery topology affects eclipse resistance.', evidence: ['No protocol profile'], dependencies: ['mission-threat-model'], completion: ['Discovery and identity profile accepted', 'Eclipse simulations pass'] }),
  item({ id: 'network-gossip', areaId: 'network', title: 'Gossip and propagation', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Specify deduplication, retry/ack, fanout, validation gates, backpressure, and propagation goals.', why: 'Best-effort callback relay is not reliable consensus gossip.', evidence: ['Prototype unit tests only'], dependencies: ['network-wire', 'consensus-choice'], completion: ['Propagation SLO accepted', 'Loss/latency/adversarial simulations pass'] }),
  item({ id: 'network-mempool', areaId: 'network', title: 'Mempool admission and replacement', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Define policy versus consensus validity, replacement, eviction, fee/quotas, and replay after reorgs.', why: 'Unbounded or inconsistent admission creates DoS and propagation divergence.', evidence: ['No mempool specification'], dependencies: ['state-transition', 'economics-fees', 'network-gossip'], completion: ['Admission policy measured', 'Replacement and eviction deterministic where required'] }),
  item({ id: 'network-availability', areaId: 'network', title: 'Data availability', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Define what data must remain retrievable, by whom, for how long, and how unavailability is detected.', why: 'A committed root is useless if validators or users cannot obtain the committed body and witnesses.', evidence: ['D-012', 'No accepted availability model'], dependencies: ['state-model', 'consensus-choice', 'grammar-limits'], completion: ['Availability predicate accepted', 'Withholding and recovery tests pass'] }),
  item({ id: 'network-history', areaId: 'network', title: 'History retention and reconstructibility', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Define state/history growth, archival responsibility or incentives, minimum reconstructible data, pruning, and catastrophic-loss recovery.', why: 'A root does not ensure that any honest party will preserve enough history to reconstruct or audit the system.', evidence: ['No retention or archival model'], dependencies: ['network-availability', 'economics-security-budget', 'state-model'], completion: ['Retention responsibilities accepted', 'Growth model measured', 'Catastrophic recovery demonstrated'] }),
  item({ id: 'network-sync', areaId: 'network', title: 'Initial sync, snapshots, and light clients', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Specify historical sync, state sync, checkpoints, pruning, proofs, and trust assumptions.', why: 'New nodes must reproduce or safely verify state without hidden trust.', evidence: ['No specification'], dependencies: ['commit-trees', 'state-transition', 'consensus-finality', 'network-availability'], completion: ['Sync modes specified', 'Corrupt snapshot tests fail closed', 'Light-client security stated'] }),
  item({ id: 'network-abuse', areaId: 'network', title: 'DoS and resource controls', status: 'blocked', applicability: 'required', gate: 'G4', objective: 'Define rate limits, amplification bounds, cache policies, validation budgets, and overload behavior.', why: 'Network safety depends on adversarial cost, not only well-formed messages.', evidence: ['Prototype has partial structural limits'], dependencies: ['grammar-limits', 'network-wire', 'economics-fees'], completion: ['Per-peer/global budgets accepted', 'Adversarial load tests pass'] }),
  item({ id: 'network-external-trust', areaId: 'network', title: 'Bridges, oracles, and external anchors', status: 'conditional', applicability: 'conditional', gate: 'G4', objective: 'If introduced, give each external dependency its own threat model, finality/availability assumptions, upgrade authority, and security ceiling.', why: 'External systems expand trust and cannot inherit the base protocol status merely by being connected.', evidence: ['No bridge, oracle, or external anchor selected'], dependencies: ['mission-threat-model', 'consensus-finality'], completion: ['Dependency explicitly selected', 'Independent threat model accepted', 'Failure and deprecation paths tested'] }),

  item({ id: 'govern-genesis', areaId: 'governance', title: 'Chain ID, genesis, and checkpoints', status: 'open', applicability: 'required', gate: 'G5', objective: 'Fix network identity, initial state, bootstrap trust, checkpoints, and replay boundaries.', why: 'Consensus has no shared history without a canonical origin and domain.', evidence: ['D-013'], dependencies: ['state-model', 'consensus-choice'], completion: ['Genesis generation reproducible', 'Chain/domain IDs frozen', 'Checkpoint policy accepted'] }),
  item({ id: 'govern-upgrades', areaId: 'governance', title: 'Protocol upgrades and activation', status: 'blocked', applicability: 'required', gate: 'G5', objective: 'Define proposals, review, soft/hard compatibility, activation, rollback, and historical validation.', why: 'Upgrade machinery must exist before the first production emergency.', evidence: ['No accepted governance model'], dependencies: ['consensus-choice', 'govern-genesis'], completion: ['Activation state machine accepted', 'Upgrade rehearsals pass', 'Downgrade prevention tested'] }),
  item({ id: 'govern-membership', areaId: 'governance', title: 'Validator/operator membership governance', status: 'blocked', applicability: 'conditional', gate: 'G5', objective: 'If governed membership exists: define admission, removal, conflicts, accountability, and capture controls.', why: 'BFT safety assumptions depend on exactly who controls the committee.', evidence: ['No selected model'], dependencies: ['consensus-choice'], completion: ['Roles and thresholds accepted', 'Capture and emergency removal analyzed'] }),
  item({ id: 'govern-emergency', areaId: 'governance', title: 'Emergency and incident authority', status: 'queued', applicability: 'required', gate: 'G5', objective: 'Define pause powers, disclosure, key ceremonies, recovery, and public accountability.', why: 'Undefined emergency powers become improvised centralized control.', evidence: ['No policy'], dependencies: ['govern-upgrades', 'mission-threat-model'], completion: ['Powers minimized and auditable', 'Runbook and exercise scenarios specified'] }),
  item({ id: 'govern-launch', areaId: 'governance', title: 'Genesis and launch ceremony', status: 'blocked', applicability: 'required', gate: 'G5', objective: 'Specify initial economic/validator state, seed diversity, bootstrap trust, launch monitoring, and abort/recovery procedure.', why: 'A sound protocol can still launch with centralized, replayable, or unrecoverable initial conditions.', evidence: ['No launch specification'], dependencies: ['govern-genesis', 'economics-token', 'consensus-choice', 'govern-emergency'], completion: ['Ceremony plan reproducible and witnessable', 'Replay isolation verified', 'Abort and recovery rehearsal designed'] }),
  item({ id: 'govern-research', areaId: 'governance', title: 'Research-rail promotion process', status: 'open', applicability: 'required', gate: 'G2', objective: 'Set public specification, reviewer, observation, attack, bounty, and activation requirements.', why: 'No-attacks-observed and internal tests are not promotion certificates.', evidence: ['D-015', 'Charter-000 §4'], dependencies: ['mission-threat-model'], completion: ['Criteria accepted', 'Versioned promotion and rollback process specified'] }),

  item({ id: 'ops-database', areaId: 'operations', title: 'Crash-consistent database and undo model', status: 'blocked', applicability: 'required', gate: 'G7', objective: 'Specify atomic writes, undo/reorg logs, corruption detection, schema migration, reindexing, and crash recovery.', why: 'Database behavior can violate consensus even when the state-transition pseudocode is correct.', evidence: ['No node database design'], dependencies: ['state-transition', 'state-reorg'], completion: ['Crash points fault-injected', 'Reindex reproduces canonical state', 'Corruption fails visibly'] }),
  item({ id: 'ops-snapshots', areaId: 'operations', title: 'Authenticated snapshots and pruning', status: 'blocked', applicability: 'required', gate: 'G7', objective: 'Define snapshot creation, authentication, restoration, pruning boundaries, and trust assumptions.', why: 'Unsafe snapshots can silently replace full validation with untracked trust.', evidence: ['No node snapshot profile'], dependencies: ['network-sync', 'commit-trees', 'consensus-finality'], completion: ['Corrupt and stale snapshots rejected', 'Restored node converges', 'Pruning preserves required evidence'] }),
  item({ id: 'ops-resources', areaId: 'operations', title: 'Node resource profiles and overload behavior', status: 'blocked', applicability: 'required', gate: 'G7', objective: 'Measure CPU, memory, disk, bandwidth, file descriptors, startup, sync, and worst-case validation for supported node classes.', why: 'Permissionless participation and availability depend on real operating cost and bounded overload behavior.', evidence: ['No node implementation or profile'], dependencies: ['network-abuse', 'state-resource-metering', 'mission-slos'], completion: ['Profiles measured on representative hardware', 'Overload fails safely', 'Participation costs published'] }),
  item({ id: 'ops-release', areaId: 'operations', title: 'Reproducible release and supply chain', status: 'queued', applicability: 'required', gate: 'G7', objective: 'Pin dependencies/toolchains, publish SBOMs, reproduce binaries, sign releases, and govern release-key recovery.', why: 'A compromised compiler, dependency, CI runner, or release key bypasses protocol-level correctness.', evidence: ['Application build only; no node release process'], dependencies: ['assurance-reference', 'govern-upgrades'], completion: ['Independent binary reproduction', 'SBOM and provenance published', 'Signing-key compromise drill passes'] }),
  item({ id: 'ops-rpc-wallet', areaId: 'operations', title: 'Wallet, RPC, and operator safety boundary', status: 'blocked', applicability: 'required', gate: 'G7', objective: 'Define signing-intent presentation, hardware-wallet path, fee estimation, simulation, RPC authentication, and unsafe-method isolation.', why: 'Users and operators can lose security through ambiguous signing or exposed administration even when consensus is sound.', evidence: ['No protocol wallet or node RPC'], dependencies: ['auth-transcript', 'economics-fees', 'state-transition'], completion: ['Signing intent vectors match devices', 'Unsafe RPC isolated', 'Misconfiguration tests pass'] }),
  item({ id: 'ops-recovery', areaId: 'operations', title: 'Halt, restore, and disaster recovery', status: 'queued', applicability: 'required', gate: 'G7', objective: 'Specify detection, backups, restoration, resumption, public coordination, and post-incident evidence renewal.', why: 'Recovery improvised under pressure can centralize control or fork the network.', evidence: ['No node recovery runbook'], dependencies: ['ops-database', 'ops-snapshots', 'govern-emergency'], completion: ['Loss and halt exercises pass', 'Restoration preserves finalized history', 'Authorities and communications explicit'] }),

  item({ id: 'assurance-traceability', areaId: 'assurance', title: 'Spec-to-code traceability', status: 'queued', applicability: 'required', gate: 'G6', objective: 'Map every normative rule and rejection reason to implementation and tests.', why: 'Passing tests do not show which protocol obligations are covered or missing.', evidence: ['No production protocol implementation yet'], dependencies: ['grammar-vectors', 'commit-suite', 'state-transition', 'consensus-choice'], completion: ['Traceability matrix complete', 'Consensus/policy/UI boundaries enforced'] }),
  item({ id: 'assurance-reference', areaId: 'assurance', title: 'Conforming reference implementation', status: 'blocked', applicability: 'required', gate: 'G6', objective: 'Build the first implementation against frozen specifications and immutable vectors.', why: 'Current 3072 modules are experimental islands, not a conforming node.', evidence: ['Current app/prototype typecheck and unit suite pass; not protocol conformance'], dependencies: ['assurance-traceability'], completion: ['All conformance vectors pass', 'Reproducible build and SBOM published'] }),
  item({ id: 'assurance-independent', areaId: 'assurance', title: 'Independent implementation', status: 'queued', applicability: 'required', gate: 'G8', objective: 'Produce a separately authored decoder/verifier/node and run fork-identical differential validation.', why: 'One codebase can reproduce its own mistake, while diverse clients can also introduce consensus splits.', evidence: ['None'], dependencies: ['assurance-reference', 'ops-release'], completion: ['Independent authorship documented', 'Positive and adversarial rejection parity', 'Fork-identical differential scenarios agree'] }),
  item({ id: 'assurance-adversarial', areaId: 'assurance', title: 'Fuzzing, properties, and model checking', status: 'queued', applicability: 'required', gate: 'G8', objective: 'Fuzz codecs and state, prove properties, model consensus, and test side channels/faults where relevant.', why: 'Happy-path unit tests do not explore consensus-critical state space.', evidence: ['Some current unit/property tests; no protocol campaign'], dependencies: ['assurance-reference', 'consensus-choice'], completion: ['Coverage targets met', 'No unresolved critical/high findings', 'Models and corpora published'] }),
  item({ id: 'assurance-review', areaId: 'assurance', title: 'Independent security and cryptographic review', status: 'queued', applicability: 'required', gate: 'G8', objective: 'Review the exact frozen specification, primitive profiles, and implementation commits.', why: 'An audit applies only to the exact artifacts in scope and becomes stale after material changes.', evidence: ['No independent protocol audit'], dependencies: ['assurance-independent', 'assurance-adversarial'], completion: ['Reports public', 'Critical/high findings resolved', 'Change-impact policy active'] }),
  item({ id: 'assurance-testnet', areaId: 'assurance', title: 'Adversarial testnet and rehearsals', status: 'queued', applicability: 'required', gate: 'G9', objective: 'Sustain realistic load, partitions, attacks, upgrades, reorgs, restarts, and disaster recovery.', why: 'Operational behavior emerges only across time, topology, incentives, and failures.', evidence: ['No testnet'], dependencies: ['assurance-review', 'network-sync', 'govern-launch', 'ops-release', 'ops-recovery'], completion: ['Duration/SLO met', 'Upgrade and recovery exercises passed', 'Economics observed'] }),
  item({ id: 'assurance-incident', areaId: 'assurance', title: 'Operations and incident response', status: 'queued', applicability: 'required', gate: 'G9', objective: 'Define monitoring, disclosure, restoration, coordination, and post-incident evidence renewal.', why: 'Protocol correctness without operational recovery is not production readiness.', evidence: ['No protocol operations plan'], dependencies: ['network-availability', 'govern-upgrades', 'ops-recovery'], completion: ['Runbooks exercised', 'Release and recovery keys governed', 'Evidence renewal scheduled'] }),
  item({ id: 'assurance-production', areaId: 'assurance', title: 'Launch-readiness decision', status: 'blocked', applicability: 'required', gate: 'G10', objective: 'Make an explicit, evidence-backed decision to expose value or security claims to real users.', why: 'Deployment is a governance decision after evidence, not the automatic result of passing tests.', evidence: ['0 production gates passed'], dependencies: ['assurance-testnet', 'assurance-incident', 'govern-launch', 'ops-release'], completion: ['G0–G9 passed and current', 'Residual risks named, accepted, and expiring', 'Launch-readiness report signed'] }),
];

export function validateProtocolProgressModel(): readonly string[] {
  const errors: string[] = [];
  const areaIds = new Set<string>();
  const gateIds = new Set<string>();
  const itemIds = new Set<string>();

  for (const area of PROTOCOL_AREAS) {
    if (areaIds.has(area.id)) errors.push(`Duplicate area: ${area.id}`);
    areaIds.add(area.id);
  }
  for (const gate of PROTOCOL_GATES) {
    if (gateIds.has(gate.id)) errors.push(`Duplicate gate: ${gate.id}`);
    gateIds.add(gate.id);
  }

  for (const workItem of PROTOCOL_WORK_ITEMS) {
    if (itemIds.has(workItem.id)) errors.push(`Duplicate work item: ${workItem.id}`);
    itemIds.add(workItem.id);
    if (!areaIds.has(workItem.areaId)) errors.push(`Unknown area for ${workItem.id}: ${workItem.areaId}`);
    if (!gateIds.has(workItem.gate)) errors.push(`Unknown gate for ${workItem.id}: ${workItem.gate}`);
    if (workItem.evidence.length === 0) errors.push(`Missing evidence scope for ${workItem.id}`);
    if (!workItem.evidenceBoundary.trim()) errors.push(`Missing evidence boundary for ${workItem.id}`);
    if (workItem.completion.length === 0) errors.push(`Missing completion criteria for ${workItem.id}`);
    if (workItem.status === 'conditional' && workItem.applicability !== 'conditional') {
      errors.push(`Conditional status without conditional applicability: ${workItem.id}`);
    }
  }

  for (const workItem of PROTOCOL_WORK_ITEMS) {
    for (const dependency of workItem.dependencies) {
      if (!itemIds.has(dependency)) errors.push(`Unknown dependency for ${workItem.id}: ${dependency}`);
      if (dependency === workItem.id) errors.push(`Self dependency: ${workItem.id}`);
    }
  }

  const decisionIds = new Set<string>();
  for (const decision of OPEN_PROTOCOL_DECISIONS) {
    if (decisionIds.has(decision.id)) errors.push(`Duplicate decision: ${decision.id}`);
    decisionIds.add(decision.id);
    if (!areaIds.has(decision.areaId)) errors.push(`Unknown decision area: ${decision.id}`);
    if (!itemIds.has(decision.relatedWorkItemId)) {
      errors.push(`Unknown related work item for ${decision.id}: ${decision.relatedWorkItemId}`);
    }
  }

  const itemById = new Map(PROTOCOL_WORK_ITEMS.map((workItem) => [workItem.id, workItem]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: readonly string[]): void => {
    if (visiting.has(id)) {
      errors.push(`Dependency cycle: ${[...path, id].join(' -> ')}`);
      return;
    }
    if (visited.has(id)) return;
    const workItem = itemById.get(id);
    if (!workItem) return;
    visiting.add(id);
    for (const dependency of workItem.dependencies) visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const workItem of PROTOCOL_WORK_ITEMS) visit(workItem.id, []);

  return errors;
}
