import { getSupabase } from '@/lib/supabase'
import type { Project } from '@/lib/db'

/**
 * T077 / FR-031, FR-032, Scenario 4.6 — reconciling the two halves of a project.
 *
 * A project exists in both stores, joined by a UUID the client generates
 * (data-model.md). The remote row holds a name and two counts; the local record
 * holds the substance — the photos, the embeddings, the trained weights — and
 * never leaves the device (Principle I).
 *
 * So there are exactly three states, and **only one of them is a problem**:
 *
 * | local | remote | meaning |
 * |---|---|---|
 * | yes | yes  | the capturing device. Everything restores (FR-031). |
 * | no  | yes  | a second device. Normal and expected (FR-032). |
 * | yes | no   | captured while signed out, or written before the network came back. |
 *
 * The second row is the one worth dwelling on: it is *not* an inconsistency to
 * repair. The obvious instinct — sync the samples down so the project looks the
 * same everywhere — is precisely what Principle I forbids, and it is why this
 * module explains the state instead of fixing it.
 *
 * The third is closed by pushing metadata on load, so a project made while signed
 * out but owned by an account becomes restorable without a separate sync step.
 */

export interface RemoteProject {
  readonly id: string
  readonly name: string
  readonly classCount: number
  readonly sampleCount: number
  readonly updatedAt: string
}

/**
 * The counts pushed for one project. Names and totals only — there is no column
 * anywhere that could hold an image or a weight, and this is the whole of what
 * crosses the boundary.
 */
export interface ProjectMetadata {
  readonly id: string
  readonly name: string
  readonly classCount: number
  readonly sampleCount: number
}

export async function fetchRemoteProjects(ownerId: string): Promise<readonly RemoteProject[]> {
  const supabase = await getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, class_count, sample_count, updated_at')
    .eq('owner_id', ownerId)
    .order('updated_at', { ascending: false })

  if (error || !data) return []

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    classCount: row.class_count,
    sampleCount: row.sample_count,
    updatedAt: row.updated_at,
  }))
}

/**
 * Writes the metadata for the projects on this device.
 *
 * Upserted in one call rather than one per project: a classroom of thirty on a
 * shared connection makes this the most frequent write in the product, and it is
 * pure metadata, so batching costs nothing in clarity.
 *
 * Failure is swallowed on purpose. An offline learner keeps full access to her
 * local projects (Edge Cases), so a refused write must not surface as an error on
 * a page whose contents are all local anyway.
 */
export async function pushProjectMetadata(
  ownerId: string,
  projects: readonly ProjectMetadata[],
): Promise<boolean> {
  const supabase = await getSupabase()
  if (!supabase || projects.length === 0) return false

  // Stamped by the client, because `updated_at` defaults to `now()` on insert only
  // and no trigger advances it. Left out, a project worked on for a month would
  // still be ordered by the day it was created.
  const now = new Date().toISOString()

  const { error } = await supabase.from('projects').upsert(
    projects.map((project) => ({
      id: project.id,
      owner_id: ownerId,
      name: project.name,
      class_count: project.classCount,
      sample_count: project.sampleCount,
      updated_at: now,
    })),
  )

  return !error
}

/**
 * The projects an account owns that this device has never held.
 *
 * Deliberately a pure function over two lists, with no store and no network, so
 * the FR-032 message can be tested without either.
 */
export function projectsMadeElsewhere(
  local: readonly Pick<Project, 'id'>[],
  remote: readonly RemoteProject[],
): readonly RemoteProject[] {
  const here = new Set(local.map((project) => project.id))
  return remote.filter((project) => !here.has(project.id))
}
