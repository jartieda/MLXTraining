/**
 * T094 / FR-033, FR-034, FR-037, R11 — the shape of a lesson module.
 *
 * **Structure lives here; every word lives in `src/locales/{en,es}/lessons.json`.**
 * That split is R11's, and it is what makes SC-005 enforceable: the locale
 * completeness test walks the `en` key tree and fails the build on anything missing
 * from `es`, so a module cannot ship half-translated. It also means this file stays
 * reviewable — seven modules of structure rather than seven modules of prose.
 *
 * The other load-bearing decision is that **a step is identified by a slug, never by
 * its index**. `lesson_progress.completed_steps` is a `text[]` of slugs
 * (data-model.md), so a module can gain a step, lose one, or reorder them without
 * invalidating the progress of every learner who is halfway through it. Indices
 * would silently re-point her completed work at different steps.
 */

export const MODULE_IDS = [
  'what-the-model-sees',
  'reading-a-heat-map',
  'shortcuts-and-bias',
  'fooling-the-model',
  'comparing-explanations',
  'imbalance-experiment',
  'final-presentation',
] as const

export type ModuleId = (typeof MODULE_IDS)[number]

/**
 * Something the lab must already contain before a challenge can be attempted.
 *
 * FR-037's obligation is not "say it is unavailable" — it is to **name the earlier
 * step to complete**. So a prerequisite carries the module and step that produces
 * it, and the interface renders that as a link. Without `satisfiedBy` the best the
 * interface could manage is "you need a trained model", which leaves a learner to
 * work out where models come from.
 */
export type CapabilityKind =
  /** At least one project exists on this device. */
  | 'project'
  /** At least two classes in one project — the minimum trainable set. */
  | 'twoClasses'
  /** At least `count` photos in every class of one project. */
  | 'samplesPerClass'
  /** A finished, ready model (FR-050 — an interrupted run does not count). */
  | 'trainedModel'
  /** A cached Grad-CAM map, i.e. she has explained at least one frozen frame. */
  | 'gradcamExplanation'
  /** Both methods cached for one frame — the US3 comparison actually happened. */
  | 'bothExplanations'
  /** Two finished runs, so the US7 comparison has something to compare. */
  | 'twoRuns'
  /** A run whose classes were deliberately imbalanced. */
  | 'imbalancedRun'

export interface Prerequisite {
  readonly kind: CapabilityKind
  /** Threshold for `samplesPerClass`; ignored by every other kind. */
  readonly count?: number
  /** The step that produces it — what FR-037 names when it is missing. */
  readonly satisfiedBy: { readonly moduleId: ModuleId; readonly stepSlug: string }
}

export interface LessonStep {
  /** Stable across content revisions. Stored in `completed_steps`. */
  readonly slug: string
  /**
   * Where in the application this step is carried out.
   *
   * Rendered as a link, because a step that says "capture ten photos" without a
   * route to the capture panel makes a learner hunt for it, and hunting is where
   * she stops. `null` for a step done in the module itself — reading, or thinking.
   */
  readonly where: 'lab' | 'projects' | 'results' | null
}

export interface LessonModule {
  readonly id: ModuleId
  /** 1-based position in the path. Fixed: FR-033 lists these in teaching order. */
  readonly order: number
  readonly steps: readonly LessonStep[]
  /**
   * What the challenge needs before it can be attempted. Empty for a module whose
   * challenge is purely reflective.
   */
  readonly challengeRequires: readonly Prerequisite[]
  /** At least one, per FR-034. Asserted by `tests/unit/lesson-content.test.ts`. */
  readonly questionIds: readonly string[]
  /**
   * Whether this module embeds US7's run comparison (FR-036).
   *
   * Only the imbalance module sets it. A flag rather than a per-module component
   * so the content stays data and the view stays one component.
   */
  readonly showsRunComparison?: boolean
}

/** The i18n key prefix for a module's text, in the `lessons` namespace. */
export function moduleKey(id: ModuleId): string {
  return `modules.${id}`
}

export function stepKey(id: ModuleId, slug: string): string {
  return `${moduleKey(id)}.steps.${slug}`
}

export function questionKey(id: ModuleId, questionId: string): string {
  return `${moduleKey(id)}.questions.${questionId}`
}
