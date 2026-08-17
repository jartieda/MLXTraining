# Phase 1 Data Model: Explainable AI Lab

**Feature**: `001-xai-lab` | **Date**: 2026-08-17 | **Plan**: [plan.md](./plan.md)

The model is deliberately split across two stores, and the split *is* the privacy design rather
than an optimisation:

- **Local (IndexedDB, on the learner's device)** — everything derived from a camera: samples,
  embeddings, trained weights, and generated explanations. Never transmitted (FR-048).
- **Remote (Postgres via Supabase)** — identity, consent, classroom membership, and the *numbers and
  words* a learner produces: metrics, progress, reflections. No table can hold an image or a weight.

A `Project` therefore exists in both stores, joined by a shared UUID generated on the client. If the
remote row exists and the local record does not — a learner logging in on a second device — that is
a normal, expected state that the interface explains (FR-032), not an inconsistency to repair.

---

## Local store (IndexedDB, via Dexie)

### `projects`

| Field | Type | Rules |
|---|---|---|
| `id` | UUID (primary key) | Client-generated; matches the remote `projects.id` |
| `name` | string | 1–60 chars, required |
| `ownerId` | UUID \| `null` | `null` for an anonymous session (FR-023) |
| `createdAt` / `updatedAt` | ISO 8601 | |
| `activeRunId` | UUID \| `null` | The run whose model is currently loaded |
| `backboneAlpha` | `0.25` \| `0.50` | Fixed at first training; changing it invalidates cached embeddings |

### `classes`

| Field | Type | Rules |
|---|---|---|
| `id` | UUID (primary key) | |
| `projectId` | UUID | Indexed |
| `name` | string | 1–40 chars; **unique within a project**, case-insensitive |
| `order` | integer | Learner-controlled ordering |
| `createdAt` | ISO 8601 | |

A rename must not orphan results: `training_runs` reference `classId`, never the name, so a class
renamed after training keeps its figures correctly attributed (Edge Cases).

### `samples`

| Field | Type | Rules |
|---|---|---|
| `id` | UUID (primary key) | |
| `projectId` / `classId` | UUID | Both indexed; a sample belongs to exactly one class |
| `image` | Blob | JPEG, 224×224, quality 0.8, ~15 KB (R10) |
| `embedding` | Float32Array | Pooled backbone vector, 512 floats at alpha 0.50, ~2 KB (R2) |
| `embeddingAlpha` | `0.25` \| `0.50` | Which backbone produced `embedding`; stale entries are recomputed |
| `source` | `camera` \| `upload` | |
| `capturedAt` | ISO 8601 | |

`embedding` is computed once at capture time so that training never runs the backbone (R2). The full
spatial activation needed for Grad-CAM is **not** stored — it is recomputed on demand for the one
frozen frame being explained, which is the difference between ~2 KB and ~100 KB per sample.

### `models`

| Field | Type | Rules |
|---|---|---|
| `runId` | UUID (primary key) | Matches remote `training_runs.id` |
| `projectId` | UUID | Indexed |
| `artifactKey` | string | Key under `indexeddb://` where TensorFlow.js stored the head |
| `classOrder` | UUID[] | Ordered class ids; **maps output index → class**, required to read predictions |
| `status` | `training` \| `ready` \| `failed` | Only `ready` may be loaded for inference (FR-050) |
| `savedAt` | ISO 8601 | |

`classOrder` is load-bearing: without it a saved model's output vector cannot be attributed to
classes after a reorder or rename.

### `explanations`

| Field | Type | Rules |
|---|---|---|
| `id` | UUID (primary key) | |
| `runId` | UUID | |
| `frameHash` | string | Identifies the frozen frame, so a repeat request can be served from cache |
| `classId` | UUID | The class being explained — not necessarily the predicted one (FR-016) |
| `method` | `gradcam` \| `occlusion` | |
| `map` | Float32Array | Normalised to [0,1] |
| `width` / `height` | integer | Native map resolution before upsampling (7 or 14) |
| `params` | object | `{ targetLayer }` or `{ gridSize, patchSize, stride }` |
| `computedAt` | ISO 8601 | |

Cached because a learner in the comparison view switches classes and methods repeatedly on one
frozen frame; recomputing occlusion each time would make that view feel broken.

### Local store rules

- Deleting a project cascades to its classes, samples, models, and explanations.
- Changing `backboneAlpha` invalidates every `embedding` for that project; they are recomputed
  lazily, with progress shown, rather than blocking.
- A `models` row left in `status: 'training'` by an interrupted session is reported as unfinished on
  next load and offered for restart, never loaded for inference (FR-050, Edge Cases).

---

## Remote store (Postgres via Supabase)

Every table has row-level security enabled. Policy contracts are specified in
[contracts/database.md](./contracts/database.md).

### `profiles`

| Field | Type | Rules |
|---|---|---|
| `id` | UUID (primary key) | References `auth.users.id` |
| `alias` | text | 2–24 chars, required. **The only identifier shown to any other user** (FR-025) |
| `role` | `learner` \| `educator` | Chosen at sign-up |
| `date_of_birth` | date | Required; refused if impossible (Edge Cases). Never displayed |
| `consent_state` | `active` \| `pending` \| `withdrawn` | Derived at sign-up from `date_of_birth`; `active` immediately if at or above the configured threshold |
| `locale` | `en` \| `es` | Persisted interface language (FR-044) |
| `created_at` | timestamptz | |

Email lives in `auth.users` and is never exposed through `profiles` — this is the mechanism behind
FR-025 and SC-016.

### `consent_records`

| Field | Type | Rules |
|---|---|---|
| `id` | UUID (primary key) | |
| `profile_id` | UUID | Unique — one live consent record per profile |
| `guardian_email` | text | Write-only from the client's perspective; never returned to any select |
| `token_hash` | text | Hash of the single-use confirmation token |
| `requested_at` | timestamptz | |
| `confirmed_at` | timestamptz \| `null` | |
| `withdrawn_at` | timestamptz \| `null` | |
| `resend_count` | integer | Rate-limits resends after a bouncing address (Edge Cases) |

**State machine** — the whole of User Story 4's consent behaviour:

```
                    at/above age threshold
  sign-up ──────────────────────────────────────────────▶ active
     │
     │ below threshold
     ▼
  pending ──── guardian confirms ────▶ active ──── guardian withdraws ────▶ withdrawn
     │  ▲                                                                      │
     │  └── resend (rate-limited) ──┘                                          │
     │                                                          deletes all remote rows
     └── never confirmed: stays pending indefinitely,
         local lab fully usable, no remote writes (FR-027, SC-014)
```

`withdrawn` deletes every remote row owned by the profile (FR-029, SC-015). It cannot reach local
samples, which is the intended consequence of keeping images on the device.

### `classrooms`

| Field | Type | Rules |
|---|---|---|
| `id` | UUID (primary key) | |
| `educator_id` | UUID | References `profiles.id`; the row's owner |
| `name` | text | 1–60 chars |
| `code_prefix` | text | Short non-secret lookup key |
| `code_hash` | text | Hash of the full join code (R9) |
| `code_active` | boolean | `false` retires the code without deleting the classroom (FR-038) |
| `created_at` | timestamptz | |

### `enrolments`

| Field | Type | Rules |
|---|---|---|
| `classroom_id` / `learner_id` | UUID | Composite primary key |
| `joined_at` | timestamptz | |

A learner may hold **at most one** enrolment at a time (Assumptions), enforced by a unique
constraint on `learner_id`. A pending profile may not be enrolled at all (Edge Cases).

### `projects`

Metadata only — the local store holds the substance.

| Field | Type | Rules |
|---|---|---|
| `id` | UUID (primary key) | Matches the local `projects.id` |
| `owner_id` | UUID | |
| `name` | text | |
| `class_count` | integer | Denormalised so a roster renders without reading child tables |
| `sample_count` | integer | |
| `created_at` / `updated_at` | timestamptz | |

### `training_runs`

| Field | Type | Rules |
|---|---|---|
| `id` | UUID (primary key) | Matches the local `models.runId` |
| `project_id` | UUID | |
| `finished_at` | timestamptz | Only completed runs are recorded (FR-050) |
| `per_class` | jsonb | `[{ classId, className, sampleCount, accuracy }]` |
| `confusion` | jsonb | Row-major integer matrix, ordered by `per_class` |
| `overall_accuracy` | numeric | 0–1 |
| `imbalance_ratio` | numeric | Largest class count ÷ smallest; drives the FR-021 warning |
| `backbone_alpha` | numeric | Which backbone produced the run, so two runs are compared fairly |
| `epochs` | integer | |

Retaining every run is what makes FR-010 and the fairness module's before-and-after comparison
possible (FR-036) — the imbalanced run and the rebalanced run are two rows the learner compares.

### `lesson_progress`

| Field | Type | Rules |
|---|---|---|
| `learner_id` / `module_id` | composite primary key | `module_id` is a content slug, not a foreign key |
| `state` | `not_started` \| `in_progress` \| `completed` | |
| `completed_steps` | text[] | Step slugs, so a module can gain steps without invalidating progress |
| `updated_at` | timestamptz | |

`module_id` is a slug rather than a row so that lesson content ships with the application (per
Assumptions) and can be revised without a migration.

### `reflections`

| Field | Type | Rules |
|---|---|---|
| `id` | UUID (primary key) | |
| `learner_id` / `module_id` / `question_id` | UUID, text, text | Unique together — revising replaces (FR-035) |
| `answer` | text | 1–4000 chars |
| `updated_at` | timestamptz | |

Readable by the learner and by the educator of the classroom she is enrolled in, and by nobody else
(FR-040, FR-042).

### Remote store invariants

These are the assertions the row-level-security test suite must prove:

1. **No image or weight column exists in any table.** Enforced by schema review and a test that
   fails if any column's type is `bytea` or if a text column's name matches an image or weight
   pattern (Principle I, SC-010).
2. **Every write policy on `projects`, `training_runs`, `lesson_progress`, `reflections`, and
   `enrolments` requires the caller's `consent_state = 'active'`.** This makes SC-014 hold against a
   tampered client, not merely against the shipped interface.
3. **`guardian_email` is never selectable by any role.** Write-only from the client.
4. **An educator reads only rows belonging to learners enrolled in a classroom she owns**, resolved
   through a `SECURITY DEFINER` function to avoid recursive policy evaluation (R9, FR-042).
5. **A learner reads and writes only her own rows.** No learner can reach another learner's
   projects, runs, progress, or reflections (FR-042).
6. **`classrooms.code_hash` is not selectable by learners**; a code is validated through an RPC
   (R9).
7. **Withdrawing consent leaves no residual row** for that profile in any table (SC-015).
