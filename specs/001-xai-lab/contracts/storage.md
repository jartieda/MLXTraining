# Contract: Local Storage (IndexedDB via Dexie)

**Feature**: `001-xai-lab` | **Date**: 2026-08-17

This store holds everything the constitution forbids from leaving the device: samples, embeddings,
trained weights, and generated explanations. Its contract is therefore as much a privacy boundary as
a persistence layer.

Field definitions live in [data-model.md](../data-model.md). This document specifies the callable
surface, the migration rules, and the quota behaviour.

---

## Schema versions

```ts
// src/lib/db.ts
db.version(1).stores({
  projects:     'id, ownerId, updatedAt',
  classes:      'id, projectId, [projectId+order]',
  samples:      'id, projectId, classId, [projectId+classId], capturedAt',
  models:       'runId, projectId, status',
  explanations: 'id, runId, [runId+frameHash+classId+method], computedAt',
})

// Version 2 (T089) adds `models.metrics: RunMetrics | null`. Indexes are
// unchanged — nothing queries by it — so the version bump exists solely to carry
// the defaulting upgrade the rules below require.
db.version(2).stores({ /* identical to version 1 */ })
  .upgrade(tx => tx.table('models').toCollection().modify(r => { r.metrics ??= null }))
```

`models.metrics` holds the per-class counts and accuracies, the confusion matrix, the overall
accuracy, the imbalance ratio, the backbone width and the epoch count for one finished run.

It is stored **locally** and not only remotely, and that is a requirement rather than a convenience:
FR-023 gives an unauthenticated visitor the complete lab, and FR-010's run comparison is part of it.
Held only in `training_runs`, comparing two runs would silently become an account feature — and the
fairness module (FR-036) that argues from a skewed run beside a rebalanced one would stop working for
exactly the learner most likely to be on a shared classroom machine with no account. The remote row
for a signed-in learner is a copy keyed by the same `runId`.

A run recorded before version 2 keeps `metrics: null`. It is not backfilled and cannot be: the
embeddings it was evaluated against are not retained, so the figures no longer exist. `null` says so,
and the interface offers a retrain rather than inventing zeros that would read as a model that got
everything wrong.

**Migration rules**:

- A schema change **must** ship a Dexie upgrade function. A learner's captured samples are
  unrecoverable if lost — nothing is backed up, by design — so a destructive migration is a defect.
- Adding a field is a version bump with a defaulting upgrade. Removing or retyping a field requires a
  migration that preserves the underlying image blobs even if the derived data is discarded.
- Embeddings are derived data and **may** be discarded and recomputed. Image blobs may not.

---

## Callable surface

```ts
// Projects
createProject(name: string, ownerId: string | null): Promise<Project>
listProjects(ownerId: string | null): Promise<Project[]>
deleteProject(id: string): Promise<void>              // cascades; see D1

// Classes
addClass(projectId: string, name: string): Promise<ClassRecord>
renameClass(id: string, name: string): Promise<void>  // see D2
reorderClasses(projectId: string, orderedIds: string[]): Promise<void>
deleteClass(id: string): Promise<void>                // cascades to its samples

// Samples
addSample(input: NewSample): Promise<SampleRecord>    // see D3, D4
listSamples(projectId: string, classId?: string): Promise<SampleRecord[]>
deleteSample(id: string): Promise<void>
countSamplesByClass(projectId: string): Promise<Record<string, number>>

// Models
saveModel(record: NewModel): Promise<void>
markModelReady(runId: string, metrics?: RunMetrics): Promise<void>
loadModelRecord(runId: string): Promise<ModelRecord | undefined>
markModelFailed(runId: string): Promise<void>
listStaleTrainingModels(): Promise<ModelRecord[]>     // see D5
listFinishedRuns(projectId: string): Promise<ModelRecord[]>  // see D11

// Explanations
cacheExplanation(record: NewExplanation): Promise<void>
findExplanation(key: ExplanationKey): Promise<ExplanationRecord | undefined>
pruneExplanations(runId: string, keep: number): Promise<void>

// Storage budget
estimateStorage(): Promise<StorageEstimate>           // see D6
requestPersistence(): Promise<boolean>
```

---

## Behavioural obligations

| # | Obligation |
|---|---|
| **D1** | `deleteProject` deletes its classes, samples, models, saved TensorFlow.js artifacts under `indexeddb://`, and cached explanations, in a single transaction. A partially deleted project must not be observable. |
| **D2** | `renameClass` changes only `classes.name`. It must not touch `training_runs`, which reference `classId`. A class renamed after training keeps its figures correctly attributed. |
| **D3** | `addSample` rejects a class that does not belong to the given project, and rejects a duplicate class name within a project case-insensitively. |
| **D4** | `addSample` computes and stores the pooled embedding at capture time, tagged with `embeddingAlpha`. If the project's `backboneAlpha` later changes, existing embeddings are marked stale and recomputed lazily with progress shown — never blocking, never silently mixing embeddings from different backbones. |
| **D5** | `listStaleTrainingModels` returns records left in `status: 'training'` by an interrupted session. The application must report these as unfinished and offer a restart, and must never load one for inference (FR-050). |
| **D6** | `estimateStorage` wraps `navigator.storage.estimate()`. Callers must warn at 80% of quota and refuse new captures at 95%, offering project deletion to reclaim room (FR-049). Where the API is unavailable, it reports `unknown` and the interface degrades to a generic warning rather than pretending to know. |
| **D7** | A quota error during a capture burst must be caught, must stop the burst, must keep every sample already written, and must tell the learner exactly how many were saved. Losing captured samples silently is the worst failure mode this product has. |
| **D8** | `findExplanation` keys on `(runId, frameHash, classId, method)` plus the method's parameters. A cached map computed with a different grid size or target layer is a miss, not a hit. |
| **D9** | Every read returns data owned by the current session's `ownerId`, or `null`-owned anonymous data. A logged-in learner must never see another account's local projects on a shared classroom device. |
| **D10** | No function in this module may send data anywhere. Enforced by the import-boundary lint rule that forbids `fetch`, `XMLHttpRequest`, and the Supabase client inside `src/lib/db.ts`. |
| **D11** | `listFinishedRuns` returns only records that are `ready` **and** carry `metrics`, newest first. A run that did not finish has no figures worth comparing, and offering one would be the same defect FR-050 forbids in the predictor, one screen over. |

D9 deserves emphasis: shared devices are the norm in schools, so scoping local reads by `ownerId` is
a real privacy requirement, not a theoretical one.

---

## Required test scenarios

1. **D1** — after `deleteProject`, no class, sample, model artifact, or cached explanation for that
   project remains.
2. **D2** — rename a class after training; the run's per-class figures still resolve to the right
   class.
3. **D4** — switch `backboneAlpha`; embeddings are marked stale, recomputed, and never mixed across
   alphas within one training run.
4. **D5** — simulate an interrupted training; the record is reported unfinished and refused for
   inference.
5. **D7** — inject a quota error mid-burst; samples already written survive and the reported count
   matches what was stored.
6. **D8** — request an explanation with a changed grid size; the cache misses.
7. **D9** — seed two owners' projects in one browser profile; each session sees only its own.
8. **D10** — the import-boundary lint rule fails when a network call is added to the module.
9. **Migration** — open a version-1 database with the version-2 schema; image blobs survive intact.
