import { create } from 'zustand'
import type { BackendReport } from '@/ml/types'
import type { LoadedBackbone } from '@/ml/backbone'
import type { TrainedModel } from '@/ml/train'
import type { EvaluationResult } from '@/ml/metrics'
import * as db from '@/lib/db'

/**
 * The lab's shared state.
 *
 * A note on the directory: plan.md lists `features/` organised by user journey and
 * does not name a `lab/`. This one exists because the loaded backbone and the
 * trained model are shared by capture (T042 embeds at capture time), training
 * (T045), testing (T046) and explaining (T053) — four features across three
 * panels. Threading a `TrainedModel` handle through props between them would put
 * the disposal responsibility in whichever component happened to unmount last,
 * and a leaked backbone is 5.4 MB of GPU memory.
 *
 * The rule that matters here: **this store owns the disposal** of the backbone and
 * the model. Nothing else calls `dispose()` on either, because two owners means
 * either a double dispose or a leak, and R8 makes the leak fatal in a classroom
 * session where a learner retrains a dozen times.
 */

export type TrainingPhase = 'idle' | 'preparing' | 'training' | 'done' | 'cancelled' | 'failed'

export interface TrainingProgress {
  readonly phase: TrainingPhase
  readonly epoch: number
  readonly totalEpochs: number
  readonly loss: number | null
  readonly accuracy: number | null
  readonly elapsedMs: number | null
}

export const IDLE_PROGRESS: TrainingProgress = {
  phase: 'idle',
  epoch: 0,
  totalEpochs: 0,
  loss: null,
  accuracy: null,
  elapsedMs: null,
}

export interface TrainingSettings {
  /**
   * FR-008 allows **at most three** learner-comprehensible settings, each with a
   * default and a plain-language explanation. These are the three, and the limit
   * is a product decision worth keeping: a learner who can change fifteen
   * hyperparameters learns that machine learning is a control panel.
   */
  readonly epochs: number
  readonly batchSize: number
  readonly backboneAlpha: db.Alpha
}

export const DEFAULT_SETTINGS: TrainingSettings = {
  epochs: 20,
  batchSize: 16,
  backboneAlpha: 0.5,
}

interface LabState {
  readonly projectId: string | null
  readonly project: db.Project | null
  readonly classes: readonly db.ClassRecord[]
  readonly sampleCounts: Readonly<Record<string, number>>
  readonly selectedClassId: string | null

  readonly backend: BackendReport | null
  readonly backbone: LoadedBackbone | null
  readonly backboneLoading: boolean
  /**
   * Why the backbone could not be loaded, if it could not.
   *
   * Held rather than swallowed because there is no degraded mode to fall back to:
   * every sample's embedding is computed at capture time (D4), so a lab with no
   * backbone can neither photograph nor upload. A learner facing that needs to be
   * told, not left with two disabled buttons and no explanation.
   */
  readonly backboneError: string | null

  readonly model: TrainedModel | null
  readonly runId: string | null
  readonly evaluation: EvaluationResult | null
  readonly progress: TrainingProgress
  readonly settings: TrainingSettings

  /** Set when a project's cached embeddings are stale after an alpha change (D4). */
  readonly staleEmbeddings: number

  readonly setBackend: (report: BackendReport) => void
  readonly setBackbone: (backbone: LoadedBackbone | null, loading?: boolean) => void
  readonly setBackboneLoading: (loading: boolean) => void
  readonly setBackboneError: (message: string | null) => void

  readonly openProject: (projectId: string) => Promise<void>
  readonly closeProject: () => void
  readonly refreshClasses: () => Promise<void>
  readonly selectClass: (classId: string | null) => void

  readonly setModel: (model: TrainedModel | null, runId: string | null) => void
  readonly setEvaluation: (evaluation: EvaluationResult | null) => void
  readonly setProgress: (progress: Partial<TrainingProgress>) => void
  readonly resetProgress: () => void
  readonly updateSettings: (settings: Partial<TrainingSettings>) => void
}

export const useLab = create<LabState>((set, get) => ({
  projectId: null,
  project: null,
  classes: [],
  sampleCounts: {},
  selectedClassId: null,

  backend: null,
  backbone: null,
  backboneLoading: false,
  backboneError: null,

  model: null,
  runId: null,
  evaluation: null,
  progress: IDLE_PROGRESS,
  settings: DEFAULT_SETTINGS,
  staleEmbeddings: 0,

  setBackend: (report) => {
    set({ backend: report })
  },

  setBackbone: (backbone, loading = false) => {
    const previous = get().backbone
    // Replacing the backbone — which happens when a learner changes the detail
    // level — must dispose the old one. This is the store's job precisely because
    // no single component's lifetime matches the backbone's.
    if (previous && previous !== backbone) previous.dispose()
    set({ backbone, backboneLoading: loading, backboneError: backbone ? null : get().backboneError })
  },

  setBackboneLoading: (loading) => {
    set({ backboneLoading: loading })
  },

  setBackboneError: (message) => {
    set({ backboneError: message })
  },

  openProject: async (projectId) => {
    const project = await db.db.projects.get(projectId)
    const classes = await db.listClasses(projectId)
    const sampleCounts = await db.countSamplesByClass(projectId)
    const stale = await db.listStaleEmbeddingSamples(projectId)

    // A trained model belongs to the project it was trained on. Carrying one over
    // would let a learner "test" project B against project A's model and get
    // confident nonsense.
    get().model?.dispose()

    set({
      projectId,
      project: project ?? null,
      classes,
      sampleCounts,
      selectedClassId: classes[0]?.id ?? null,
      model: null,
      runId: null,
      evaluation: null,
      progress: IDLE_PROGRESS,
      staleEmbeddings: stale.length,
      settings: project
        ? { ...DEFAULT_SETTINGS, backboneAlpha: project.backboneAlpha }
        : DEFAULT_SETTINGS,
    })
  },

  closeProject: () => {
    const { model, backbone } = get()
    model?.dispose()
    backbone?.dispose()
    set({
      projectId: null,
      project: null,
      classes: [],
      sampleCounts: {},
      selectedClassId: null,
      model: null,
      runId: null,
      evaluation: null,
      progress: IDLE_PROGRESS,
      backbone: null,
      staleEmbeddings: 0,
    })
  },

  refreshClasses: async () => {
    const { projectId } = get()
    if (!projectId) return
    const classes = await db.listClasses(projectId)
    const sampleCounts = await db.countSamplesByClass(projectId)
    const selected = get().selectedClassId

    set({
      classes,
      sampleCounts,
      // If the selected class was just deleted, fall back to the first rather than
      // leaving capture pointed at nothing.
      selectedClassId: classes.some((k) => k.id === selected) ? selected : (classes[0]?.id ?? null),
    })
  },

  selectClass: (classId) => {
    set({ selectedClassId: classId })
  },

  setModel: (model, runId) => {
    const previous = get().model
    if (previous && previous !== model) previous.dispose()
    set({ model, runId })
  },

  setEvaluation: (evaluation) => {
    set({ evaluation })
  },

  setProgress: (progress) => {
    set({ progress: { ...get().progress, ...progress } })
  },

  resetProgress: () => {
    set({ progress: IDLE_PROGRESS })
  },

  updateSettings: (settings) => {
    set({ settings: { ...get().settings, ...settings } })
  },
}))

/** The classes that have no samples, by name — for the FR-007 refusal message. */
export function emptyClassNames(
  classes: readonly db.ClassRecord[],
  counts: Readonly<Record<string, number>>,
): string[] {
  return classes.filter((klass) => (counts[klass.id] ?? 0) === 0).map((klass) => klass.name)
}

export interface TrainReadiness {
  readonly ready: boolean
  readonly reason: 'needTwoClasses' | 'emptyClass' | 'emptyClasses' | null
  readonly emptyNames: readonly string[]
}

/**
 * Whether training can start, and if not, why — in a form the interface can turn
 * into a sentence that NAMES the problem class (Acceptance Scenario 1.3).
 *
 * "Not enough data" is useless to a learner looking at four classes. The name is
 * the whole value of the message.
 */
export function trainReadiness(
  classes: readonly db.ClassRecord[],
  counts: Readonly<Record<string, number>>,
): TrainReadiness {
  if (classes.length < 2) {
    return { ready: false, reason: 'needTwoClasses', emptyNames: [] }
  }

  const empty = emptyClassNames(classes, counts)
  if (empty.length === 1) return { ready: false, reason: 'emptyClass', emptyNames: empty }
  if (empty.length > 1) return { ready: false, reason: 'emptyClasses', emptyNames: empty }

  return { ready: true, reason: null, emptyNames: [] }
}
