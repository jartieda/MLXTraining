import type { LearnerProgress, LearnerReflection, LearnerRun, RosterEntry } from './api'

/**
 * T110 / FR-043, SC-021, SC-016 — the classroom progress export.
 *
 * **This is the one export path where the input is hostile by default**, and not
 * because anyone is attacking anything. A 13-year-old writes a reflection; it lands in
 * a CSV; her teacher opens it in Excel. If the answer begins with `=`, Excel runs it.
 * That is a formula-injection sink whose payload was written by a child in good faith,
 * which is exactly why it cannot be left to review (Edge Cases).
 *
 * Two protections, and they are independent:
 *
 * 1. **Quoting**, per RFC 4180: every field is wrapped in double quotes and every
 *    embedded quote is doubled. That is what makes a comma, a quote and a line break
 *    inside a reflection survive as text rather than shredding the row.
 * 2. **Formula neutralisation**: a field whose first character is `=`, `+`, `-`, `@`,
 *    a tab or a carriage return is prefixed with a single apostrophe.
 *
 * The apostrophe is a real trade-off and worth stating plainly: it **adds** one
 * character that the learner did not type. There is no way to both preserve the bytes
 * exactly and prevent interpretation, because interpretation is decided by the first
 * character — so the choice is between a visible apostrophe and a spreadsheet that
 * evaluates `=1+1` or, worse, `=HYPERLINK(...)`. Nothing is lost, one thing is added,
 * and the export dialogue says so.
 *
 * **Aliases only** (SC-016, FR-043). No username, no email address, and no learner id
 * that could be joined back to one. An educator knows the usernames she issued; the
 * file is a thing she may email to a colleague or leave on a shared drive, and it must
 * not be the place a username escapes.
 */

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_STARTERS = ['=', '+', '-', '@', '\t', '\r']

/**
 * Neutralises a leading formula character.
 *
 * Applied to **every** field, not just the reflection column. A class name is learner
 * text too, and so is a project name — restricting this to the column that "obviously"
 * carries free text is how the next column to carry free text gets missed.
 */
export function neutraliseFormula(value: string): string {
  if (value.length === 0) return value
  return FORMULA_STARTERS.includes(value[0] ?? '') ? `'${value}` : value
}

/** RFC 4180: wrap in quotes, double any embedded quote. */
export function csvField(value: string): string {
  return `"${neutraliseFormula(value).replaceAll('"', '""')}"`
}

export function csvRow(fields: readonly string[]): string {
  return fields.map(csvField).join(',')
}

export const CSV_COLUMNS = [
  'alias',
  'module',
  'state',
  'steps_completed',
  'progress_updated',
  'question',
  'reflection',
  'best_accuracy',
  'runs_recorded',
  'imbalance_flagged',
] as const

export interface ExportInput {
  readonly classroomName: string
  readonly roster: readonly RosterEntry[]
  readonly progress: readonly LearnerProgress[]
  readonly reflections: readonly LearnerReflection[]
  readonly runs: readonly LearnerRun[]
  /** Every module id, so a learner who has started nothing still appears. */
  readonly moduleIds: readonly string[]
}

/**
 * One row per learner and module (FR-043), and per reflection question within that.
 *
 * A learner with three answers to one module's three questions gets three rows, which
 * is the only shape that puts each answer in its own cell without inventing a
 * `reflection_2` column that most rows leave empty. A module she has not touched still
 * gets one row with an empty reflection, so an educator scanning for gaps sees the gap
 * rather than an absent row she has to notice is absent.
 */
export function buildClassroomCsv(input: ExportInput): string {
  const lines: string[] = [csvRow([...CSV_COLUMNS])]

  const progressByLearner = new Map<string, Map<string, LearnerProgress>>()
  for (const entry of input.progress) {
    const forLearner =
      progressByLearner.get(entry.learnerId) ?? new Map<string, LearnerProgress>()
    forLearner.set(entry.moduleId, entry)
    progressByLearner.set(entry.learnerId, forLearner)
  }

  const reflectionsByLearnerModule = new Map<string, LearnerReflection[]>()
  for (const entry of input.reflections) {
    const key = `${entry.learnerId}|${entry.moduleId}`
    reflectionsByLearnerModule.set(key, [...(reflectionsByLearnerModule.get(key) ?? []), entry])
  }

  const runsByLearner = new Map<string, LearnerRun[]>()
  for (const run of input.runs) {
    runsByLearner.set(run.learnerId, [...(runsByLearner.get(run.learnerId) ?? []), run])
  }

  for (const learner of input.roster) {
    const runs = runsByLearner.get(learner.learnerId) ?? []
    const bestAccuracy =
      runs.length === 0 ? '' : String(Math.round(Math.max(...runs.map((r) => r.overallAccuracy)) * 100))
    const imbalanceFlagged = runs.some(
      (run) => run.imbalanceRatio !== null && run.imbalanceRatio >= 2,
    )

    for (const moduleId of input.moduleIds) {
      const progress = progressByLearner.get(learner.learnerId)?.get(moduleId)
      const answers = reflectionsByLearnerModule.get(`${learner.learnerId}|${moduleId}`) ?? []

      const base = [
        // The alias, and no other identifier. This is SC-016 in one line.
        learner.alias,
        moduleId,
        progress?.state ?? 'not_started',
        String(progress?.completedSteps.length ?? 0),
        progress?.updatedAt ?? '',
      ]
      const tail = [bestAccuracy, String(runs.length), imbalanceFlagged ? 'yes' : 'no']

      if (answers.length === 0) {
        lines.push(csvRow([...base, '', '', ...tail]))
        continue
      }

      for (const answer of answers) {
        lines.push(csvRow([...base, answer.questionId, answer.answer, ...tail]))
      }
    }
  }

  // CRLF per RFC 4180, and a trailing one so the last row is terminated. A lone LF is
  // tolerated by most tools and mangled by some older Excel builds on Windows, which
  // is precisely the environment a school runs.
  return `${lines.join('\r\n')}\r\n`
}

/**
 * The file, as a Blob with a UTF-8 byte-order mark.
 *
 * The BOM is what makes Excel on Windows read the file as UTF-8 rather than as the
 * system code page. Without it, a Spanish classroom's aliases and reflections open as
 * mojibake — "Sofía" becomes "SofÃ­a" — and the educator reasonably concludes the
 * export is broken.
 */
export function classroomCsvBlob(csv: string): Blob {
  // \ufeff written as an escape, not as a literal: an invisible character in
  // source is one nobody can review, and the lint rule is right to refuse it.
  return new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })
}

export function classroomCsvFileName(classroomName: string, isoDate: string): string {
  const cleaned = classroomName
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
  const day = isoDate.slice(0, 10)
  return `${cleaned.length > 0 ? cleaned : 'classroom'}-progress-${day}.csv`
}
