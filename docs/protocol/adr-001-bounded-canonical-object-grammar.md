# ADR-001: Bounded Canonical Object Grammar

- **Status:** PROPOSED
- **Date:** 2026-08-13
- **Depends on:** [Charter-000](./charter-000.md)
- **Decision register:** [open-decisions.md](./open-decisions.md)
- **Terminology:** [glossary.md](./glossary.md)
- **Scope:** Canonical binary framing, primitive encodings, bounds, rejection,
  and conformance-vector structure

## 1. Decision

UIA protocol objects will use one deterministic, bounded binary grammar. Every
authoritative object has:

1. an exact protocol-domain identifier;
2. an encoding-grammar version;
3. a protocol version;
4. an object-type identifier;
5. an object-schema version; and
6. one length-delimited payload governed by a registered schema and an exact
   resource-limit profile.

There is exactly one accepted byte representation of a value under a given
domain, protocol version, object type, and schema version. A decoder MUST reject
an alternative representation rather than normalize it into the canonical one.

This ADR fixes the common grammar framework. It does not define a transaction,
block, state, token, consensus mechanism, commitment function, signature
algorithm, chain identifier, or production resource-limit value.

If accepted, this ADR resolves D-006 for the common grammar framework only.
Object schemas, registry assignments, and exact limit profiles remain required
follow-up decisions. While this ADR is `PROPOSED`, D-006 remains `OPEN`.

## 2. Goals and non-goals

The grammar MUST:

- make parser disagreement and alternate encodings mechanically testable;
- bind domain, type, and version information into the canonical bytes;
- permit a decoder to establish all byte and structural bounds before acting on
  decoded content;
- have decoding work linear in the bytes and elements accepted by the grammar;
- be implementable independently without locale, host-language, or platform
  behavior affecting the result; and
- produce positive, boundary, and rejection vectors suitable for differential
  testing.

The grammar does not provide authentication, confidentiality, hashing,
commitment security, replay protection, authorization, consensus, or semantic
validity by itself. Later ADRs MUST specify which of those properties apply to
each object and bind every selected property to the exact bytes defined here.

## 3. Canonical object envelope

All multi-byte integers in the envelope are unsigned and most-significant byte
first. `||` denotes byte concatenation.

```text
CanonicalObjectV1 :=
    magic
 || grammar_version
 || protocol_version
 || domain_length
 || domain_id
 || object_type
 || schema_version
 || payload_length
 || payload
```

| Field | Encoding | Canonical requirement |
|---|---:|---|
| `magic` | 4 bytes | Exactly `55 49 41 4f` (ASCII `UIAO`) |
| `grammar_version` | `u16be` | Exactly `1` for this grammar |
| `protocol_version` | `u32be` | Non-zero; assigned by a protocol profile |
| `domain_length` | `u16be` | Exact byte length of `domain_id`; non-zero and no greater than `MAX_DOMAIN_ID_BYTES` |
| `domain_id` | `domain_length` bytes | Opaque, exact bytes selected by the protocol-domain decision |
| `object_type` | `u32be` | Non-zero and registered for the selected domain and protocol version |
| `schema_version` | `u16be` | Non-zero and registered for `object_type` |
| `payload_length` | `u32be` | Exact byte length of `payload`; no greater than the applicable payload limit |
| `payload` | `payload_length` bytes | Exactly one canonical encoding under the registered schema |

The fixed portion of the envelope is 22 bytes; the complete object length is
`22 + domain_length + payload_length`. This addition MUST be checked without
integer overflow before any allocation or slice is performed.

`domain_id` is not assumed to be text and may contain any byte value. Its final
meaning and value remain open under D-013. Authoritative validation receives a
validation context containing either one exact expected domain or a finite
local allowlist of exact domains. An attacker-supplied `domain_id` MUST NOT
cause arbitrary profile, file, network, or configuration loading. A validator
MUST reject an otherwise valid object outside its validation context.

The validation context also supplies the protocol version or finite set of
protocol versions currently permitted by an external activation rule. Merely
naming a registered historical or future `protocol_version` in an untrusted
object does not make that version acceptable. Verification of an authoritative
record from another period MUST derive its permitted version from the
authenticated surrounding history and the applicable activation rule, not from
the object field alone.

The versions have separate meanings:

- `grammar_version` changes the envelope or common encoding rules;
- `protocol_version` selects a domain-wide protocol and limit profile; and
- `schema_version` changes the payload schema for one `object_type`.

A change at one layer MUST NOT be represented by silently reinterpreting a
version at another layer. Version `0` is invalid at every layer and cannot mean
“unspecified,” “latest,” or “auto-detect.”

## 4. Payload grammar

An object schema is an exact ordered composition of the following types. A
schema MUST name every field, its type, its bound, and any semantic range that
is narrower than the underlying encoding.

| Type | Canonical encoding |
|---|---|
| `u8` | One unsigned byte |
| `u16be` | Two-byte unsigned integer, most-significant byte first |
| `u32be` | Four-byte unsigned integer, most-significant byte first |
| `u64be` | Eight-byte unsigned integer, most-significant byte first |
| `bool` | One byte: `00` for false or `01` for true; every other value is invalid |
| `fixed<N>` | Exactly `N` opaque bytes, with no length prefix |
| `bytes<L>` | `u32be` byte length followed by exactly that many bytes; length MUST be no greater than the schema parameter `L` |
| `option<T>` | One-byte presence tag followed by nothing for `00`, or one canonical `T` for `01` |
| `list<T,C>` | `u32be` element count followed by exactly that many canonical `T` values; count MUST be no greater than `C` |
| `record` | The exact declared field sequence, with no field tags, defaults, or trailing bytes; fields are interpreted only by schema position |
| `union` | A registered non-zero `u16be` variant tag followed by the exact schema for that variant |
| `embedded-object` | One complete `CanonicalObjectV1`; it increments nesting depth and is constrained by both its own and its parent's profiles |

`N`, `L`, and `C` are schema constants or named profile parameters. They are not
values chosen by an individual implementation.

Every type admitted as a `list` element MUST have a schema-computable positive
minimum encoded size. Before iterating, a decoder MUST verify with checked
arithmetic that `count × minimum_encoded_size(T)` is no greater than the
remaining payload bytes. Zero-byte list element types are forbidden. This
prevents a four-byte count from causing unbounded iteration over absent data.

The root payload record begins at nesting depth zero. Entering an `option`,
`list`, nested `record`, `union`, or `embedded-object` increments depth by one;
leaving it restores the previous depth. Primitive and fixed-byte values do not
increment depth. The vector profile MUST use this definition when testing
`MAX_NESTING_DEPTH`.

Depth, total-element, byte, and embedded-object budgets belong to the root
decode and MUST NOT reset inside an embedded object. The embedded object's root
begins at its parent depth plus one; the child must satisfy both its own profile
limits and every remaining root budget. `MAX_EMBEDDED_OBJECTS` excludes the
root and includes all embedded descendants. A parent schema MUST allowlist the
exact `(domain_id, protocol_version, object_type, schema_version)` tuples that
may be embedded, rather than only an object type.

Signed integers, floating-point numbers, decimal numbers, generic maps, generic
sets, implicit defaults, null sentinels, native booleans, native timestamps,
and native strings are not base-grammar types. A future schema that needs one
of these concepts MUST define its exact byte-level semantics. Opaque bytes have
no authoritative text semantics. Before a schema treats bytes as text, it MUST
pin the encoding, Unicode version, normalization policy, comparison rule, and
invalid-sequence behavior.

A schema requiring associative or set-like data MUST encode it as a bounded
list and identify the exact key field and key type. The schema MUST state
whether the key's framing bytes participate in comparison. Entries MUST appear
in strictly increasing order of the specified canonical encoded key bytes and
duplicate keys MUST be rejected. Validation compares adjacent keys during
decoding; it MUST NOT sort the collection or require unbounded key copies. Byte
ordering is unsigned lexicographic ordering; if one key is an exact prefix of
another, the shorter key sorts first.

Every payload decoder MUST consume exactly `payload_length` bytes. Bytes are
assigned strictly by schema position and must parse to exact payload
exhaustion. Padding, an unconsumed suffix, a zero or unregistered union tag, or
an invalid option marker is invalid. Swapping two wire-compatible positional
fields produces a different decoded value; a positional decoder cannot infer
the author's intent and label that swap “field reordering.”

Each object schema MUST define semantic equality and ensure that no two
accepted encodings represent the same semantic value. Defaults, aliases,
multiple union variants for one value, alternate identifier forms, ignored
fields, and any other many-to-one accepted mapping are forbidden unless a
later version defines them as distinct semantic values.

## 5. Schema and registry rules

For each supported `(domain_id, protocol_version, object_type,
schema_version)` tuple, a protocol specification MUST publish:

- the symbolic and numeric object-type assignment;
- the exact ordered payload schema;
- every scalar semantic range;
- every named resource-limit parameter used by the schema;
- any required ordering or uniqueness rule;
- whether embedded objects are permitted and the exact domain/protocol/type/schema tuples that may appear;
- the positive and negative vectors required by Section 9; and
- activation, deprecation, and downgrade behavior.

Unknown domains, grammar versions, protocol versions, object types, schema
versions, and union variants MUST be rejected by authoritative validation.
There is no “best effort,” implicit fallback, latest-version lookup, or
consensus-valid unknown-field skipping.

New fields require a new `schema_version`. Reusing an existing version with a
different field interpretation is forbidden. A schema version is not assumed
to be backward compatible merely because its number is greater.

The exact parameter profile is selected by `domain_id` and
`protocol_version`. Changing a consensus-relevant bound requires a versioned
protocol decision; peers MUST NOT negotiate any authoritative acceptance bound
at runtime. A lower local limit may govern admission policy, but it does not
alter validation of authoritative records.

## 6. Resource-limit contract

Every protocol profile MUST assign exact non-negative integer values to the
following names before any object type using this grammar can be authoritative:

| Parameter | Meaning |
|---|---|
| `MAX_DOMAIN_ID_BYTES` | Maximum `domain_id` length; it MUST also fit `u16be` |
| `MAX_CANONICAL_OBJECT_BYTES` | Maximum complete envelope plus payload size |
| `MAX_PAYLOAD_BYTES` | Maximum payload size for any object in the profile |
| `MAX_VARIABLE_FIELD_BYTES` | Default maximum for a `bytes<L>` field unless a schema supplies a smaller limit |
| `MAX_LIST_ELEMENTS` | Default maximum for a `list<T,C>` unless a schema supplies a smaller limit |
| `MAX_TOTAL_ELEMENTS` | Maximum aggregate elements across all lists in one root decode |
| `MAX_NESTING_DEPTH` | Maximum record, option, list, union, and embedded-object nesting below the root |
| `MAX_EMBEDDED_OBJECTS` | Maximum aggregate embedded objects in one root decode |

An object schema SHOULD define narrower, purpose-specific parameters such as
`MAX_<OBJECT>_<FIELD>_BYTES` or `MAX_<OBJECT>_<FIELD>_COUNT` instead of relying
only on profile-wide maxima. This ADR intentionally assigns no final numeric
values.

A profile is invalid unless all of the following hold:

- `1 ≤ MAX_DOMAIN_ID_BYTES ≤ 65,535`;
- `0 ≤ MAX_PAYLOAD_BYTES ≤ 4,294,967,295`;
- every variable-field and list bound fits its `u32be` prefix;
- `MAX_CANONICAL_OBJECT_BYTES` permits at least the 23-byte object consisting
  of the 22-byte fixed envelope, one domain byte, and an empty payload;
- `22 + exact_domain_id_length + MAX_PAYLOAD_BYTES` is no greater than
  `MAX_CANONICAL_OBJECT_BYTES`;
- `MAX_VARIABLE_FIELD_BYTES ≤ MAX_PAYLOAD_BYTES` and
  `MAX_LIST_ELEMENTS ≤ MAX_TOTAL_ELEMENTS`;
- every object-specific limit is no greater than its applicable profile-wide
  limit; and
- aggregate accounting uses checked unsigned 64-bit arithmetic and rejects a
  value or sum that would exceed `2^64 − 1`.

Limits MUST be checked before allocating, copying, descending into a nested
container, or invoking semantic or cryptographic validation. Counts, lengths,
offsets, and cumulative budgets MUST use checked arithmetic. A decoder MUST
reject an object when any individual or aggregate limit would be exceeded,
even if the physical input is otherwise well formed.

Authoritative validation uses exactly the profile limits. An implementation
may apply stricter transport or admission policy, but it MUST still be capable
of applying the protocol limits when validating authoritative records; local
policy cannot redefine protocol validity.

The base grammar permits no compression or back-references. Transport-level
compression, if later allowed, is outside the canonical identity and MUST be
expanded under independently specified compressed-input and expanded-output
bounds before canonical decoding.

## 7. Canonicality and rejection

For every supported value `x` and accepted byte string `b`:

```text
decode(encode(x)) = x
encode(decode(b)) = b
```

The second equality is an acceptance requirement, not a repair procedure. A
validator MUST NOT parse an alternate form, re-encode it, and then accept the
re-encoded bytes.

A decoder MUST reject at least the following conditions:

- wrong magic, zero or unsupported version, unexpected domain, or unknown type;
- truncated envelope, truncated payload, length arithmetic overflow, declared
  length mismatch, or trailing bytes;
- object, payload, field, count, aggregate-element, embedded-object, or nesting
  limit violation;
- a boolean or option tag other than `00` or `01`;
- a zero or unknown union variant;
- an integer outside a field's semantic range;
- a record whose bytes cannot be consumed as its exact declared field sequence;
- duplicate or non-canonically ordered set/map-style entries;
- an embedded object not allowed by the parent schema;
- any unconsumed payload or root-object byte.

Schemas registering text, floating-point, signed-integer, associative, set,
null, or default semantics are forbidden unless a versioned extension defines
their complete canonical wire and equality rules. A positional decoder cannot
classify arbitrary bytes as an undeclared high-level type; rejection is based
only on mechanically detectable envelope, bound, schema, canonicality, and
semantic failures.

Canonical decoding and semantic validation are separate stages, but failure in
either stage rejects the object. Neither stage may mutate persistent state,
invoke an authorization side effect, or partially commit decoded values.

## 8. Binding and transport rules

The complete `CanonicalObjectV1` byte string, including the domain and every
version/type field, is the canonical source object for later commitment and
authentication ADRs. Those ADRs may define a typed transcript over these bytes,
but MUST NOT silently substitute a second serialization.

Whether a cryptographic construction consumes the complete object as one
element or consumes explicitly enumerated canonical components remains an
ADR-002/ADR-003 decision. An enumerated construction MUST bind `magic`,
`grammar_version`, `protocol_version`, `domain_id`, `object_type`,
`schema_version`, and the complete payload; no envelope identity field may be
omitted. This ADR chooses no hash, commitment, signature, or transaction-ID
algorithm.

A transport may add its own framing, but its declared canonical-object length
MUST equal the complete object length. Transport metadata, compression, peer
identity, and arrival order do not become part of the canonical object unless a
later object schema includes them explicitly.

## 9. Conformance vectors

Vectors are test artifacts, not protocol objects. Their manifest format MAY be
JSON or another tooling format, but byte fields MUST be represented as
lowercase hexadecimal and integers that exceed a tooling format's exact range
MUST be represented as decimal strings.

Every vector set MUST embed its exact named parameter-value map. It MAY also
name an immutable published profile version and digest, but an identifier alone
is insufficient. Every set contains:

```text
vector_format_version = 1
case_id
description
parameter_profile_id
parameter_profile_values
input_hex
expectation
```

An accepting vector additionally contains:

```text
expectation = "accept"
expected_envelope = {
  grammar_version,
  protocol_version,
  domain_id_hex,
  object_type,
  schema_version,
  payload_length
}
expected_value_format
expected_value
expected_reencode_hex
```

`expected_reencode_hex` MUST be byte-for-byte identical to `input_hex`.
The object vector profile MUST define a language-independent representation for
`expected_value` and name it in `expected_value_format`; envelope-only vectors
that intentionally test no payload schema MAY omit both fields.
Cryptographic outputs are intentionally absent until the applicable later ADR
selects a construction.

A rejecting vector additionally contains:

```text
expectation = "reject"
expected_stage
expected_reason
derived_from_case_id   # when the case is a mutation of an accepting vector
mutation_description
```

`expected_stage` is one of `framing`, `envelope`, `bounds`, `schema`,
`canonicality`, or `semantics`. Stable vector reason identifiers MUST cover at
least:

```text
TRUNCATED
TRAILING_BYTES
BAD_MAGIC
UNSUPPORTED_GRAMMAR_VERSION
INVALID_PROTOCOL_VERSION
UNKNOWN_PROTOCOL_VERSION
INVALID_DOMAIN_LENGTH
UNEXPECTED_DOMAIN
ZERO_OBJECT_TYPE
UNKNOWN_OBJECT_TYPE
ZERO_SCHEMA_VERSION
UNKNOWN_SCHEMA_VERSION
LENGTH_MISMATCH
LENGTH_OVERFLOW
LIMIT_EXCEEDED
INVALID_SCALAR
INVALID_BOOLEAN_TAG
INVALID_OPTION_TAG
UNKNOWN_UNION_VARIANT
NON_CANONICAL_ORDER
DUPLICATE_KEY
INVALID_NESTING
SEMANTIC_INVALID
```

The reason-to-stage mapping and within-stage precedence are normative:

| Stage | Reasons in precedence order |
|---|---|
| `framing` | `TRUNCATED`, `TRAILING_BYTES` |
| `envelope` | `BAD_MAGIC`, `UNSUPPORTED_GRAMMAR_VERSION`, `INVALID_PROTOCOL_VERSION`, `UNKNOWN_PROTOCOL_VERSION`, `INVALID_DOMAIN_LENGTH`, `UNEXPECTED_DOMAIN`, `ZERO_OBJECT_TYPE`, `UNKNOWN_OBJECT_TYPE`, `ZERO_SCHEMA_VERSION`, `UNKNOWN_SCHEMA_VERSION` |
| `bounds` | `LENGTH_OVERFLOW`, `LENGTH_MISMATCH`, `LIMIT_EXCEEDED`, `INVALID_NESTING` |
| `schema` | `INVALID_SCALAR`, `INVALID_BOOLEAN_TAG`, `INVALID_OPTION_TAG`, `UNKNOWN_UNION_VARIANT` |
| `canonicality` | `NON_CANONICAL_ORDER`, `DUPLICATE_KEY` |
| `semantics` | `SEMANTIC_INVALID` |

When one input violates multiple rules, its vector records the first reason
encountered by Section 10; reasons within the same stage use the table order.

Implementations may expose less detailed errors to untrusted peers, but their
conformance harnesses MUST distinguish the published vector outcomes.

For every envelope and payload schema, the vector suite MUST include:

- minimum values, exact-limit values, and every applicable limit plus one when
  the latter is representable by the wire type;
- truncation at each structural boundary and representative payload offsets;
- declared lengths shorter and longer than the available bytes;
- trailing bytes at the payload and root-object levels;
- zero, unknown, and downgrade version/type/discriminator cases;
- invalid boolean and option markers;
- maximum-depth and maximum-depth-plus-one cases;
- empty, singleton, maximum-count, maximum-count-plus-one, duplicate, and
  out-of-order collection cases where applicable; and
- a mutation of every field that participates in semantic validation.

Each negative vector SHOULD isolate one primary defect so independent parsers
can agree on the rejection stage. At least two independently developed
implementations MUST agree on every accepting and rejecting vector before this
grammar may pass the Charter-000 implementation gate.

For production bounds that would make a checked-in fixture impractically large,
the vector set MAY specify a deterministic generator, its immutable source
digest, and the expected generated length/digest instead of embedding the full
fixture. Implementations MUST still execute that boundary case.

## 10. Required validation pipeline

An authoritative implementation MUST perform validation in this order:

1. establish the physically available root-object length;
2. parse the fixed prefix through `domain_length` and validate checked length
   arithmetic against the physically available bytes;
3. compare the opaque domain bytes with the validation context without
   allocating an attacker-sized copy, reject a protocol version not permitted
   by that context's external activation rule, and only then load the exact
   preconfigured local profile for that domain/version pair;
4. parse the remaining envelope and enforce the profile's envelope, domain,
   object, and payload bounds;
5. resolve the registered object type and schema version;
6. decode the payload while enforcing individual and cumulative bounds;
7. require complete byte consumption and canonical ordering;
8. perform only bounded, context-free object-specific semantic checks; and
9. hand the immutable decoded result and exact canonical bytes to the
   later-specified validation pipeline.

Later ADRs determine the relative order of authentication, commitments,
state-dependent validation, execution, and consensus. This ADR does not force
expensive or stateful work before cheaper rejection checks.

Any failure returns rejection without persistent mutation. Implementations MAY
combine steps internally for performance only if their observable acceptance,
rejection, resource limits, and vectors remain identical.

## 11. Unresolved gates

This ADR deliberately leaves the following decisions open:

- D-001 through D-005: product outcome, artifact identity, state, token, and
  consensus;
- D-007 and D-008: commitment primitive and authenticated-tree construction;
- D-009 through D-011: authentication, key lifecycle, and identifier semantics;
- D-012: exact production resource-limit values and object-specific limits;
- D-013: domain/chain identifier, genesis, and upgrade activation;
- D-014: privacy and retention semantics; and
- D-015: research-rail promotion.

The next specification work after accepting this framework is to assign an
exact protocol-domain profile and publish the first concrete object schema with
its complete accepting and rejecting vectors. No prototype block or transaction
layout is grandfathered into that schema.
