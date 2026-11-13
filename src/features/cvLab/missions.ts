/**
 * The Lab CV missions: a path through the tools and challenges, each with a task and a
 * question for thinking, like the Lab LLM's. The words live in `cvlab.json` under
 * `missions.items.<id>`. Progress is small and stays on this device, in localStorage.
 */

export interface CvMission {
  readonly id: string
  /** The tab «Ir a…» opens. */
  readonly target: 'tools' | 'challenges'
}

export const CV_MISSIONS: readonly CvMission[] = [
  { id: 'teach', target: 'tools' },
  { id: 'heatmap', target: 'tools' },
  { id: 'shortcut', target: 'challenges' },
  { id: 'imbalance', target: 'challenges' },
  { id: 'twoExplanations', target: 'tools' },
  { id: 'fool', target: 'tools' },
]

export interface CvMissionProgress {
  readonly done: boolean
  readonly reflection: string
}

const KEY = 'ml4g.cvMissions'

export function loadCvMissions(): Record<string, CvMissionProgress> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, CvMissionProgress>
  } catch {
    return {}
  }
}

export function saveCvMission(id: string, progress: CvMissionProgress): Record<string, CvMissionProgress> {
  const next = { ...loadCvMissions(), [id]: progress }
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}
