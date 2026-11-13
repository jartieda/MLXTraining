import * as db from '@/lib/db'
import type { LoadedBackbone } from '@/ml/backbone'
import { decodeImage } from '@/features/capture/imageCrop'

/**
 * The Lab CV challenges: prepared photo sets, each with a trap hidden in the data
 * (the classic is «husky o lobo», where every wolf is photographed on snow). The
 * structure lives here; the words in `cvlab.json` under `challenges.items.<id>`.
 *
 * The photos are not bundled in the code. Each challenge reads
 * `public/datasets/<id>/manifest.json`, which lists the files per class plus a few test
 * photos (see public/datasets/README.md). Until somebody places the photos there, the
 * challenge says so instead of failing.
 */

export interface CvChallenge {
  readonly id: string
  /** Class ids, in order; the names come from the locale. */
  readonly classes: readonly string[]
}

export const CV_CHALLENGES: readonly CvChallenge[] = [
  { id: 'huskyWolf', classes: ['husky', 'wolf'] },
  { id: 'fewCats', classes: ['dog', 'cat'] },
  { id: 'orangeBall', classes: ['orange', 'ball'] },
]

export interface ChallengeManifest {
  /** Training photos per class id, paths relative to the challenge folder. */
  readonly classes: Readonly<Record<string, readonly string[]>>
  /** Photos to explain after training: the ones where the trap shows. */
  readonly test?: readonly { readonly file: string; readonly label?: string }[]
}

export function datasetUrl(challengeId: string, file = ''): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/datasets/${challengeId}/${file}`
}

/** The manifest, or `null` when the photos are not in place yet. */
export async function fetchManifest(challengeId: string): Promise<ChallengeManifest | null> {
  try {
    const response = await fetch(datasetUrl(challengeId, 'manifest.json'))
    if (!response.ok) return null
    const manifest = (await response.json()) as ChallengeManifest
    const total = Object.values(manifest.classes).reduce((sum, files) => sum + files.length, 0)
    return total > 0 ? manifest : null
  } catch {
    return null
  }
}

// ── Which project came from which challenge (on this device) ───────────────

const ORIGIN_KEY = 'ml4g.cvChallengeProjects'

function readOrigins(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(ORIGIN_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

export function challengeOfProject(projectId: string): string | null {
  return readOrigins()[projectId] ?? null
}

function rememberOrigin(projectId: string, challengeId: string) {
  localStorage.setItem(ORIGIN_KEY, JSON.stringify({ ...readOrigins(), [projectId]: challengeId }))
}

// ── Loading a challenge into a new project ─────────────────────────────────

export interface LoadProgress {
  readonly done: number
  readonly total: number
}

export interface LoadedChallenge {
  readonly projectId: string
  readonly added: number
  readonly failed: number
}

/**
 * Create a project with the challenge's classes and photos. Every photo goes through
 * the same crop and the same backbone embedding as an upload, so training and the heat
 * maps treat it exactly like a learner's own picture.
 */
export async function loadChallenge(
  challenge: CvChallenge,
  manifest: ChallengeManifest,
  names: { readonly project: string; readonly classes: Readonly<Record<string, string>> },
  backbone: LoadedBackbone,
  ownerId: string | null,
  onProgress: (progress: LoadProgress) => void,
): Promise<LoadedChallenge> {
  const project = await db.createProject(names.project, ownerId)
  rememberOrigin(project.id, challenge.id)

  const jobs: { classId: string; file: string }[] = []
  for (const classKey of challenge.classes) {
    const created = await db.addClass(project.id, names.classes[classKey] ?? classKey)
    for (const file of manifest.classes[classKey] ?? []) jobs.push({ classId: created.id, file })
  }

  let added = 0
  let failed = 0
  for (const [index, job] of jobs.entries()) {
    try {
      const response = await fetch(datasetUrl(challenge.id, job.file))
      if (!response.ok) throw new Error(String(response.status))
      const decoded = await decodeImage(await response.blob())
      if (!decoded) throw new Error('decode')
      const blob = await new Promise<Blob | null>((resolve) => {
        decoded.canvas.toBlob(resolve, 'image/jpeg', 0.8)
      })
      if (!blob) throw new Error('encode')
      const embedding = await backbone.embed(decoded.image)
      const result = await db.addSampleBurst([
        { projectId: project.id, classId: job.classId, image: blob, embedding, embeddingAlpha: backbone.alpha, source: 'upload' },
      ])
      if (result.stoppedByQuota) break
      added += result.saved
    } catch {
      failed++
    }
    onProgress({ done: index + 1, total: jobs.length })
  }
  return { projectId: project.id, added, failed }
}
