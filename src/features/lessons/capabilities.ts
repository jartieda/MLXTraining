import * as db from '@/lib/db'
import { IMBALANCE_THRESHOLD } from '@/ml/metrics'
import type { CapabilityKind, Prerequisite } from '@/content/lessons/schema'

/**
 * T099 / FR-037, Scenario 5.4 — what the learner's lab actually contains.
 *
 * Read from IndexedDB rather than from the lab store, and that is not an oversight.
 * The learning path is its own route; `labStore` is populated by `LabPage.openProject`
 * and is empty here. A capability check against the store would report "no trained
 * model" to a learner who has three, which is the single most discouraging thing this
 * feature could do.
 *
 * Everything is measured **across all her projects**, not the one she last opened. A
 * module asks whether she has ever trained a model, and she may well have done it in
 * a different project from the one the module started her on.
 */

export type Capabilities = Readonly<Record<CapabilityKind, boolean>> & {
  /** The largest per-class minimum across her projects, for `samplesPerClass`. */
  readonly bestSamplesPerClass: number
}

export const NO_CAPABILITIES: Capabilities = {
  project: false,
  twoClasses: false,
  samplesPerClass: false,
  trainedModel: false,
  gradcamExplanation: false,
  bothExplanations: false,
  twoRuns: false,
  imbalancedRun: false,
  bestSamplesPerClass: 0,
}

export async function readCapabilities(ownerId: string | null): Promise<Capabilities> {
  const projects = await db.listProjects(ownerId)
  if (projects.length === 0) return NO_CAPABILITIES

  let twoClasses = false
  let bestSamplesPerClass = 0
  let trainedModel = false
  let twoRuns = false
  let imbalancedRun = false
  let gradcam = false
  let both = false

  for (const project of projects) {
    const classes = await db.listClasses(project.id)
    if (classes.length >= 2) twoClasses = true

    if (classes.length > 0) {
      const counts = await db.countSamplesByClass(project.id)
      // The MINIMUM across classes, because "ten photos in each class" is a claim
      // about the weakest class. Taking the mean would let forty photos of one
      // thing and none of another satisfy a step about balance.
      const weakest = Math.min(...classes.map((klass) => counts[klass.id] ?? 0))
      bestSamplesPerClass = Math.max(bestSamplesPerClass, weakest)
    }

    const runs = await db.listFinishedRuns(project.id)
    if (runs.length >= 1) trainedModel = true
    // Two runs *of the same project*, since FR-010 compares runs within a project.
    // Two runs across two projects have nothing to say to each other.
    if (runs.length >= 2) twoRuns = true

    for (const run of runs) {
      const ratio = run.metrics?.imbalanceRatio
      if (typeof ratio === 'number' && ratio >= IMBALANCE_THRESHOLD) imbalancedRun = true

      // Explanations are keyed by run, so this asks whether she explained a frame
      // from a model she trained — not merely whether a cache entry exists.
      const cached = await db.listExplanationsForRun(run.runId)
      if (cached.some((entry) => entry.method === 'gradcam')) gradcam = true

      // Both methods on the SAME frozen frame. Either method on any frame would
      // pass a learner who never actually compared anything, which is the whole
      // point of the module that requires this.
      const byFrame = new Map<string, Set<string>>()
      for (const entry of cached) {
        const methods = byFrame.get(entry.frameHash) ?? new Set<string>()
        methods.add(entry.method)
        byFrame.set(entry.frameHash, methods)
      }
      if ([...byFrame.values()].some((methods) => methods.size >= 2)) both = true
    }
  }

  return {
    project: true,
    twoClasses,
    samplesPerClass: bestSamplesPerClass > 0,
    trainedModel,
    gradcamExplanation: gradcam,
    bothExplanations: both,
    twoRuns,
    imbalancedRun,
    bestSamplesPerClass,
  }
}

/** Whether one prerequisite is met. `samplesPerClass` is the only one with a threshold. */
export function isMet(prerequisite: Prerequisite, capabilities: Capabilities): boolean {
  if (prerequisite.kind === 'samplesPerClass') {
    return capabilities.bestSamplesPerClass >= (prerequisite.count ?? 1)
  }
  return capabilities[prerequisite.kind]
}

/**
 * The prerequisites still missing, in the order the module lists them.
 *
 * Order preserved deliberately: the module lists them in the sequence they are
 * produced, so the first missing one is the next thing to do. Sorting or
 * deduplicating would break that.
 */
export function missing(
  prerequisites: readonly Prerequisite[],
  capabilities: Capabilities,
): readonly Prerequisite[] {
  return prerequisites.filter((prerequisite) => !isMet(prerequisite, capabilities))
}
