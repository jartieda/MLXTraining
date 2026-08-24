<!--
SYNC IMPACT REPORT
Version change: 2.0.0 → 3.1.0 (two amendments applied in sequence, recorded together)

=== Amendment 2 of 2: 3.0.0 → 3.1.0 (MINOR) ===

Trigger: the project owner chose an in-product administration screen, and chose single-use
invitation codes as the provisioning mechanism for every account.

Rationale for MINOR: most of this amendment is clarification that would have been PATCH — the
v3.0.0 phrase "no self sign-up for any role" read as a ban on the very API call the chosen
mechanism uses, and the origin of the first administrator was undefined. But one bullet adds a
genuinely new obligation (an administrator may not read classroom contents), and adding an
obligation is a material expansion of guidance, so MINOR governs the pair.

  - CLARIFIED (Principle I): registration gated on a valid invitation is not self sign-up. What is
    forbidden is an account nobody authorised. This keeps the obligation and removes a false
    conflict with the chosen mechanism.
  - CLARIFIED (Principle I): the first administrator is seeded by database migration, and the
    application exposes no path to create an administrator.
  - STRENGTHENED (Principle I, Data-protection): an invitation is redeemed by its holder, who sets
    her own password, so an educator never learns a learner's password. This is stricter than
    v3.0.0, which allowed an educator to assign a password directly.
  - ADDED (Data-protection): an administrator MUST NOT be able to read classroom contents — no
    learner account, progress, reflection, metric, or image. Administration is limited to issuing
    and revoking educator invitations and deactivating educator accounts. This is the new
    obligation that makes the bump MINOR rather than PATCH.

=== Amendment 1 of 2: 2.0.0 → 3.0.0 (MAJOR) ===

Rationale for MAJOR: this amendment reverses the v2.0.0 account-creation decision and REMOVES
obligations that v2.0.0 stated as binding — the age declaration at sign-up, the verifiable
parental-consent gate, the pending-account state, and the framing of an email address as the one
personal datum collected from every user. Removing a stated obligation is backward-incompatible
under this document's own versioning policy, so the bump is MAJOR even though the protective effect
of the replacement is stronger: an application that holds no learner personal data at all has no
consent question to answer inside itself.

What changed in Principle I:
  - REMOVED: open self sign-up with an email address for all users, including minors.
  - REMOVED: the framing of an email address as the only personal datum the application collects
    from every user. A learner now supplies none at all.
  - REMOVED: the mandatory age declaration at sign-up.
  - REMOVED: the mandatory verifiable parental or guardian consent gate, and with it the
    pending-account state and the consent-withdrawal obligation.
  - ADDED (now binding):
      * Learner accounts are created by an educator inside a classroom, with a username and a
        password, and the application collects no learner personal data whatsoever.
      * Learner password recovery goes through the educator; the application never emails a learner.
      * Educator accounts are provisioned by invitation from a program administrator.
      * There is no self sign-up for any role.
      * An unauthenticated visitor keeps the complete local lab experience.
  - UNCHANGED: the non-negotiable locality guarantee for images and models; mandatory aliases on
    every display surface; an educator's email address as the only personal datum in the system.

Modified sections:
  - Principle I. Privacy First (account-creation obligations replaced; consent obligations removed)
  - Additional Constraints → Data-protection constraints (age, pending-state, and consent
    obligations replaced by no-learner-personal-data, educator provisioning, educator-performed
    deletion, and an explicit allocation of data-controller responsibility)

Principles unchanged: II, III, IV, V, VI, VII.
Added sections: none. Removed sections: none.

Follow-up TODOs:
  - CLOSED TODO(CONSENT_MECHANISM): no longer applicable. The application collects no learner
    personal data and records no consent, so there is no verification mechanism to design and no
    per-jurisdiction digital-consent age to resolve.
  - TODO(CONTROLLER_AGREEMENT): the division of data-controller responsibility between the project
    and the schools that provision learner accounts requires legal review before public launch,
    including what the project must disclose to a school before that school creates accounts for
    its minors.
  - TODO(TECHNOVATION_TRADEMARK): unchanged. Written confirmation from the Technovation program is
    required before shipping the Technovation logo or wordmark publicly. Colour tokens and
    Google-Fonts typefaces are unaffected.

Downstream artifacts requiring update (per the amendment procedure below):
  - specs/001-xai-lab/spec.md — User Story 4, FR-023…FR-032, SC-014…SC-016, the consent edge cases,
    and the Accounts / Age and consent / Deletion assumptions
  - specs/001-xai-lab/plan.md — Constitution Check row for Principle I, and the auth summary
  - specs/001-xai-lab/data-model.md — profiles, consent_records (removed), enrolments
  - specs/001-xai-lab/contracts/database.md — G3, P4, C1–C4 (removed), E6, and the required test
    scenarios that assert consent behaviour
  - specs/001-xai-lab/research.md — the "Deferred to legal review" section
  - specs/001-xai-lab/tasks.md — Phase 6 (US4), T007, T029–T032, T106
-->

# ML4G · Explainable AI Lab Constitution

## Core Principles

### I. Privacy First (NON-NEGOTIABLE)

Captured images and trained models MUST remain on the learner's device, persisted in browser
storage. The application MUST NOT transmit image data, video frames, or model weights to any
server, including the project's own BaaS provider, except through an action the learner
explicitly initiates and that names the destination.

The non-negotiable core of this principle is that locality guarantee. It may be clarified or
strengthened but MUST NOT be weakened.

Remote storage is limited to identity, classroom membership, project metadata, aggregate
metrics, lesson progress, and learner-authored reflection text. Beyond that:

- The application MUST NOT collect any personal data from a learner — no email address, no date of
  birth, no real name. A learner account is created by an educator inside a classroom and is
  identified only by an educator-assigned username and a self-chosen alias.
- Learner password recovery MUST go through the learner's educator. The application MUST NOT send
  email to a learner, because it holds no address to send one to.
- An educator's email address is the only item of personal data the application may collect, and it
  MUST be used only for authentication and password recovery. It MUST NOT be displayed to learners,
  used for marketing, or shared with a third party.
- Every display surface — rosters, exports, leaderboards, shared views — MUST identify a learner by
  her self-chosen alias and MUST NOT reveal a username, a real name, or an email address to another
  learner.
- No account may be created except in response to an invitation issued by someone already
  authorised to issue it. Learner accounts are invited by an educator within her own classroom;
  educator accounts are invited by a program administrator; the first administrator is seeded by
  database migration, and the application MUST expose no path to create an administrator. An
  invitation is redeemed by its holder, who sets her own password — so an educator MUST NOT be able
  to learn a learner's password. Registration gated on a valid invitation is not self sign-up; what
  this principle forbids is an account that nobody authorised.
- An unauthenticated visitor MUST retain the complete local lab experience — capture, train, test,
  and explain — with no account and with nothing persisted remotely.

*Rationale*: The primary users are 12–18 year olds pointing a camera at their own faces and homes.
Under GDPR the images are the sensitive part, and the only defensible design is one where they never
leave the device — hence the absolute locality rule. Around that rule, the strongest available
position is to hold nothing personal about a minor at all. A username and password issued by an
educator carry a learner's progress across sessions just as well as an email address would, so the
email address is not worth its cost. Educator provisioning also restores the classroom-level control
the program actually runs on, and it removes an entire class of risk — a consent exchange with a
third party the application can neither verify nor supervise.

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

- The application MUST NOT store any personal data belonging to a learner. An automated test MUST
  prove that no table holds a learner email address, date of birth, or real name.
- A learner account MUST originate from an invitation issued by an educator within a classroom she
  owns, and that educator MUST be able to issue a password reset for it without any email exchange.
  The learner sets and holds her own password; the educator never learns it.
- Educator accounts MUST originate from an invitation issued by a program administrator. The
  application MUST NOT expose a registration path that a visitor can complete without a valid
  invitation, for any role.
- An administrator MUST NOT be able to read classroom contents — no learner account, progress,
  reflection, metric, or image. Administration is limited to issuing and revoking educator
  invitations and deactivating educator accounts.
- The school or program operating a classroom is the data controller for its learners and is
  responsible for obtaining whatever parental permission its jurisdiction requires, outside this
  application. The project's defensible position rests on collecting no learner personal data at
  all, not on recording a consent decision it cannot verify.
- An educator MUST be able to delete a learner's account, and deletion MUST remove every remote row
  belonging to that account.
- Educator access is scoped to their own classroom and MUST expose progress, metrics, and
  reflections only — never captured images. An educator necessarily knows the usernames she issued;
  no other learner may see them.
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
MUST NOT be merged without an explicit approval from the project owner. The non-negotiable core
of Principle I — that captured images and trained models never leave the learner's device other
than through an explicit, destination-named learner action — may be clarified or strengthened, but
any proposal to weaken it MUST be rejected.

**Versioning policy**: This document uses semantic versioning. MAJOR for removing or redefining a
principle in a backward-incompatible way, MINOR for adding a principle or materially expanding
guidance, PATCH for clarifications and wording that do not change obligations.

**Compliance review**: Compliance is verified at three points — during `/speckit-plan` via the
Constitution Check gate, during code review via the pull-request statement above, and at each
release via a checklist run over the primary learner journey. Violations found after merge MUST
be logged as defects and either remediated or recorded in the plan's Complexity Tracking table
with the simpler alternative that was rejected and why.

**Version**: 3.1.0 | **Ratified**: 2026-08-17 | **Last Amended**: 2026-08-17
