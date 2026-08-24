# Specification Quality Checklist: Explainable AI Lab

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-17
**Last validated**: 2026-08-17 (after the `/speckit-clarify` session below, constitution v3.1.0)
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`

### Resolved in this revision

Three defects raised by `/speckit-analyze` were closed while the document was open:

- **Unfalsifiable performance targets.** SC-002, SC-003, SC-008 and SC-012 referred to a "mid-range
  laptop" and a "mid-range phone" that no artifact defined. Assumptions now names three reference
  devices — laptop, Chromebook, phone — and the criteria refer to them.
- **Unquantified FR-008.** "At most a small number" of training settings is now "at most three".
- **Ambiguous identity.** FR-051 makes a username unique system-wide and an alias unique within a
  classroom, so no roster or export can be ambiguous. Two matching edge cases were added.

### Judgement calls recorded

- **Classroom join codes were removed, not kept.** With an educator creating a learner directly
  inside her classroom, a separate "join the classroom with a code" step is the same mechanism
  reached by a second route. FR-038 and FR-039 now cover create/rename/archive and membership
  management; SC-013 measures time to a first learner invitation rather than to a join code. This
  also closes the previously unspecified case of an educator removing a learner.
- **Six requirements were appended rather than renumbered.** FR-024 and FR-026…FR-030 were rewritten
  in place because the surviving requirement in each slot changed meaning. The genuinely new
  obligations — identity uniqueness, educator revoke/delete, and the four administration
  requirements — took FR-051…FR-056 so that every pre-existing identifier keeps pointing at the same
  obligation for traceability.
- **Reference-device names are hardware, not implementation.** Naming a Celeron N4020 and a
  Snapdragon 695 in a specification is a deliberate exception to the no-implementation-detail rule:
  a performance budget that cannot be attributed to a device cannot be proved or disproved.

### Clarification session, 2026-08-17

Five questions asked and answered; no checkbox changed state (16/16 before and after), because the
session closed gaps the checklist does not measure — unbacked requirements and unquantified
adjectives — rather than structural defects. Added FR-057 and FR-058, SC-019 through SC-021, and two
edge cases.

One item moved closer to its line and is worth watching: **no implementation details**. FR-028 now
names a code length and alphabet, FR-043 names CSV and formula-prefix neutralisation, and FR-053
names a mail client and the clipboard. Each is user-observable — a learner types the code, an educator
opens the file, an administrator sends the message — so each is judged specification rather than
implementation, on the same reasoning already recorded for the reference devices. If a future revision
adds a library name or an API to this list, that judgement no longer holds.

### Open items owned elsewhere

- `TODO(CONTROLLER_AGREEMENT)` — the split of data-controller responsibility between the project and
  participating schools needs legal review before public launch. Recorded in the constitution;
  reflected here in the Data controller assumption. Blocks launch, blocks no development.
- `TODO(TECHNOVATION_TRADEMARK)` — logo and wordmark usage awaits program confirmation.
