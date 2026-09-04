# Explainable AI Lab

A web app for the [Technovation](https://technovationchallenge.org/) program where 12–18 year olds
learn explainable AI. A learner captures photographs into named classes, trains a classifier **on her
own device**, tests it live, and inspects two independent heat-map explanations of any prediction. A
seven-module guided path turns those mechanics into a curriculum, and an educator dashboard makes it
runnable as a workshop.

## The one thing to understand before changing anything

**Captured images and trained models never leave the device.** Not as an optimisation, not as a
default that a feature flag could change — it is the first principle of
[the constitution](.specify/memory/constitution.md) and it is marked non-negotiable there.

Everything else follows from it:

- Training, inference, Grad-CAM and occlusion all run in the browser. There is **no first-party
  server**, and adding one is forbidden rather than discouraged.
- Photographs, embeddings and weights live in IndexedDB. Supabase holds identity, classroom
  membership, project *metadata*, aggregate figures, lesson progress and reflection text — never a
  pixel and never a weight.
- The remote schema has no `bytea` column and no column that could hold a learner's email address,
  date of birth or real name. That is asserted by a structural test, not by review.
- The Content-Security-Policy limits `connect-src` to Supabase and `self`, so there is no destination
  an image could be sent to even if the application code were compromised.

If a feature proposal needs a round trip to compute a prediction or an explanation, it gets rejected
or redesigned. That is Principle II, and it is why the project can be free to run for schools.

## Getting started

```bash
npm install
npm run fetch:backbone   # ~11 MB of MobileNet weights into public/models/
npm run dev
```

To build and run the production image with Docker:

```bash
docker build -t ml4g-xai-lab .
docker run --rm -p 8080:80 ml4g-xai-lab
```

Open `http://localhost:8080`. Supabase is optional; when it is needed, pass the Vite
variables at build time with `--build-arg VITE_SUPABASE_URL=...` and
`--build-arg VITE_SUPABASE_ANON_KEY=...`. Vite embeds these values in the static bundle,
so do not pass service-role credentials.

The lab works completely with no account and no Supabase configuration — that is FR-023, not a
degraded mode. For the signed-in half you also need a local Supabase:

```bash
npx supabase start                     # needs Docker
cp .env.example .env.local             # then paste in the printed anon key
npx supabase db reset                  # applies migrations and the seed
```

### There is no sign-up, so the seed is the only way in

Nobody can register. An administrator invites educators, an educator invites her learners into a
classroom she owns, and every invitation is a single-use expiring code redeemed by its holder — who
sets her own password, so no educator ever learns a learner's.

The first administrator is created by `supabase/seed.sql`, and the application exposes no path to
create another. **Without the seed, the entire signed-in half of the product is unreachable.** That
is the intended shape of the design rather than a gap in the fixtures.

Seeded accounts all use the password `labpassword`:

| Who | Signs in with |
|---|---|
| Administrator | `admin@example.org` |
| Educator (owns "Year 9 — Wednesday") | `educator1@example.org` |
| Learner "Comet" | `learner-l1` |

A learner signs in with a **username**, an adult with an **email address**. The `@` is the whole
discriminator — see `authIdentifierFor` in [`session.ts`](src/features/auth/session.ts) and R16 in
[research.md](specs/001-xai-lab/research.md).

## Commands

| Command | What it checks |
|---|---|
| `npm run typecheck` | TypeScript, strict |
| `npm run lint` | ESLint, including three project-specific boundary rules |
| `npm test` | Everything Vitest can run |
| `npm run test:ml` | The ML core, in a node environment against fixed-seed fixtures |
| `npm run test:i18n` | Every `en` key exists in `es`, with no orphans and no untranslated copies |
| `npm run test:db` | The row-level-security policy contracts, against a real Postgres |
| `npm run test:e2e` | Playwright at 360×740 and 1440×900 |
| `npm run test:a11y` | `axe` over the primary journey — zero violations, no allowlist |
| `npm run test:network` | No image or model bytes leave the device, across the whole journey |
| `npm run test:e2e:nowebgl` | The WASM fallback, exercised rather than configured |
| `npm run check:bundle` | Initial route under 200 KB gzipped, and the heavy modules still lazy |

`npm run test:db` and the signed-in e2e scenarios **skip** without a local Supabase. A skip is not a
pass; they are merge-blocking in CI.

## Layout

```
src/
├── ml/            No DOM, no network, no feature imports. Tested first (Principle VI).
├── features/      One directory per user journey.
├── components/    Shared primitives. Button and TextLink own the 44 px touch floor.
├── content/       Lesson structure. Every word lives in src/locales/.
├── lib/           supabase (client), db (Dexie), i18n, camera.
├── locales/       en and es. A missing key fails the build.
└── routes/        Route table and the role gates.

supabase/migrations/   Schema, the nine SECURITY DEFINER functions, and the RLS policies.
specs/001-xai-lab/     The specification, plan, research and task list this was built from.
```

## Where the reasoning lives

This project was built spec-first, and the reasoning is committed rather than remembered:

- **[constitution.md](.specify/memory/constitution.md)** — seven principles. Read Principle I.
- **[spec.md](specs/001-xai-lab/spec.md)** — nine user stories, 58 functional requirements, 21
  success criteria. Every `FR-` and `SC-` reference in the code points here.
- **[research.md](specs/001-xai-lab/research.md)** — sixteen decisions with their alternatives, so a
  contributor can tell a considered choice from an accident.
- **[contracts/](specs/001-xai-lab/contracts/)** — the ML core's public surface, the IndexedDB
  schema, and the RLS policies treated as contracts with their own test suite.

Source files carry the same references. A comment saying *why* is worth more here than anywhere,
because the codebase is read and extended by students, mentors and volunteers rather than by a
dedicated engineering team.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the boundaries the build enforces.

## Status

The nine user stories are built. Three things remain, and none of them is code:

- **Classroom review of the seven lesson modules** by someone with teaching experience. A
  technically correct lesson that does not teach is a defect (constitution, Quality Gates).
- **A pilot session with 8–12 real participants**, to measure the three learner-outcome criteria that
  only observation can establish — unaided completion of module 1, correct identification of the
  induced shortcut and the imbalance effect, and time to first prediction.
- **Two deferred obligations before public launch**: the division of data-controller responsibility
  between the project and participating schools awaits legal review, and Technovation logo usage
  awaits written confirmation from the program. Neither blocks development.
