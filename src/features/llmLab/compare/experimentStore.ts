import Dexie, { type EntityTable } from 'dexie'
import type { ChangeBand } from './compareResults'

/**
 * The comparisons a learner chose to keep, so the reflection at the end of the Lab LLM
 * can draw on them. Kept in a database of its own rather than as a new version of
 * `src/lib/db.ts`: the Lab CV's store is the only copy of a learner's photos, and
 * nothing in the Lab LLM is worth a migration of it.
 *
 * Like every store in this application it never leaves the device: no network code here.
 */

export type BetChoice = 'yes' | 'no' | 'unsure'

export interface LlmExperiment {
  readonly id: string
  readonly presetId: string
  readonly modelName: string
  readonly promptA: string
  readonly promptB: string
  readonly bet: BetChoice | null
  readonly band: ChangeBand
  /** One plain-language line, as shown in the verdict, so the list reads without recomputing. */
  readonly summary: string
  readonly createdAt: string
}

class LlmLabDatabase extends Dexie {
  experiments!: EntityTable<LlmExperiment, 'id'>

  constructor() {
    super('ml4g-llm-lab')
    this.version(1).stores({ experiments: 'id, createdAt' })
  }
}

const database = new LlmLabDatabase()

/** Most recent first. Only the latest are shown, so the list stays readable on a phone. */
export const SHOWN_EXPERIMENTS = 10

export async function saveExperiment(experiment: Omit<LlmExperiment, 'id' | 'createdAt'>): Promise<LlmExperiment> {
  const record: LlmExperiment = { ...experiment, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
  await database.experiments.add(record)
  return record
}

export async function listExperiments(limit = SHOWN_EXPERIMENTS): Promise<LlmExperiment[]> {
  return database.experiments.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function deleteExperiment(id: string): Promise<void> {
  await database.experiments.delete(id)
}
