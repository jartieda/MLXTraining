import Dexie, { type EntityTable } from 'dexie'

/**
 * T027, T028 / contracts/storage.md / FR-031, FR-049.
 *
 * This module holds everything the constitution forbids from leaving the device:
 * samples, embeddings, trained weights and generated explanations. Its contract is as
 * much a privacy boundary as a persistence layer, so **D10** is absolute: nothing here
 * may send data anywhere. There is no `fetch`, no `XMLHttpRequest`, and no Supabase
 * import in this file, and the import-boundary lint rule fails the build if one appears.
 *
 * The second thing to know before changing anything: this is the **only copy** of a
 * learner's work. Nothing is backed up — that is the privacy design, not an omission — so
 * a destructive migration or a lost sample is unrecoverable. Hence D7's insistence that a
 * quota error mid-burst keeps every sample already written and reports the true count.
 */

export type Alpha = 0.25 | 0.5
export type SampleSource = 'camera' | 'upload'
export type ModelStatus = 'training' | 'ready' | 'failed'
export type ExplanationMethod = 'gradcam' | 'occlusion'
export type ExplanationParams = Readonly<Record<string, number | string>>

export interface Project {
  id: string
  name: string
  /** `null` for an anonymous session (FR-023). */
  ownerId: string | null
  createdAt: string
  updatedAt: string
  activeRunId: string | null
  backboneAlpha: Alpha
}

export interface ClassRecord {
  id: string
  projectId: string
  name: string
  order: number
  createdAt: string
}

export interface SampleRecord {
  id: string
  projectId: string
  classId: string
  image: Blob
  /** Pooled backbone vector. `null` only while awaiting a lazy recompute (D4). */
  embedding: Float32Array | null
  /** Which backbone width produced `embedding`. */
  embeddingAlpha: Alpha | null
  source: SampleSource
  capturedAt: string
}

/**
 * What one class scored in one run.
 *
 * `classId` and `className` are both stored, and the redundancy is deliberate:
 * the id is what keeps a run's figures correctly attributed after a rename (D2),
 * and the name is what the run was called *at the time*, so a comparison of two
 * runs can say "this used to be called Cats" rather than showing a blank where a
 * since-deleted class used to be.
 */
export interface RunClassMetric {
  readonly classId: string
  readonly className: string
  readonly sampleCount: number
  readonly accuracy: number
}

/**
 * The figures FR-020 reports and FR-010 compares, stored locally.
 *
 * Local because FR-023 gives an unauthenticated visitor the complete lab, and
 * "compare two runs" is part of it. Held remotely only, run comparison would
 * silently be an account feature — and the fairness lesson (FR-036) that argues
 * from a skewed run and a rebalanced one would stop working for exactly the
 * learner most likely to be using a shared classroom machine with no account.
 *
 * The remote `training_runs` row for a signed-in learner is a copy of this, keyed
 * by the same `runId`, holding numbers and names and nothing else.
 */
export interface RunMetrics {
  readonly perClass: readonly RunClassMetric[]
  /** Row = true class, column = predicted class, ordered as `perClass`. */
  readonly confusion: readonly (readonly number[])[]
  readonly overallAccuracy: number
  /** Largest ÷ smallest class count. `null` where it was not finite. */
  readonly imbalanceRatio: number | null
  readonly backboneAlpha: Alpha
  readonly epochs: number
  readonly finishedAt: string
}

export interface ModelRecord {
  runId: string
  projectId: string
  artifactKey: string
  /** Ordered class ids: maps output index → class. Load-bearing after a reorder. */
  classOrder: string[]
  status: ModelStatus
  savedAt: string
  /** `null` until the run finishes, and for every run recorded before version 2. */
  metrics: RunMetrics | null
}

export interface ExplanationRecord {
  id: string
  runId: string
  frameHash: string
  classId: string
  method: ExplanationMethod
  map: Float32Array
  /** Native map resolution — method-specific, never assumed (data-model.md). */
  width: number
  height: number
  params: ExplanationParams
  computedAt: string
}

export type StorageErrorCode =
  | 'QUOTA_EXCEEDED'
  | 'INVALID_NAME'
  | 'DUPLICATE_CLASS_NAME'
  | 'CLASS_NOT_IN_PROJECT'
  | 'PROJECT_NOT_FOUND'
  | 'CLASS_NOT_FOUND'
  | 'ALPHA_MISMATCH'
  | 'MAP_SIZE_MISMATCH'
  | 'INCOMPLETE_ORDER'

export class StorageError extends Error {
  readonly code: StorageErrorCode
  /** For `QUOTA_EXCEEDED`: how many samples were successfully written before it hit. */
  readonly saved: number | undefined

  constructor(code: StorageErrorCode, message: string, options: { saved?: number } = {}) {
    super(message)
    this.name = 'StorageError'
    this.code = code
    this.saved = options.saved
  }
}

export function isQuotaError(error: unknown): boolean {
  if (error instanceof StorageError) return error.code === 'QUOTA_EXCEEDED'
  if (!(error instanceof Error)) return false
  // Browsers disagree on the name, and Dexie wraps the original. Checking the message too
  // is ugly and necessary: mistaking a quota error for a generic failure loses the "keep
  // what was written" behaviour D7 exists for.
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error.name === 'QuotaExceededError2' ||
    /quota/i.test(error.message)
  )
}

class LabDatabase extends Dexie {
  projects!: EntityTable<Project, 'id'>
  classes!: EntityTable<ClassRecord, 'id'>
  samples!: EntityTable<SampleRecord, 'id'>
  models!: EntityTable<ModelRecord, 'runId'>
  explanations!: EntityTable<ExplanationRecord, 'id'>

  constructor() {
    super('ml4g-xai-lab')
    // Version 1, exactly as specified in contracts/storage.md. Any schema change must
    // ship an upgrade function: image blobs are not derived data and may never be
    // discarded, though embeddings may (they are recomputable).
    this.version(1).stores({
      projects: 'id, ownerId, updatedAt',
      classes: 'id, projectId, [projectId+order]',
      samples: 'id, projectId, classId, [projectId+classId], capturedAt',
      models: 'runId, projectId, status',
      explanations: 'id, runId, [runId+frameHash+classId+method], computedAt',
    })

    /**
     * Version 2 (T089) adds `models.metrics`, so FR-010's run comparison works
     * for a learner with no account.
     *
     * A field addition with a defaulting upgrade, exactly as the migration rules
     * in contracts/storage.md require. The index list is unchanged — `metrics` is
     * a nested object nothing queries by — and the upgrade only writes `null`
     * into rows that predate it. No image blob is read, rewritten or risked,
     * which matters because they are the one thing here that cannot be
     * recomputed.
     */
    this.version(2)
      .stores({
        projects: 'id, ownerId, updatedAt',
        classes: 'id, projectId, [projectId+order]',
        samples: 'id, projectId, classId, [projectId+classId], capturedAt',
        models: 'runId, projectId, status',
        explanations: 'id, runId, [runId+frameHash+classId+method], computedAt',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<ModelRecord>('models')
          .toCollection()
          .modify((record) => {
            // A run trained before version 2 has no figures and never will: the
            // embeddings it was evaluated against are not retained. `null` says
            // so, and the interface offers a retrain rather than inventing zeros
            // that would read as a model that got everything wrong.
            record.metrics ??= null
          })
      })
  }
}

export const db = new LabDatabase()

export const DEFAULT_ALPHA: Alpha = 0.5

function now(): string {
  return new Date().toISOString()
}

function uuid(): string {
  return crypto.randomUUID()
}

/** Case- and whitespace-insensitive comparison key for names (D3). */
function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase()
}

// ───────────────────────────────────────────────────────────── projects

export async function createProject(name: string, ownerId: string | null): Promise<Project> {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 60) {
    throw new StorageError(
      'INVALID_NAME',
      `A project name must be between 1 and 60 characters; got ${String(trimmed.length)}.`,
    )
  }

  const timestamp = now()
  const project: Project = {
    id: uuid(),
    name: trimmed,
    ownerId,
    createdAt: timestamp,
    updatedAt: timestamp,
    activeRunId: null,
    backboneAlpha: DEFAULT_ALPHA,
  }
  await db.projects.add(project)
  return project
}

/**
 * D9: every read is scoped to the current session's owner.
 *
 * Shared devices are the norm in schools, so this is a real privacy requirement rather
 * than a theoretical one — without it, a learner signing in after her classmate on the
 * same Chromebook sees that classmate's projects. `null` means the anonymous session, and
 * an anonymous session sees only anonymous work.
 */
export async function listProjects(ownerId: string | null): Promise<Project[]> {
  const all = await db.projects.toArray()
  return all
    .filter((project) => project.ownerId === ownerId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getProject(id: string, ownerId: string | null): Promise<Project | undefined> {
  const project = await db.projects.get(id)
  if (!project) return undefined
  // D9 again, and deliberately at the single-record level too: a project id reaching the
  // router from a stale bookmark must not open another account's work.
  return project.ownerId === ownerId ? project : undefined
}

export async function renameProject(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 60) {
    throw new StorageError('INVALID_NAME', 'A project name must be between 1 and 60 characters.')
  }
  await db.projects.update(id, { name: trimmed, updatedAt: now() })
}

export async function setActiveRun(projectId: string, runId: string | null): Promise<void> {
  await db.projects.update(projectId, { activeRunId: runId, updatedAt: now() })
}

export interface DeleteProjectOptions {
  /**
   * Removes the TensorFlow.js artifact saved under `indexeddb://`. Injected rather than
   * imported so this module keeps no dependency on the ML layer, and so D1's atomicity
   * can be tested by making it fail.
   */
  readonly removeArtifact?: (artifactKey: string) => Promise<void>
}

/**
 * D1: deletes the project's classes, samples, models, saved artifacts and cached
 * explanations in a single transaction. A partially deleted project must not be
 * observable — a learner cannot tell which half of her samples went, so a failed delete
 * that changed nothing is strictly better than a successful one that changed some.
 */
export async function deleteProject(id: string, options: DeleteProjectOptions = {}): Promise<void> {
  const models = await db.models.where('projectId').equals(id).toArray()

  // Artifacts go **first**, outside the transaction, and the ordering is deliberate.
  //
  // It cannot go inside: `removeArtifact` reaches a different store through a promise
  // Dexie does not own, and awaiting a foreign promise inside a Dexie transaction lets
  // that transaction commit early — so an "atomic" delete that included this step would
  // silently not be atomic at all, which is worse than not claiming it.
  //
  // Given that, failing first is the safe order. If artifact removal refuses, nothing is
  // deleted and the learner still has her project. The alternative order would leave
  // orphaned weights occupying quota with no metadata left to find them by.
  if (options.removeArtifact) {
    for (const model of models) await options.removeArtifact(model.artifactKey)
  }

  // Everything a learner can *see* goes in one transaction, so the observable state moves
  // from wholly present to wholly absent. A project missing half its samples is worse
  // than one that failed to delete: she cannot tell which half went (D1).
  await db.transaction('rw', db.projects, db.classes, db.samples, db.models, db.explanations, async () => {
    const runIds = models.map((model) => model.runId)

    await db.samples.where('projectId').equals(id).delete()
    await db.classes.where('projectId').equals(id).delete()
    await db.models.where('projectId').equals(id).delete()
    for (const runId of runIds) {
      await db.explanations.where('runId').equals(runId).delete()
    }
    await db.projects.delete(id)
  })
}

// ───────────────────────────────────────────────────────────── classes

export async function addClass(projectId: string, name: string): Promise<ClassRecord> {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 40) {
    throw new StorageError(
      'INVALID_NAME',
      `A class name must be between 1 and 40 characters; got ${String(trimmed.length)}.`,
    )
  }

  return db.transaction('rw', db.projects, db.classes, async () => {
    const project = await db.projects.get(projectId)
    if (!project) {
      throw new StorageError('PROJECT_NOT_FOUND', `No project with id ${projectId}.`)
    }

    const siblings = await db.classes.where('projectId').equals(projectId).toArray()
    if (siblings.some((sibling) => nameKey(sibling.name) === nameKey(trimmed))) {
      // D3 / FR-001. Case-insensitive because "Apple" and "apple" are the same class to a
      // learner, and two bars with the same label is a confusing result to debug.
      throw new StorageError(
        'DUPLICATE_CLASS_NAME',
        `This project already has a class called "${trimmed}". Pick another name.`,
      )
    }

    const record: ClassRecord = {
      id: uuid(),
      projectId,
      name: trimmed,
      order: siblings.reduce((max, sibling) => Math.max(max, sibling.order), -1) + 1,
      createdAt: now(),
    }
    await db.classes.add(record)
    await db.projects.update(projectId, { updatedAt: now() })
    return record
  })
}

export async function listClasses(projectId: string): Promise<ClassRecord[]> {
  const classes = await db.classes.where('projectId').equals(projectId).toArray()
  return classes.sort((a, b) => a.order - b.order)
}

/**
 * D2: changes only `classes.name`.
 *
 * It deliberately touches nothing else. `training_runs` reference `classId`, never the
 * name, so a class renamed after training keeps its figures correctly attributed — a
 * rename that rewrote historical results would quietly falsify them.
 */
export async function renameClass(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 40) {
    throw new StorageError('INVALID_NAME', 'A class name must be between 1 and 40 characters.')
  }

  await db.transaction('rw', db.classes, async () => {
    const existing = await db.classes.get(id)
    if (!existing) throw new StorageError('CLASS_NOT_FOUND', `No class with id ${id}.`)

    const siblings = await db.classes.where('projectId').equals(existing.projectId).toArray()
    const collides = siblings.some(
      (sibling) => sibling.id !== id && nameKey(sibling.name) === nameKey(trimmed),
    )
    if (collides) {
      throw new StorageError(
        'DUPLICATE_CLASS_NAME',
        `This project already has a class called "${trimmed}". Pick another name.`,
      )
    }

    await db.classes.update(id, { name: trimmed })
  })
}

export async function reorderClasses(projectId: string, orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.classes, async () => {
    const current = await db.classes.where('projectId').equals(projectId).toArray()
    const currentIds = new Set(current.map((klass) => klass.id))

    // A partial list would silently drop whichever class was omitted off the end of the
    // ordering, and the class list is how a learner reads her own prediction bars.
    if (orderedIds.length !== current.length || !orderedIds.every((id) => currentIds.has(id))) {
      throw new StorageError(
        'INCOMPLETE_ORDER',
        `A reorder must list exactly the project's ${String(current.length)} classes; got ${String(orderedIds.length)}.`,
      )
    }

    await Promise.all(orderedIds.map((id, order) => db.classes.update(id, { order })))
  })
}

export async function deleteClass(id: string): Promise<void> {
  await db.transaction('rw', db.classes, db.samples, async () => {
    await db.samples.where('classId').equals(id).delete()
    await db.classes.delete(id)
  })
}

// ───────────────────────────────────────────────────────────── samples

export interface NewSample {
  readonly projectId: string
  readonly classId: string
  readonly image: Blob
  /**
   * The pooled backbone vector, computed at capture time (D4, R2) so that training never
   * runs the backbone. The *caller* computes it: `src/ml/` must stay out of this module
   * (D10, Principle VI), so the feature layer embeds at the capture boundary and hands
   * the result in.
   */
  readonly embedding: Float32Array
  readonly embeddingAlpha: Alpha
  readonly source: SampleSource
}

export async function addSample(input: NewSample): Promise<SampleRecord> {
  return db.transaction('rw', db.projects, db.classes, db.samples, async () => {
    const record = await buildSample(input)
    await db.samples.add(record)
    await db.projects.update(input.projectId, { updatedAt: now() })
    return record
  })
}

async function buildSample(input: NewSample): Promise<SampleRecord> {
  const project = await db.projects.get(input.projectId)
  if (!project) {
    throw new StorageError('PROJECT_NOT_FOUND', `No project with id ${input.projectId}.`)
  }

  const klass = await db.classes.get(input.classId)
  if (!klass || klass.projectId !== input.projectId) {
    // D3. A cross-project class id means the caller's state has drifted; writing the
    // sample anyway would attach it to a class the project cannot see, so it would look
    // like the capture silently failed.
    throw new StorageError(
      'CLASS_NOT_IN_PROJECT',
      `Class ${input.classId} does not belong to project ${input.projectId}.`,
    )
  }

  if (input.embeddingAlpha !== project.backboneAlpha) {
    // D4. Mixing embeddings from two backbone widths inside one training run produces a
    // model that trains happily and then predicts nonsense, with nothing on screen to
    // explain why — so it is refused at the write rather than detected at the symptom.
    throw new StorageError(
      'ALPHA_MISMATCH',
      `This sample was embedded by the alpha-${String(input.embeddingAlpha)} backbone but the project uses alpha ${String(project.backboneAlpha)}. Recompute the embedding before saving.`,
    )
  }

  return {
    id: uuid(),
    projectId: input.projectId,
    classId: input.classId,
    image: input.image,
    embedding: input.embedding,
    embeddingAlpha: input.embeddingAlpha,
    source: input.source,
    capturedAt: now(),
  }
}

export interface BurstResult {
  readonly saved: number
  readonly stoppedByQuota: boolean
  readonly savedIds: readonly string[]
}

/**
 * D7: writes a burst of samples one at a time, stopping cleanly on a quota error.
 *
 * Deliberately **not** one transaction. A transaction would roll back every sample in the
 * burst when the last one hit the quota, throwing away up to a whole press-and-hold of
 * captures. Losing captured samples silently is the worst failure mode this product has,
 * so each sample is committed on its own and the caller is told exactly how many survived.
 */
export async function addSampleBurst(inputs: readonly NewSample[]): Promise<BurstResult> {
  const savedIds: string[] = []

  for (const input of inputs) {
    try {
      const record = await buildSample(input)
      await db.samples.add(record)
      savedIds.push(record.id)
    } catch (error) {
      if (isQuotaError(error)) {
        // Stop the burst, keep what is written, and report the true count — the learner
        // needs to know exactly how many she has so she can decide what to delete.
        return { saved: savedIds.length, stoppedByQuota: true, savedIds }
      }
      throw error
    }
  }

  if (inputs.length > 0 && inputs[0]) {
    await db.projects.update(inputs[0].projectId, { updatedAt: now() })
  }

  return { saved: savedIds.length, stoppedByQuota: false, savedIds }
}

export async function listSamples(projectId: string, classId?: string): Promise<SampleRecord[]> {
  const samples =
    classId === undefined
      ? await db.samples.where('projectId').equals(projectId).toArray()
      : await db.samples.where('[projectId+classId]').equals([projectId, classId]).toArray()
  return samples.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
}

export async function deleteSample(id: string): Promise<void> {
  await db.samples.delete(id)
}

export async function countSamplesByClass(projectId: string): Promise<Record<string, number>> {
  const samples = await db.samples.where('projectId').equals(projectId).toArray()
  const counts: Record<string, number> = {}
  for (const sample of samples) {
    counts[sample.classId] = (counts[sample.classId] ?? 0) + 1
  }
  return counts
}

/**
 * D4: switching the project's backbone width invalidates its embeddings.
 *
 * They are marked stale, not deleted — the image blobs stay untouched, because a blob is
 * the irreplaceable thing and an embedding is derived data that can be recomputed. The
 * recompute is then lazy and progress-reported rather than blocking (D4).
 */
export async function markEmbeddingsStale(projectId: string, newAlpha: Alpha): Promise<void> {
  await db.transaction('rw', db.projects, db.samples, async () => {
    await db.projects.update(projectId, { backboneAlpha: newAlpha, updatedAt: now() })
    const samples = await db.samples.where('projectId').equals(projectId).toArray()
    await Promise.all(
      samples
        .filter((sample) => sample.embeddingAlpha !== newAlpha)
        .map((sample) => db.samples.update(sample.id, { embedding: null, embeddingAlpha: null })),
    )
  })
}

export async function listStaleEmbeddingSamples(projectId: string): Promise<SampleRecord[]> {
  const samples = await db.samples.where('projectId').equals(projectId).toArray()
  return samples.filter((sample) => sample.embedding === null || sample.embeddingAlpha === null)
}

export async function setSampleEmbedding(
  id: string,
  embedding: Float32Array,
  embeddingAlpha: Alpha,
): Promise<void> {
  await db.samples.update(id, { embedding, embeddingAlpha })
}

// ───────────────────────────────────────────────────────────── models

export interface NewModel {
  readonly runId: string
  readonly projectId: string
  readonly artifactKey: string
  readonly classOrder: readonly string[]
}

/** Records a run as `training`. It becomes loadable only via `markModelReady` (D5). */
export async function saveModel(record: NewModel): Promise<void> {
  await db.models.put({
    runId: record.runId,
    projectId: record.projectId,
    artifactKey: record.artifactKey,
    classOrder: [...record.classOrder],
    status: 'training',
    savedAt: now(),
    metrics: null,
  })
}

export async function markModelReady(runId: string, metrics?: RunMetrics): Promise<void> {
  await db.models.update(runId, {
    status: 'ready',
    savedAt: now(),
    ...(metrics ? { metrics } : {}),
  })
}

/**
 * Every finished run for a project, newest first — the input to FR-010.
 *
 * `failed` and `training` runs are excluded. A run that did not finish has no
 * figures worth comparing, and offering one in a comparison would be the same
 * defect FR-050 forbids in the predictor, one screen over.
 */
export async function listFinishedRuns(projectId: string): Promise<ModelRecord[]> {
  const records = await db.models.where('projectId').equals(projectId).toArray()
  return records
    .filter((record) => record.status === 'ready' && record.metrics !== null)
    .sort((a, b) => (a.metrics?.finishedAt ?? '') < (b.metrics?.finishedAt ?? '') ? 1 : -1)
}

export async function markModelFailed(runId: string): Promise<void> {
  await db.models.update(runId, { status: 'failed' })
}

/**
 * D5 / FR-050: the gate that stops an unfinished model reaching the predictor.
 *
 * Returning `undefined` for anything not `ready` is the whole point. A half-trained head
 * still produces confident-looking probabilities, and a learner has no way to tell that
 * the numbers came from a model that never finished.
 */
export async function loadModelRecord(runId: string): Promise<ModelRecord | undefined> {
  const record = await db.models.get(runId)
  return record?.status === 'ready' ? record : undefined
}

/** Records left in `training` by an interrupted session — a closed tab, a dead battery. */
export async function listStaleTrainingModels(): Promise<ModelRecord[]> {
  return db.models.where('status').equals('training').toArray()
}

// ───────────────────────────────────────────────────────────── explanations

export interface NewExplanation {
  readonly runId: string
  readonly frameHash: string
  readonly classId: string
  readonly method: ExplanationMethod
  readonly map: Float32Array
  readonly width: number
  readonly height: number
  readonly params: ExplanationParams
}

export interface ExplanationKey {
  readonly runId: string
  readonly frameHash: string
  readonly classId: string
  readonly method: ExplanationMethod
  readonly params: ExplanationParams
}

/**
 * Stable string form of a params object, so `{a:1,b:2}` and `{b:2,a:1}` are one key.
 * Without the sort, key order alone would decide whether a cached map is found.
 */
function paramsKey(params: ExplanationParams): string {
  return JSON.stringify(
    Object.keys(params)
      .sort()
      .map((key) => [key, params[key]]),
  )
}

export async function cacheExplanation(record: NewExplanation): Promise<void> {
  if (record.map.length !== record.width * record.height) {
    throw new StorageError(
      'MAP_SIZE_MISMATCH',
      `A ${String(record.width)}×${String(record.height)} map needs ${String(record.width * record.height)} values but got ${String(record.map.length)}.`,
    )
  }

  await db.explanations.put({
    // The id encodes the full key, so a repeat of the same request replaces rather than
    // accumulating a second row for the identical map.
    id: `${record.runId}|${record.frameHash}|${record.classId}|${record.method}|${paramsKey(record.params)}`,
    runId: record.runId,
    frameHash: record.frameHash,
    classId: record.classId,
    method: record.method,
    map: record.map,
    width: record.width,
    height: record.height,
    params: record.params,
    computedAt: now(),
  })
}

/**
 * D8: keyed on `(runId, frameHash, classId, method)` **plus the method's parameters**.
 *
 * The parameters are not optional. Serving a 12×12 occlusion map for an 8×8 request, or a
 * 7×7 Grad-CAM map for a 14×14 one, renders a heat map that is wrong everywhere and looks
 * entirely plausible — the single most damaging cache bug available here.
 */
export async function findExplanation(key: ExplanationKey): Promise<ExplanationRecord | undefined> {
  return db.explanations.get(
    `${key.runId}|${key.frameHash}|${key.classId}|${key.method}|${paramsKey(key.params)}`,
  )
}

/** Keeps the `keep` most recent maps for a run and drops the rest. */
/**
 * Every cached explanation for a run.
 *
 * Added for the lesson prerequisites (T099): a module that says "compare the two
 * methods" needs to know whether she actually did, and the cache is the only record
 * that she did. Returns the records rather than a count, because the caller needs to
 * group them by frame — both methods on *one* frame is the comparison; one method on
 * two frames is not.
 */
export async function listExplanationsForRun(runId: string): Promise<ExplanationRecord[]> {
  return db.explanations.where('runId').equals(runId).toArray()
}

export async function pruneExplanations(runId: string, keep: number): Promise<void> {
  const records = await db.explanations.where('runId').equals(runId).toArray()
  if (records.length <= keep) return

  const doomed = records
    .sort((a, b) => b.computedAt.localeCompare(a.computedAt))
    .slice(keep)
    .map((record) => record.id)

  await db.explanations.bulkDelete(doomed)
}

// ───────────────────────────────────────────────────────────── storage budget

export const STORAGE_WARN_RATIO = 0.8
export const STORAGE_REFUSE_RATIO = 0.95

export interface StorageEstimate {
  /** `false` where the browser will not say. The interface must not then pretend. */
  readonly known: boolean
  readonly usage: number | null
  readonly quota: number | null
  readonly ratio: number | null
  readonly shouldWarn: boolean
  readonly shouldRefuse: boolean
}

const UNKNOWN_ESTIMATE: StorageEstimate = {
  known: false,
  usage: null,
  quota: null,
  ratio: null,
  shouldWarn: false,
  shouldRefuse: false,
}

/**
 * D6 / FR-049: wraps `navigator.storage.estimate()`.
 *
 * Where the API is unavailable or refuses, this reports `unknown` and both flags stay
 * `false`. Guessing in either direction is worse than admitting ignorance: refusing
 * captures on a guess blocks a learner who has plenty of room, and warning on a guess
 * teaches her to ignore the warning that matters.
 */
export async function estimateStorage(): Promise<StorageEstimate> {
  try {
    const storage = navigator.storage as StorageManager | undefined
    if (!storage || typeof storage.estimate !== 'function') return UNKNOWN_ESTIMATE

    const { usage, quota } = await storage.estimate()
    if (typeof usage !== 'number' || typeof quota !== 'number' || quota <= 0) {
      return UNKNOWN_ESTIMATE
    }

    const ratio = usage / quota
    return {
      known: true,
      usage,
      quota,
      ratio,
      shouldWarn: ratio >= STORAGE_WARN_RATIO,
      shouldRefuse: ratio >= STORAGE_REFUSE_RATIO,
    }
  } catch {
    return UNKNOWN_ESTIMATE
  }
}

/**
 * Asks the browser not to evict this origin's data (R10). Best-effort: a `false` result is
 * normal and not an error, so it never throws — it just means the browser may clear the
 * store under pressure, which the interface warns about instead.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    const storage = navigator.storage as StorageManager | undefined
    if (!storage || typeof storage.persist !== 'function') return false
    return await storage.persist()
  } catch {
    return false
  }
}
