# Phase 1 Data Model: Explainable AI Lab

**Feature**: `001-xai-lab` | **Date**: 2026-08-17 | **Plan**: [plan.md](./plan.md)

The model is deliberately split across two stores, and the split *is* the privacy design rather
than an optimisation:

- **Local (IndexedDB, on the learner's device)** — everything derived from a camera: samples,
  embeddings, trained weights, and generated explanations. Never transmitted (FR-048).
- **Remote (Postgres via Supabase)** — identity, invitations, classroom membership, and the *numbers
  and words* a learner produces: metrics, progress, reflections. No table can hold an image or a
  weight, and none can hold a learner's email address, date of birth, or real name.

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
| `backboneAlpha` | `0.25` \| `0.5` | Fixed at first training; changing it invalidates cached embeddings. Written `0.5`, not `0.50`, to match the `Alpha` type in [contracts/ml-core.md](./contracts/ml-core.md) — `0.50` is not a distinct TypeScript literal |

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
| `embeddingAlpha` | `0.25` \| `0.5` | Which backbone produced `embedding`; stale entries are recomputed |
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
| `width` / `height` | integer | Native map resolution before upsampling, and it differs by method: 7 or 14 for `gradcam` depending on the target layer, and the occlusion grid size (12 by default) for `occlusion`. A single "7 or 14" rule would silently corrupt every cached occlusion map |
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
| `username` | text | 3–24 chars, **unique system-wide**, case-insensitive. Assigned by the issuer, never shown to another learner (FR-025, FR-051) |
| `alias` | text | 2–24 chars, required. **Unique within a classroom** (FR-051). The only identifier shown to another learner (FR-025) |
| `role` | `learner` \| `educator` \| `administrator` | Set by the invitation that created the account; never client-writable |
| `display_name` | text \| `null` | Educators and administrators only — how an educator appears to her learners. `null` for a learner, who uses `alias` |
| `is_active` | boolean | `false` blocks sign-in. An administrator deactivates an educator here (FR-054); the last administrator cannot be deactivated (FR-056) |
| `locale` | `en` \| `es` | Persisted interface language (FR-044) |
| `created_at` | timestamptz | |

There is **no** `date_of_birth` and **no** `consent_state`, and there is no learner email address or
real name anywhere in this table or any other. That absence is the project's whole data-protection
position, so it is asserted by a schema-inspection test rather than left to review (SC-017).

An educator's email lives in `auth.users` and is never exposed through `profiles`. A learner has no
real email at all: her `auth.users` row carries an identifier derived from `username` in a
non-resolvable domain (R16), which is why no query can leak a contact detail she never gave.

### `invitations`

The only way an account comes into existence (FR-024).

| Field | Type | Rules |
|---|---|---|
| `id` | UUID (primary key) | |
| `issuer_id` | UUID | References `profiles.id`. An administrator issues to an educator; an educator issues to a learner |
| `kind` | `educator` \| `learner` | Determines what `target` means and what role the redeemed account gets |
| `purpose` | `initial` \| `password_reset` | A reset is a fresh invitation of the same shape against an account that already exists (FR-030) |
| `target` | text | The assigned `username` when `kind = 'learner'`; the educator's email address when `kind = 'educator'` |
| `classroom_id` | UUID \| `null` | Required when `kind = 'learner'` — the classroom the redeemed account is enrolled into. `null` for an educator |
| `code_hash` | text | Hash of the single-use code. The code itself is **6 characters** over a 32-symbol alphabet excluding `O`/`0` and `I`/`1`/`l`, returned to the issuer **once** at issue time, and never stored or selectable (R15, FR-028) |
| `expires_at` | timestamptz | Required, set to 72 hours after issue. A code past this instant is refused (FR-028) |
| `failed_attempts` | integer | Redemption is refused after 5 failures per hour per origin. At 30 bits of code entropy this limit is the primary defence, not a secondary one (FR-028, SC-020) |
| `redeemed_at` | timestamptz \| `null` | |
| `revoked_at` | timestamptz \| `null` | |
| `created_at` | timestamptz | |

**State machine** — the whole of the account lifecycle:

```
  issued ──── holder redeems with a valid code ────▶ redeemed
     │                                               (account exists and is usable)
     ├──── expires_at passes ──────────────────────▶ expired
     │
     └──── issuer revokes ─────────────────────────▶ revoked

  All three terminal states refuse redemption, and the refusal MUST say which one
  applies so a learner knows whether to wait or to ask for a new code (FR-028).
  A refusal MUST NOT reveal whether the target username exists (Edge Cases).
```

Redemption is the only transition that creates a `profiles` row, and it happens inside
`redeem_invitation` — see [contracts/database.md](./contracts/database.md). The holder chooses her own
password during redemption, which is why no educator can ever read a learner's credential (FR-027).

Deleting a learner's account removes every remote row belonging to it (FR-052, SC-015). It cannot
reach her local samples and models, which is the intended consequence of keeping images on the
device.

### `classrooms`

| Field | Type | Rules |
|---|---|---|
| `id` | UUID (primary key) | |
| `educator_id` | UUID | References `profiles.id`; the row's owner. **Reassignable** by an administrator, so that deactivating an educator never strands a group of learners (FR-057) |
| `name` | text | 1–60 chars |
| `archived_at` | timestamptz \| `null` | Archiving hides a finished classroom without deleting it or its learners' work (FR-038) |
| `created_at` | timestamptz | |

`educator_id` is the only column an administrator may write, and `id`, `name`, `educator_id` are the
only ones she may read. That narrow window is what lets FR-057 exist without giving her any route into
a classroom's contents.

There is **no join code**. A learner does not join a classroom; she is created inside one by the
invitation her educator issued, so `invitations.classroom_id` carries what a join code used to. This
removes an entire mechanism — code generation, rotation, retirement, and the RPC that validated it —
along with the class of bug where a leaked code lets a stranger into a classroom.

### `enrolments`

| Field | Type | Rules |
|---|---|---|
| `classroom_id` / `learner_id` | UUID | Composite primary key |
| `enrolled_at` | timestamptz | |

Created by `redeem_invitation`, never by a client insert. A learner may hold **at most one**
enrolment at a time (Assumptions), enforced by a unique constraint on `learner_id`.

An educator removing a learner deletes only this row: the learner keeps her account, her projects,
her progress, and her reflections, and only the educator's visibility ends (FR-039, Edge Cases).
Deleting the account is the separate, heavier action of FR-052.

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

### `audit_log`

Append-only, unreadable through the application, and the answer to "who removed my daughter's work?"

| Field | Type | Rules |
|---|---|---|
| `id` | bigint (primary key) | Monotonic, so ordering survives clock adjustment |
| `actor_id` | UUID | The profile that performed the action |
| `action` | `learner_deleted` \| `educator_deactivated` \| `classroom_reassigned` | Only the three irreversible actions. Issuing or revoking an invitation destroys nothing and is not recorded (FR-058) |
| `subject_id` | UUID | The learner, educator, or classroom affected |
| `detail` | jsonb \| `null` | Opaque identifiers only — for a reassignment, the previous and new `educator_id` |
| `occurred_at` | timestamptz | |

No column may hold an alias, a username, an email address, a date of birth, or a real name. A log
built to be readable by a human is a log that has become personal data, and this one is read by
querying identifiers during an incident, not by browsing.

Each row is written **inside the same transaction** as the action it records, by the
`SECURITY DEFINER` function performing it. Writing it afterwards would allow the deletion to succeed
while the record is lost, which is precisely the failure the log exists to rule out.

### Remote store invariants

These are the assertions the row-level-security test suite must prove:

1. **No image or weight column exists in any table.** Enforced by schema review and a test that
   fails if any column's type is `bytea` or if a text column's name matches an image or weight
   pattern (Principle I, SC-010).
2. **No column anywhere holds a learner's email address, date of birth, or real name.** Enforced by
   the same schema-inspection test. This is the assertion the entire data-protection position rests
   on, so it is checked structurally rather than by inspecting contents (SC-017).
3. **`invitations.code_hash` is never selectable by anyone**, including the issuer. The code is
   returned once by the issuing RPC and thereafter exists only as a hash (R15).
4. **An account exists only as the result of a redeemed invitation.** No client-side insert into
   `profiles` succeeds; `redeem_invitation` is the only writer (FR-024).
5. **An educator reads only rows belonging to learners enrolled in a classroom she owns**, resolved
   through a `SECURITY DEFINER` function to avoid recursive policy evaluation (R9, FR-042).
6. **A learner reads and writes only her own rows.** No learner can reach another learner's
   projects, runs, progress, or reflections (FR-042).
7. **An administrator reads exactly three things**: `profiles` rows whose `role = 'educator'`, the
   `invitations` she issued, and the `id`, `name`, and `educator_id` of a classroom — the last solely
   so she can reassign it (FR-057). Enrolments, projects, training runs, lesson progress, and
   reflections all return zero rows to her (FR-055, SC-018). She is the only role in the system
   defined primarily by what it cannot see.
8. **`audit_log` is selectable by nobody and mutable by nobody.** Append-only, written only from
   inside the three irreversible definer functions, and read only by direct database inspection. An
   audit screen for administrators would name learner accounts and so recreate the role FR-055
   forbids (FR-058).
9. **Deleting a learner leaves no residual row** referencing that profile in any table (FR-052,
   SC-015).
10. **`username` is unique system-wide and `alias` is unique within a classroom**, enforced by
    constraint rather than by application check, so a roster or export can never be ambiguous
    (FR-051).
11. **The last administrator cannot be deactivated.** Enforced inside `deactivate_educator` and by a
    partial constraint, so the program cannot be locked out of its own administration (FR-056).
