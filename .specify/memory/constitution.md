<!--
SYNC IMPACT REPORT
Version change: (none) → 1.0.0
Rationale: Initial ratification. MAJOR set to 1 because this is the first binding
governance document for the project; no prior principles existed to break.

Principles defined (7, expanded from the 5 template slots):
  I.   Privacy First (NON-NEGOTIABLE)   [new]
  II.  Client-Side Computation          [new]
  III. Explainability Is First-Class    [new]
  IV.  Learner-Accessible by Default    [new]
  V.   Technovation Design System       [new]
  VI.  Test-First for the ML Core       [new]
  VII. Simplicity (YAGNI)               [new]

Added sections:
  - Additional Constraints (technology + data-protection constraints)
  - Development Workflow & Quality Gates
  - Governance

Removed sections: none.

Follow-up TODOs:
  - TODO(TECHNOVATION_TRADEMARK): Written confirmation from the Technovation
    program is required before shipping the Technovation logo or wordmark
    publicly. Colour tokens and Google-Fonts typefaces are unaffected.
-->

# ML4G · Explainable AI Lab Constitution

## Core Principles

### I. Privacy First (NON-NEGOTIABLE)

Captured images and trained models MUST remain on the learner's device, persisted in browser
storage. The application MUST NOT transmit image data, video frames, or model weights to any
server, including the project's own BaaS provider, except through an action the learner
explicitly initiates and that names the destination.

Remote storage is limited to identity, classroom membership, project metadata, aggregate
metrics, lesson progress, and learner-authored reflection text. Learner accounts MUST use
aliases rather than real names, and MUST be provisionable by an educator so that minors never
supply personal data directly.

*Rationale*: The primary users are 12–18 year olds pointing a webcam at their own faces and
homes. Under GDPR this is special-category processing of minors' data, and the only defensible
design is one where the sensitive data never leaves the device. This constraint also removes
an entire class of breach risk from the threat model.

### II. Client-Side Computation

Inference, training, and explanation generation MUST execute entirely in the browser. The
project MUST NOT introduce server-side code that it owns and operates; a managed BaaS covering
only identity and progress persistence is the sole permitted backend dependency.

Any feature proposal that requires a request/response round trip to compute a prediction or an
explanation MUST be rejected or redesigned.

*Rationale*: Zero-server operation keeps hosting free and reliable for schools, works when a
classroom's connection is poor, and makes Principle I structurally true rather than merely
promised — data cannot leak over a channel that does not exist.

### III. Explainability Is First-Class

No prediction may be presented without an accompanying route to an explanation. The application
MUST implement at least two independent explanation methods, one gradient-based and one
perturbation-based, and MUST allow a learner to view both for the same input.

Explanations MUST be framed as evidence rather than truth: the interface MUST NOT assert that a
heat map shows why the model decided, and MUST make it possible for the two methods to visibly
disagree rather than hiding or reconciling the discrepancy.

*Rationale*: The product teaches explainable AI, so its own epistemics are part of the
curriculum. A single heat map presented authoritatively would teach the opposite of the intended
lesson. Two methods that sometimes disagree teach that explanations are themselves models with
limitations.

### IV. Learner-Accessible by Default

The interface MUST be usable by a 12–18 year old with no prior ML background. Concretely:

- English is the default locale; Spanish MUST be selectable. All user-facing strings MUST be
  externalised into locale files — no literal user-facing text in components. A missing key in
  any shipped locale MUST fail the build or test suite.
- The interface MUST be responsive and MUST support the full learner journey — capture, train,
  test, explain — at 360 px viewport width on a touch device.
- The interface MUST meet WCAG 2.1 Level AA, including keyboard operability of the capture and
  training controls and text alternatives for every heat map.
- The application MUST remain functional on a low-end Chromebook without a discrete GPU,
  degrading speed rather than removing capability.

*Rationale*: Technovation reaches participants worldwide on whatever hardware their school has.
A tool that only works on a fast laptop in English excludes most of the intended audience.

### V. Technovation Design System

All colour and typography MUST come from the Technovation design tokens declared once as CSS
custom properties and exposed through the styling framework's theme. Components MUST NOT declare
ad-hoc hex values, font families, or font stacks.

Tokens whose contrast ratio against white falls below WCAG AA for body text MUST be restricted
to fills, borders, and backgrounds behind dark text, and MUST NOT be used for text on light
backgrounds.

Explanation heat maps are exempt from the brand palette and MUST instead use a perceptually
uniform, colour-vision-deficiency-safe ramp, chosen to be visually distinct from the brand
accents so that heat is never confused with interface chrome. Every heat map MUST ship a legend
with its scale.

*Rationale*: The product represents the Technovation program, so visual coherence matters. But a
heat map is a data visualisation, not chrome; forcing brand colours onto it would destroy the
quantitative reading that the whole XAI lesson depends on.

### VI. Test-First for the ML Core

The training engine, both explanation methods, and the evaluation metrics MUST have automated
tests written before they are wired to any UI. These tests MUST run against committed fixture
images with a fixed random seed so results are deterministic and regressions are attributable.

The ML core MUST be importable and testable without a DOM, a camera, or a network.

*Rationale*: ML bugs are silent — a broken gradient computation still produces a plausible-looking
heat map. Without deterministic tests the project would ship confident, wrong explanations to
learners, which is worse than shipping none.

### VII. Simplicity (YAGNI)

The project MUST remain a single deployable static site with a single package manifest — no
monorepo, no workspaces. Abstraction layers over third-party services MUST NOT be introduced
while only one provider is in use. New dependencies MUST be justified against what the platform
already provides.

*Rationale*: The codebase will be read and extended by students, mentors, and volunteers, not by
a dedicated engineering team. Indirection that a professional codebase would absorb easily is a
hard barrier here.

## Additional Constraints

**Technology constraints**

- Frontend: React with TypeScript, built by a modern bundler, deployed as static assets.
- ML runtime: TensorFlow.js with a GPU-accelerated backend and a CPU/WASM fallback that MUST be
  exercised in testing, not merely configured.
- Transfer learning MUST freeze the pretrained backbone and train only a small classification
  head, so training completes in seconds on classroom hardware.
- Local persistence: IndexedDB for samples and saved models.
- Remote persistence: managed Postgres with row-level security enabled on every table. No table
  containing learner data may be readable without a policy that names the permitted role.

**Data-protection constraints**

- Educator access is scoped to their own classroom, and MUST expose progress, metrics, and
  reflections only — never images.
- Row-level security policies MUST be treated as contracts and MUST have tests proving that a
  learner cannot read another learner's rows and that an educator cannot read another
  classroom's rows.
- Exported artifacts MUST require an explicit learner action and MUST state what the export
  contains before it is produced.

**Performance constraints**

Performance targets are product requirements, not aspirations; a change that regresses a stated
target MUST be treated as a defect. Concrete budgets live in the feature specification so they
can evolve per release without amending this constitution.

## Development Workflow & Quality Gates

- Work follows Spec-Driven Development: specification, then plan, then tasks, then
  implementation. Implementation MUST NOT begin before a plan has passed the Constitution Check.
- Every feature specification MUST decompose into independently testable, independently
  demonstrable user stories, each of which is a viable slice on its own.
- Every functional requirement MUST be traceable to at least one task, and every task MUST be
  traceable to at least one requirement.
- Pull requests MUST state which principles the change touches and how it complies. A reviewer
  MUST reject a change that violates a principle without a recorded justification in the plan's
  Complexity Tracking table.
- Automated gates required before merge: type checking, linting, unit tests for the ML core,
  end-to-end tests at mobile and desktop viewports, locale-completeness check, and an
  accessibility check of the primary journey.
- Learning content MUST be reviewed by someone with classroom experience before release. A
  technically correct lesson that does not teach is a defect.

## Governance

This constitution supersedes all other development practices, conventions, and preferences in
this repository. Where a style guide, template, or habit conflicts with a principle here, the
principle wins.

**Amendment procedure**: Amendments MUST be proposed as a pull request that modifies this file,
states the rationale, and identifies every downstream artifact requiring an update. An amendment
MUST NOT be merged without an explicit approval from the project owner. Principle I is
non-negotiable: it may be clarified or strengthened, but any proposal to weaken it MUST be
rejected.

**Versioning policy**: This document uses semantic versioning. MAJOR for removing or redefining a
principle in a backward-incompatible way, MINOR for adding a principle or materially expanding
guidance, PATCH for clarifications and wording that do not change obligations.

**Compliance review**: Compliance is verified at three points — during `/speckit-plan` via the
Constitution Check gate, during code review via the pull-request statement above, and at each
release via a checklist run over the primary learner journey. Violations found after merge MUST
be logged as defects and either remediated or recorded in the plan's Complexity Tracking table
with the simpler alternative that was rejected and why.

**Version**: 1.0.0 | **Ratified**: 2026-08-17 | **Last Amended**: 2026-08-17
