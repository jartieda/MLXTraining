import type { LessonModule, ModuleId, Prerequisite } from './schema'

/**
 * T095 / FR-033 — the seven modules, in teaching order.
 *
 * FR-033 fixes the sequence and it is a curriculum rather than a menu, so each one
 * assumes the one before it. The arc: see what the model sees, learn to read the
 * evidence, discover that the evidence is often the wrong thing (shortcuts), prove
 * it by breaking the model on purpose, discover that the explanation is itself a
 * model with limits, run the fairness experiment that makes bias measurable rather
 * than a slogan, and finally present a model and defend its explanation.
 *
 * The order matters most between modules 3 and 4. "Shortcuts and bias" is a claim;
 * "fooling the model" is the learner proving it herself. Teaching them the other way
 * round turns the finding into a trick.
 *
 * > **Constitution, Development Workflow**: learning content must be reviewed by
 * > someone with classroom experience before release — a technically correct lesson
 * > that does not teach is a defect. This authoring has not had that review, and the
 * > pacing of modules 3 and 6 in particular is the kind of thing only a classroom
 * > shows you.
 */

/** Built once so the same prerequisite object is not re-described five times. */
const NEEDS: Record<string, Prerequisite> = {
  project: {
    kind: 'project',
    satisfiedBy: { moduleId: 'what-the-model-sees', stepSlug: 'make-a-project' },
  },
  twoClasses: {
    kind: 'twoClasses',
    satisfiedBy: { moduleId: 'what-the-model-sees', stepSlug: 'name-two-classes' },
  },
  tenEach: {
    kind: 'samplesPerClass',
    count: 10,
    satisfiedBy: { moduleId: 'what-the-model-sees', stepSlug: 'capture-ten-each' },
  },
  trained: {
    kind: 'trainedModel',
    satisfiedBy: { moduleId: 'what-the-model-sees', stepSlug: 'train-it' },
  },
  gradcam: {
    kind: 'gradcamExplanation',
    satisfiedBy: { moduleId: 'reading-a-heat-map', stepSlug: 'explain-a-frame' },
  },
  both: {
    kind: 'bothExplanations',
    satisfiedBy: { moduleId: 'comparing-explanations', stepSlug: 'run-both' },
  },
  imbalanced: {
    kind: 'imbalancedRun',
    satisfiedBy: { moduleId: 'imbalance-experiment', stepSlug: 'train-lopsided' },
  },
  twoRuns: {
    kind: 'twoRuns',
    satisfiedBy: { moduleId: 'imbalance-experiment', stepSlug: 'rebalance-and-retrain' },
  },
}

export const LESSON_MODULES: readonly LessonModule[] = [
  {
    id: 'what-the-model-sees',
    order: 1,
    steps: [
      { slug: 'read-the-goal', where: null },
      { slug: 'make-a-project', where: 'projects' },
      { slug: 'name-two-classes', where: 'lab' },
      { slug: 'capture-ten-each', where: 'lab' },
      { slug: 'train-it', where: 'lab' },
      { slug: 'try-something-new', where: 'lab' },
    ],
    // The first module's challenge is where the "a class it has never seen" edge
    // case becomes a teaching point rather than a bug (Edge Cases).
    challengeRequires: [NEEDS.trained!],
    questionIds: ['what-it-used', 'never-seen'],
  },

  {
    id: 'reading-a-heat-map',
    order: 2,
    steps: [
      { slug: 'read-the-goal', where: null },
      { slug: 'freeze-a-frame', where: 'lab' },
      { slug: 'explain-a-frame', where: 'lab' },
      { slug: 'switch-the-class', where: 'lab' },
      { slug: 'move-the-slider', where: 'lab' },
    ],
    challengeRequires: [NEEDS.trained!, NEEDS.gradcam!],
    questionIds: ['where-it-looked', 'evidence-not-reason'],
  },

  {
    id: 'shortcuts-and-bias',
    order: 3,
    steps: [
      { slug: 'read-the-goal', where: null },
      { slug: 'same-background', where: 'lab' },
      { slug: 'train-and-explain', where: 'lab' },
      { slug: 'spot-the-shortcut', where: 'lab' },
      { slug: 'change-one-thing', where: 'lab' },
    ],
    challengeRequires: [NEEDS.trained!, NEEDS.gradcam!],
    questionIds: ['what-was-the-shortcut', 'who-would-it-fail'],
  },

  {
    id: 'fooling-the-model',
    order: 4,
    steps: [
      { slug: 'read-the-goal', where: null },
      { slug: 'predict-the-failure', where: null },
      { slug: 'try-to-fool-it', where: 'lab' },
      { slug: 'explain-the-mistake', where: 'lab' },
    ],
    challengeRequires: [NEEDS.trained!],
    questionIds: ['how-you-fooled-it', 'confident-and-wrong'],
  },

  {
    id: 'comparing-explanations',
    order: 5,
    steps: [
      { slug: 'read-the-goal', where: null },
      { slug: 'run-both', where: 'lab' },
      { slug: 'read-the-agreement', where: 'lab' },
      { slug: 'find-a-disagreement', where: 'lab' },
    ],
    challengeRequires: [NEEDS.trained!, NEEDS.both!],
    questionIds: ['which-do-you-trust', 'why-disagree'],
  },

  {
    id: 'imbalance-experiment',
    order: 6,
    steps: [
      { slug: 'read-the-goal', where: null },
      { slug: 'train-lopsided', where: 'lab' },
      { slug: 'read-the-breakdown', where: 'results' },
      { slug: 'explain-the-small-class', where: 'lab' },
      { slug: 'rebalance-and-retrain', where: 'lab' },
      { slug: 'compare-the-runs', where: 'results' },
    ],
    // FR-036's before-and-after: both the skewed run and the rebalanced one must
    // exist before the challenge means anything.
    challengeRequires: [NEEDS.imbalanced!, NEEDS.twoRuns!],
    questionIds: ['what-happened-to-the-small-class', 'who-gets-hurt', 'what-would-you-check'],
    showsRunComparison: true,
  },

  {
    id: 'final-presentation',
    order: 7,
    steps: [
      { slug: 'read-the-goal', where: null },
      { slug: 'pick-your-model', where: 'projects' },
      { slug: 'gather-the-evidence', where: 'results' },
      { slug: 'write-the-honest-limits', where: null },
      { slug: 'present-it', where: null },
    ],
    challengeRequires: [NEEDS.trained!, NEEDS.both!, NEEDS.twoRuns!],
    questionIds: ['what-it-does-well', 'what-it-gets-wrong', 'would-you-deploy-it'],
  },
]

export const MODULE_BY_ID: ReadonlyMap<ModuleId, LessonModule> = new Map(
  LESSON_MODULES.map((module) => [module.id, module]),
)

/** The module before `id`, or `null` for the first. Used to suggest a starting point. */
export function previousModule(id: ModuleId): LessonModule | null {
  const module = MODULE_BY_ID.get(id)
  if (!module) return null
  return LESSON_MODULES.find((candidate) => candidate.order === module.order - 1) ?? null
}
