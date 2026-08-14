# Protocol Observatory — Design QA

## Result

**passed (scope: Protocol Observatory panel only; this review did not audit the
3072 rail, transport controls, or the complete test suite)**

No unresolved P0, P1, or P2 Observatory visual, interaction, accessibility, or
copy issue was observed in the exercised 1280 × 720 panel path. This result is
not evidence of protocol correctness, cryptographic security, or whole-app
readiness.

## Evidence

- Screenshots were reviewed in-session but are not tracked by this repository;
  this visual QA is therefore not independently reproducible from the repository.
- Reviewed URL: `http://localhost:5273/`
- Reviewed state: Protocol Observatory open; Map view; all systems; every status; no search query.
- Source image dimensions: 3456 × 2234.
- Implementation image dimensions: 1280 × 720.
- Implementation CSS viewport: 1280 × 720 at device scale factor 1.
- The source and implementation are different product states. Comparison therefore tests fidelity to UIA's design system—not pixel-for-pixel layout identity.

The full-resolution implementation screenshot was sufficient to inspect the gate rail, system/status filters, work cards, evidence inspector, labels, borders, typography, spacing, and overflow. No additional crop was needed because these regions remained legible at their captured size.

## Visual comparison

The Observatory preserves the source application's visual grammar: warm graphite surfaces, bone text, restrained hairlines, serif display titles, monospaced metadata, square low-radius controls, and an intentionally dense archival-instrument character. It introduces no gradients, ornamental imagery, or unearned status colour. “NOT PRODUCTION,” the non-normative gate label, and item-level evidence scope remain visible without relying on colour alone.

The final hierarchy is clear at 1280 × 720:

1. protocol status and explicit non-production boundary;
2. proposed planning gates;
3. system/status navigation;
4. obligation map or matrix/decision alternatives;
5. item-specific evidence, dependencies, risks, and completion criteria.

## Iteration history

### Pass 1 findings

- The Protocol trigger also matched the legacy drawer handler and could immediately undo its own expanded state.
- “Production gates,” “verified,” and breakthrough copy overstated draft planning or recorded objectives as proven system properties.
- The readiness matrix mixed existing archive-app maturity with future protocol deployment.
- The gate rail implied a strict linear dependency graph even though consensus, economics, networking, storage, and timing require co-design.
- Filters lost focus after rerender; rows in Matrix were click-only; tabs lacked complete keyboard semantics.
- The initial 761 px layout retained a dense three-column presentation and several labels used 8–10 px text.
- Product outcome, provenance semantics, issuer authority, privacy/takedown, disputes, secure sessions, node roles, operations, history, and launch assurance were not all first-class obligations.
- Open decisions were connected to work heuristically rather than by explicit identifiers.

### Fixes applied

- Scoped the legacy drawer listener to `.tab[data-drawer]` and isolated Observatory modal state.
- Renamed the rail “Proposed planning gates” and documented it as a non-normative observability model.
- Split scoped facts (`Verified`) from accepted boundaries/objectives (`Recorded`).
- Changed draft/system copy to state exactly what exists and what remains proposed.
- Marked every protocol deployment state as `None` unless an authoritative protocol implementation exists.
- Made G4 an explicit consensus/timing/network/storage/economics co-design gate and removed strict-DAG language.
- Added focus restoration, ARIA tab panels, roving tab focus, arrow/Home/End navigation, real row buttons, Escape close, modal focus containment, background inertness, and return focus.
- Added two-pane and stacked responsive paths at 1180 px and 960 px, increased small metadata sizes, and enabled resilient navigation overflow.
- Expanded the evidence model to 84 obligations across 12 systems, including the missing product, privacy, authority, transport-security, trust-topology, operations, and assurance work.
- Added explicit decision-to-work-item mappings and stronger model validation for references, cycles, evidence, completion criteria, and conditional semantics.

### Pass 2 evidence

- Map, Matrix, and Decisions views render and switch correctly.
- Search filters and clears correctly.
- Filter focus survives rerender.
- Keyboard tab switching and roving tab state work.
- Escape closes the Observatory, restores focus to Protocol, and releases the background.
- D-001 resolves to `Primary protocol outcome`; D-014 resolves to `Privacy, retention, and takedown policy`.
- Runtime log inspection after Map/Matrix/Decisions and search interactions produced zero new warnings or errors.
- Final copy shows 84 obligations, 12 systems, 15 open decisions, 11 proposed planning gates, and 0 passed/current gates without presenting a synthetic progress percentage.

## Residual test boundary

The final browser capture was performed at 1280 × 720. The ≤1180 px, ≤960 px, and ≤620 px paths were reviewed in the implemented CSS but were not independently captured in the in-app browser during this pass. This is a coverage note, not an observed defect.

## Functional verification boundary

- The historical `142 / 142` result referred only to the engine test command; it
  did not include the separately configured browser suite.
- Pre-M2 browser artifacts record two failing experimental specs. Integrated
  engine and browser results must be measured and reported separately.
- Progress-model validation checks model structure and references; it does not
  verify the truth of hand-authored evidence citations.
- Build and runtime-interaction observations from the original review were
  in-session observations, not a durable repository verification record.
