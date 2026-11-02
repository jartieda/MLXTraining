import { llmLabDatabase, type LlmExperiment, type LlmMissionProgress, type LlmProjectCard } from '../compare/experimentStore'

/**
 * The missions of the Lab LLM: a path through the tools of the page, each with a
 * challenge and a question for thinking. Structure lives here; every word the learner
 * reads lives in `llm.json` under `missions.items.<id>`.
 */

/** Where «Ir a la herramienta» takes the learner. */
export interface MissionTarget {
  readonly tab: 'explore' | 'compare'
  /** A comparator preset to select on arrival. */
  readonly presetId?: string
  /** Id of the element to scroll to on arrival. */
  readonly anchor?: string
}

export interface Mission {
  readonly id: string
  readonly target: MissionTarget | null
}

export const MISSIONS: readonly Mission[] = [
  { id: 'nextWord', target: { tab: 'explore', anchor: 'llm-next-word' } },
  { id: 'oneChange', target: { tab: 'compare', presetId: 'promptTone', anchor: 'llm-compare' } },
  { id: 'lens', target: { tab: 'compare', anchor: 'llm-word-lens' } },
  { id: 'selfReport', target: { tab: 'compare', anchor: 'llm-word-lens' } },
  { id: 'name', target: { tab: 'compare', presetId: 'biasName', anchor: 'llm-compare' } },
  { id: 'invented', target: { tab: 'compare', presetId: 'falsePremise', anchor: 'llm-compare' } },
  { id: 'projectCard', target: null },
]

export const PROJECT_CARD_MISSION = 'projectCard'

export type ProjectCardFields = Pick<LlmProjectCard, 'decides' | 'affects' | 'biasTested' | 'explanation'>

export const PROJECT_CARD_FIELDS = ['decides', 'affects', 'biasTested', 'explanation'] as const

export const EMPTY_PROJECT_CARD: ProjectCardFields = { decides: '', affects: '', biasTested: '', explanation: '' }

export function isCardComplete(card: ProjectCardFields): boolean {
  return PROJECT_CARD_FIELDS.every((field) => card[field].trim().length > 0)
}

// ── Storage (on the device only) ───────────────────────────────────────────

export async function loadMissionProgress(): Promise<Record<string, LlmMissionProgress>> {
  const rows = await llmLabDatabase.missions.toArray()
  return Object.fromEntries(rows.map((row) => [row.id, row]))
}

export async function saveMissionProgress(id: string, change: Partial<Pick<LlmMissionProgress, 'done' | 'reflection'>>): Promise<LlmMissionProgress> {
  // Read and write in one transaction: leaving the answer box and ticking the box fire
  // two saves at almost the same time, and the second must see the first.
  return llmLabDatabase.transaction('rw', llmLabDatabase.missions, async () => {
    const current = await llmLabDatabase.missions.get(id)
    const record: LlmMissionProgress = {
      id,
      done: change.done ?? current?.done ?? false,
      reflection: change.reflection ?? current?.reflection ?? '',
      updatedAt: new Date().toISOString(),
    }
    await llmLabDatabase.missions.put(record)
    return record
  })
}

export async function loadProjectCard(): Promise<ProjectCardFields> {
  const card = await llmLabDatabase.projectCard.get('current')
  if (!card) return EMPTY_PROJECT_CARD
  return { decides: card.decides, affects: card.affects, biasTested: card.biasTested, explanation: card.explanation }
}

export async function saveProjectCard(fields: ProjectCardFields): Promise<void> {
  await llmLabDatabase.projectCard.put({ id: 'current', ...fields, updatedAt: new Date().toISOString() })
}

// ── The downloadable card ──────────────────────────────────────────────────

export interface ProjectCardText {
  readonly title: string
  readonly date: string
  readonly fields: readonly { readonly label: string; readonly value: string }[]
  readonly reflectionsHeading: string
  readonly reflections: readonly { readonly mission: string; readonly question: string; readonly answer: string }[]
  readonly experimentsHeading: string
  readonly experiments: readonly LlmExperiment[]
  readonly experimentLine: (experiment: LlmExperiment) => string
  readonly empty: string
  readonly footer: string
}

/** The card as Markdown: readable as plain text, and it opens well in any editor. */
export function buildProjectCardMarkdown(card: ProjectCardText): string {
  const answerOrEmpty = (value: string) => (value.trim().length > 0 ? value.trim() : `_${card.empty}_`)
  const lines = [`# ${card.title}`, '', card.date, '']
  for (const field of card.fields) lines.push(`## ${field.label}`, '', answerOrEmpty(field.value), '')

  lines.push(`## ${card.reflectionsHeading}`, '')
  const answered = card.reflections.filter((item) => item.answer.trim().length > 0)
  if (answered.length === 0) lines.push(`_${card.empty}_`, '')
  for (const item of answered) lines.push(`**${item.mission}.** ${item.question}`, '', item.answer.trim(), '')

  lines.push(`## ${card.experimentsHeading}`, '')
  if (card.experiments.length === 0) lines.push(`_${card.empty}_`, '')
  for (const experiment of card.experiments) lines.push(`- ${card.experimentLine(experiment)}`)
  if (card.experiments.length > 0) lines.push('')

  lines.push('---', '', card.footer, '')
  return lines.join('\n')
}
