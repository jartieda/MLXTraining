# Explainable AI Lab — installation, use, and what is left

Written 2026-08-27, at 140 of 144 tasks. This is the one file to read if you are picking the project
up. [README.md](README.md) is the shorter public front door and [CONTRIBUTING.md](CONTRIBUTING.md)
covers the boundaries the build enforces; everything below is the operational detail and the honest
list of what is not done.

---

## 1. What this is

A static web app for the Technovation program where 12–18 year olds learn explainable AI. A learner
photographs objects into named classes, trains a classifier **on her own device**, tests it live, and
compares two independent heat-map explanations of any prediction. Seven guided modules turn that into
a curriculum; an educator dashboard makes it runnable as a workshop.

**Read Principle I of [the constitution](.specify/memory/constitution.md) before changing anything.**
Captured images and trained models never leave the device. It is marked non-negotiable, and almost
every awkward-looking decision in the codebase follows from it: no first-party server, a DOM-free ML
layer, three custom lint rules, and a row-level-security suite treated as a contract.

---

## 2. Installation

### 2.1 Prerequisites

| Need | Version | Notes |
|---|---|---|
| Node | ≥ 20.19 | Developed on 24.1.0 |
| npm | bundled | One `package.json`, no workspaces (Principle VII) |
| Docker | any recent | **Only** for the database and the signed-in tests. The lab itself does not need it. |

### 2.2 Minimum — the lab, with no account

```bash
git clone <this repo> && cd ML4G
npm install
npm run fetch:backbone      # ~7 MB of MobileNet weights into public/models/
npm run dev                 # http://localhost:5173
```

That is a complete, working product. Capture, train, test, both explanations, the figures, the model
export and all seven lesson modules work with no account and no Supabase — that is FR-023, not a
degraded mode. Progress and reflections are the only things that need signing in.

`npm run fetch:backbone` is not optional. Without `public/models/` the lab cannot embed a photograph
and both capture paths stay disabled, with an on-screen explanation rather than a silent failure.

### 2.3 Full — with accounts, classrooms and administration

```bash
npx supabase start          # needs Docker; prints an API URL and an anon key
cp .env.example .env.local  # paste the printed anon key into VITE_SUPABASE_ANON_KEY
npx supabase db reset       # applies the three migrations and the seed
npm run dev
```

`.env.local` needs three values:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<the anon key supabase start printed>
VITE_INVITATION_TTL_HOURS=72
```

There is **no `service_role` key anywhere in this codebase and there must never be one.** It bypasses
every row-level-security policy, and those policies are the entire authorisation model. Privileged
operations go through sixteen `SECURITY DEFINER` Postgres functions instead.

### 2.4 There is no sign-up, so the seed is the only way in

Nobody can register. An administrator invites educators; an educator invites her learners into a
classroom she owns; every invitation is a single-use code that expires in 72 hours and is redeemed by
its holder, who sets her own password. The first administrator is created by `supabase/seed.sql`, and
the application exposes no path to create another.

**Without `npx supabase db reset`, the entire signed-in half of the product is unreachable.** That is
the intended shape of the design, not a gap in the fixtures.

Seeded accounts, all with password `labpassword`:

| Role | Signs in with | Notes |
|---|---|---|
| Administrator | `admin@example.org` | "Programme office" |
| Educator | `educator1@example.org` | "Ms Rivera", owns "Year 9 — Wednesday" |
| Educator | `educator2@example.org` | "Mr Okafor", owns "Robotics club" |
| Learner | `learner-l1` | Alias "Comet", in Year 9 |
| Learner | `learner-l1b` | Alias "Nimbus", in Year 9 |
| Learner | `learner-l2` | Alias "Comet", in Robotics club — the same alias in a different classroom, which FR-051 must allow |

A learner signs in with a **username**, an adult with an **email address**. The `@` is the whole
discriminator; see `authIdentifierFor` in [`session.ts`](src/features/auth/session.ts) and R16 in
[research.md](specs/001-xai-lab/research.md). A learner's auth identifier is derived in
`learner.invalid`, a domain RFC 2606 reserves as permanently non-resolvable, so the application holds
no contact detail for any minor.

Unredeemed seed codes, for testing redemption: `SEEDA2` (educator), `SEEDB3` (learner `learner-new`),
`SEEDC4` (password reset for `learner-l1b`).

---

## 3. Use

### 3.1 As a learner

1. **My projects → New project.** A project is one thing you are teaching the computer.
2. **Add two classes**, select one, and capture photographs — press-and-hold for a burst, or upload
   files. Move the object between shots; ten near-identical photographs teach almost nothing.
3. **Train.** Seconds, on the device. The figures appear underneath: per-class accuracy, the
   confusion breakdown, and an imbalance notice if the classes are lopsided.
4. **Turn on the camera → Start guessing** for live prediction.
5. **Freeze this frame → Show me why** for a Grad-CAM heat map. **Work out both** adds the
   perturbation method and an agreement score.
6. **Learning path** for the seven modules. Progress and answers save themselves; without an account
   they are not recorded and the page says so.

### 3.2 As an educator

**Classroom** → name a classroom → **Invite a learner** with a username you choose. You get a
six-character code, **shown once** — only its hash is stored, so it cannot be looked up again. Hand
over the username and the code in person; the lab holds no address for a learner and never emails one.

The roster shows aliases, module completion, accuracy figures and reflection answers. It shows **no
photographs**, and cannot: they are in the learner's own IndexedDB and this screen has no channel to
them. **Export progress (CSV)** gives one row per learner and module, by alias only.

Two lifecycle actions, deliberately different weights: **Remove from classroom** deletes one row and
ends only your visibility; **Delete account** removes every remote row and cannot be undone — and
cannot reach her device, which the dialogue says so she can tell the learner.

### 3.3 As an administrator

**Administration** → invite an educator by email → hand over the code with **Open my mail app**,
which prefills *your own* client. The lab sends nothing. Fall back to **Copy the message** where no
mail client is registered, which is common on school Chromebooks.

You can also see every invitation's state, revoke an unredeemed one, switch off an educator, and move
a classroom to another educator. You **cannot** reach any learner account, project, figure, answer or
photograph — not because it is hidden but because the database grants you no access, and the page
says so. You cannot deactivate the last administrator, and there is no path to create one.

---

## 4. Commands

| Command | Checks | Needs Docker |
|---|---|---|
| `npm run typecheck` | TypeScript, strict | |
| `npm run lint` | ESLint, including three project boundary rules | |
| `npm test` | Everything Vitest can run — **506 pass** | |
| `npm run test:ml` | ML core, node environment, fixed seed | |
| `npm run test:i18n` | Every `en` key exists in `es`, no orphans, no untranslated copies | |
| `npm run test:db` | 111 row-level-security assertions | **yes** |
| `npm run test:e2e` | Playwright, **95 tests × 3 projects** | partly |
| `npm run test:a11y` | `axe`, zero violations, no allowlist | |
| `npm run test:network` | No image or model bytes leave the device (SC-010) | |
| `npm run test:e2e:nowebgl` | The WASM fallback, exercised not configured | |
| `npm run check:bundle` | Initial route ≤ 200 KB gzipped, heavy modules still lazy | |
| `npm run build` | `tsc -b && vite build` | |

Playwright runs three projects: `desktop` (1440×900), `mobile` (360×740) and `chromium-nowebgl`.

**A skip is not a pass.** 36 of the 95 e2e tests skip without Docker, and they are the ones covering
accounts, classrooms, lessons persistence and administration isolation. They are merge-blocking in CI.

---

## 5. What is left

### 5.1 The single most valuable thing to do next

**Run the database-gated tests.** They have never executed.

```bash
npx supabase start && npx supabase db reset
supabase status -o json | jq -r .ANON_KEY   # into .env.local
npm run test:db
npm run test:e2e
```

36 e2e tests plus 111 row-level-security assertions currently skip on any machine without Docker,
including the one this was built on. They are written, typechecked, linted and CI-wired — but **their assertions are
unproven**, and they cover the security-critical half of the product:

| Suite | Tests | What is unproven |
|---|---|---|
| `us4-accounts.spec.ts` | 8 of 10 | Invitation redemption, the three refusals, reset codes, project restoration |
| `us4-no-pii.spec.ts` | 3 of 5 | SC-016 — no view or export reveals a username or an email address |
| `us5-learning-path.spec.ts` | 5 of 9 | FR-035 — progress and reflections actually persist across a reload |
| `us6-classroom.spec.ts` | 7 of 7 | SC-011 cross-classroom refusal, SC-015 no residual row after deletion |
| `us9-admin.spec.ts` | 7 of 7 | FR-056 — the last administrator cannot lock the program out |
| `us9-admin-isolation.spec.ts` | 6 of 6 | **FR-055 / SC-018** |
| `tests/db/` | 111 | The whole authorisation model |

`us9-admin-isolation.spec.ts` is the one that matters most. An over-broad policy there creates the
only role in the system that could read every minor's work.

### 5.2 The four remaining tasks — none of them is code

Marked `BLOCKED` in [tasks.md](specs/001-xai-lab/tasks.md) with the reason.

**T125 — classroom review of the seven lesson modules.** Needs someone with teaching experience. The
constitution is explicit: *a technically correct lesson that does not teach is a defect.* The content
in [`src/locales/{en,es}/lessons.json`](src/locales/en/lessons.json) has had no such review, and the
pacing of module 3 (shortcuts and bias) and module 6 (the imbalance experiment) is the kind of thing
only a classroom reveals.

**T125b — a pilot with 8–12 real participants.** Three success criteria cannot be established any
other way, and none of them is a number a test can produce:

- **SC-007** — a learner completes module 1 unaided.
- **SC-006** — she correctly identifies the induced background shortcut, and the imbalance effect.
- **SC-001** — time to a first prediction.

Feed the failures back as new tasks. Do not treat the numbers as met because the features exist.

**T126 — the full [quickstart.md](specs/001-xai-lab/quickstart.md) pass.** W1–W9 on three reference
devices: a mid-range laptop, a low-end Chromebook without a discrete GPU, and a mid-range phone. This
is where SC-002 (90 s training on a phone), SC-003 (occlusion under 5 s), SC-008 (interactive in 3 s)
and SC-012 (WASM within 4×) are actually checked. `degraded.spec.ts` measures and **reports** those
timings rather than asserting them, precisely because CI hardware is not the reference hardware.

**T127 — two deferred obligations. These block public launch and nothing in development.**

- `TODO(CONTROLLER_AGREEMENT)` — the division of data-controller responsibility between the project
  and the schools that provision learner accounts needs legal review, including what the project must
  disclose to a school before that school creates accounts for its minors.
- `TODO(TECHNOVATION_TRADEMARK)` — written confirmation from the Technovation program before shipping
  its logo or wordmark. Colour tokens and Google-Fonts typefaces are unaffected.

### 5.3 Known limitations, deliberate

Each of these is a decision rather than an oversight, and each is documented where it lives.

**A reopened project does not restore its trained model.** The figures and the "trained model ready"
status come back from IndexedDB, but the live model handle does not — so live prediction, the
explanations and the export are offered only in the session that trained it. FR-031 asks for
"trained-model status" and that is exactly what it restores. Restoring the model itself is
straightforward (`loadModel(artifactKey, classCount)` exists in `src/ml/train.ts`) and would be a
worthwhile small feature, but it is not required by the spec.

**No offline cold start.** The project ships no service worker. Going offline mid-session costs
nothing — everything is local, and a banner says so — but reloading with no connection gives the
browser's own error page. The Edge Case asks for offline *continuity*, not offline install; caching
7 MB of backbone weights is a separate decision.

**The CSV export prefixes a formula-looking answer with an apostrophe.** There is no way to both
preserve the bytes exactly and stop a spreadsheet evaluating `=1+1`, because interpretation is decided
by the first character. Nothing is lost, one character is added, and the export note says so.

**`role="list"` appears on every `list-none` list.** Tailwind's `list-none` strips the implicit list
role in WebKit and Chromium, orphaning the `<li>` children to assistive technology. Do not remove it.

### 5.4 Things worth doing that nobody has asked for

Not in the task list; offered as judgement rather than obligation.

- **Restore the trained model on reopening a project** (see 5.3). The clearest win for a learner.
- **A test asserting `search_path` on all sixteen `SECURITY DEFINER` functions.** Omitting it is a
  privilege-escalation vector. All sixteen set it today, and nothing would notice if the seventeenth
  did not — a query over `pg_proc.proconfig` would be a handful of lines.
- **Rate-limit feedback on sign-in**, not only on redemption. SC-020 covers redemption; a password
  guessing attempt against a known username has no equivalent ceiling in the client's story.
- **A second administrator in the seed.** Every FR-056 test has to reason about there being exactly
  one, and a real deployment will want two before it wants anything else.

---

## 6. Where the reasoning lives

Built spec-first; the reasoning is committed rather than remembered.

| File | What it holds |
|---|---|
| [`.specify/memory/constitution.md`](.specify/memory/constitution.md) | Seven principles, v3.1.0. Principle I is non-negotiable. |
| [`specs/001-xai-lab/spec.md`](specs/001-xai-lab/spec.md) | 9 user stories, 58 functional requirements, 21 success criteria, and an Edge Cases section more useful than its heading |
| [`specs/001-xai-lab/plan.md`](specs/001-xai-lab/plan.md) | Tech stack, the Constitution Check gate, and an empty Complexity Tracking table — by design |
| [`specs/001-xai-lab/research.md`](specs/001-xai-lab/research.md) | 16 decisions with the alternatives rejected and why. R4 batched occlusion, R14 the CSP, R15/R16 the account design |
| [`specs/001-xai-lab/data-model.md`](specs/001-xai-lab/data-model.md) | Both stores, and why the split *is* the privacy design |
| [`specs/001-xai-lab/contracts/`](specs/001-xai-lab/contracts/) | The ML core's surface, the IndexedDB schema and migration rules, the RLS policies as contracts |
| [`specs/001-xai-lab/quickstart.md`](specs/001-xai-lab/quickstart.md) | W1–W9, the manual walkthroughs T126 needs |
| [`specs/001-xai-lab/tasks.md`](specs/001-xai-lab/tasks.md) | 144 tasks, with the four blocked ones annotated and the as-built deviations recorded in Notes |

Source files carry `FR-`, `SC-`, `R` and `D` references back to these. A comment that disagrees with
the code is a bug in the comment; fix both.

---

## 7. Five defects the quality gates found, as a warning

Every one had passed review for several phases. They are listed because the pattern matters more than
the fixes: **each was invisible until something measured it**, and three of them made the codebase
look *better* than the correct version.

1. **TensorFlow.js was in the initial route.** A `manualChunks` entry forcing it into a named chunk
   "to make its size visible" made it a static dependency, so Vite preloaded it in `index.html` and
   every visitor downloaded 279 KB gzipped on first paint — 435 KB against a 200 KB budget. The build
   output looked tidier *with* the bug. Now 156 KB, enforced by `npm run check:bundle`.
2. **The brand blue failed WCAG AA as text** — 4.43:1 on the surface colour, passing against pure
   white by 0.05. Almost every link in the product was failing.
3. **`npm run test:a11y` pointed at a file that did not exist**, since T005. That gate had been
   failing, not passing, for the project's whole life.
4. **`npm run test:e2e` collected zero tests**, because six specs imported a helper out of
   `network.spec.ts` and Playwright refuses to load a test file that imports another. Each spec passed
   when run alone. Fixed by moving the watcher to `tests/e2e/helpers/egress.ts`.
5. **The header pushed its own sign-in control off a 360 px screen.** A flex item defaults to
   `min-width: auto`, so the nav refused to shrink. The page was 40 px too wide and the control was
   simply gone — the exact mobile failure a screenshot review approves.

Numbers 3 and 4 have the same shape and are worth internalising: **a gate that cannot run is worse
than no gate**, because its name in CI reads as coverage. If you add a suite, check that it collects.
