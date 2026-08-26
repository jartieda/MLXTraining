# Contributing

This codebase is read and extended by students, mentors and volunteers rather than by a dedicated
engineering team. Indirection that a professional codebase absorbs easily is a hard barrier here, so
the project prefers one obvious way over a flexible one, and it prefers comments that say *why*.

Start with [README.md](README.md) for setup. This file is about the boundaries the build enforces —
what will fail, and why it exists.

## Read Principle I before you write anything

[The constitution](.specify/memory/constitution.md) has seven principles. The first one is marked
non-negotiable, and it is the reason for most of the rules below:

> Captured images and trained models MUST remain on the learner's device.

The primary users are 12–18 year olds pointing a camera at their own faces and their own bedrooms.
The images are the sensitive part, and the only defensible design is one where they never leave.
Everything awkward about this codebase — no server, a DOM-free ML layer, three lint rules, a
row-level-security test suite — is that principle made structural rather than promised.

**A change that weakens it gets rejected rather than discussed.** It may be clarified or
strengthened. Amending it needs a pull request against the constitution and the project owner's
explicit approval.

## Four boundaries the build enforces

### 1. `src/ml/` has no DOM, no network, and no feature imports

Enforced by `ml4g/ml-core-import-boundary`.

The ML core takes an `ImageSource` — a plain `{ data, width, height }` — never an
`HTMLVideoElement`. The conversion happens at the feature boundary, in
[`camera.ts`](src/lib/camera.ts) and the upload path.

This is what makes Principle VI enforceable. ML bugs are silent: a broken gradient computation still
produces a plausible-looking heat map, and the only way to catch it is a deterministic test against
committed fixtures with a fixed seed, in a node environment. That test cannot exist if the module
needs a browser.

### 2. Colour and typography come from the tokens

Enforced by `ml4g/no-raw-hex-or-font-family` in `components/`, `features/` and `routes/`.

No `#7B2CBF`, no `rgb(...)`, no `font-family`. Use the Tailwind theme, which maps
[`tokens.css`](src/styles/tokens.css).

Two exemptions, both deliberate:

- **[`colormap.ts`](src/ml/explain/colormap.ts)** — Principle V exempts heat maps so they can use a
  perceptually uniform ramp. A heat map is a data visualisation, and forcing brand colours onto it
  would destroy the quantitative reading the whole XAI lesson depends on. It also owns `rampInk`,
  the text colours for labels sitting *on* the ramp — those are deliberately not `--tv-ink` tokens,
  because the ink tokens flip with the theme and the ramp does not.
- **`--tv-amber`, `--tv-green`** — below AA on white, so fill and border only, never text. The
  header comment in `tokens.css` says which. `--tv-blue` is the same story: it is the action *fill*,
  and `--tv-blue-ink` is the AA-compliant text version. Using `text-blue` where you mean a link is
  a contrast failure the a11y suite will catch.

### 3. Educator and administrator screens cannot import the local store

Enforced by `ml4g/no-local-store-in-classroom` in `features/classroom/` and `features/admin/`.

No `@/lib/db`, no `labStore`, no `@/ml`.

FR-041 says no view or export makes a learner's captured images reachable by an educator. Across
devices that is already true — the images are in her IndexedDB and there is no channel to them. What
this rule closes is a **shared classroom Chromebook**, where the educator's browser may well be
holding a learner's local store from the previous lesson. A roster component that imported `db` to
"show a thumbnail" would work on exactly that machine and nowhere else, which is the worst possible
way for a privacy boundary to fail.

### 4. Every user-facing string lives in `src/locales/`

Enforced by `npm run test:i18n`, which fails on a key present in `en` and missing from `es`, on an
orphaned `es` key, on a value copied across untranslated, and on a mismatched `{{placeholder}}`.

No project has ever achieved zero untranslated strings by discipline. English gets added under
deadline, Spanish is "caught up later", and a Spanish-speaking learner meets a half-English
interface. This makes that a red build instead.

## Tests

| Command | Runs |
|---|---|
| `npm run typecheck && npm run lint` | Start here |
| `npm run test:ml` | ML core, node environment, fixed-seed fixtures |
| `npm test` | Everything Vitest can run |
| `npm run test:db` | RLS policies against a real Postgres — needs Docker |
| `npm run test:e2e` | Playwright at 360×740 and 1440×900 |
| `npm run test:a11y` | `axe`, zero violations, no allowlist |
| `npm run test:network` | No image or model bytes leave the device |
| `npm run check:bundle` | Initial route under 200 KB gzipped |

Three things about them are worth knowing before you add one.

**A skip is not a pass.** The database and signed-in e2e suites skip without a local Supabase and are
merge-blocking in CI. If you change anything touching accounts, classrooms or administration, run
them with Docker before opening a pull request — the alternative is finding out in CI, which is
slower for you and noisier for everyone.

**The row-level-security policies are contracts, not configuration.** There is no server, so the
policies *are* the authorisation model. `tests/db/` treats them as a contract suite. Never mock
them: a mocked policy engine asserts nothing about the thing being relied on.

**Tests assert the absence of things, and those assertions are load-bearing.** No registration form.
No email option on an invitation. No control that could block training on imbalanced data. No link
from an administration screen into classroom content. Each of those is a requirement that a
well-meaning contributor would otherwise "fix" by adding the missing feature — which is precisely
why the test says it is missing on purpose.

## Pull requests

State which principles the change touches and how it complies. A reviewer will reject a change that
violates one without a recorded justification in the plan's Complexity Tracking table — which is
currently empty, by design.

The automated gates above must pass. Learning content additionally needs review by someone with
classroom experience: a technically correct lesson that does not teach is a defect.

## Where the reasoning lives

Before proposing a design change, check whether it was already considered:

- [`spec.md`](specs/001-xai-lab/spec.md) — nine user stories, 58 functional requirements, 21 success
  criteria, and an Edge Cases section that is more useful than its heading suggests.
- [`research.md`](specs/001-xai-lab/research.md) — sixteen decisions, each with the alternatives that
  were rejected and why. R15 and R16 explain the account design; R4 explains batched occlusion.
- [`contracts/`](specs/001-xai-lab/contracts/) — the ML core's public surface, the IndexedDB schema
  and migration rules, and the RLS policies.

Source files carry `FR-`, `SC-`, `R` and `D` references back to these. If you find a comment that
disagrees with the code, the comment is a bug too — fix both.
