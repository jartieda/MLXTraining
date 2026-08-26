import { describe, it, expect } from 'vitest'
import {
  buildClassroomCsv,
  classroomCsvFileName,
  csvField,
  neutraliseFormula,
  CSV_COLUMNS,
  type ExportInput,
} from '@/features/classroom/export'

/**
 * T104 / FR-043, SC-021, SC-016 — the classroom export, against hostile input.
 *
 * The input here is hostile **by default and in good faith**: a 13-year-old writes a
 * reflection, it lands in a CSV, and her teacher opens it in Excel. So the fixture is
 * the one the Edge Cases section describes — a comma, a double quote, a line break and
 * a leading `=`, all in one answer — and the assertions are that every character
 * survives and that no cell can be read as a formula.
 *
 * A minimal RFC 4180 parser is included rather than assertions against the raw string.
 * Asserting on the serialised text is how a quoting bug passes: `"a""b"` and `"a""b"`
 * differ by one character and only one of them round-trips. Parsing back is the only
 * assertion that means "a spreadsheet will read what she wrote".
 */

/** The exact answer the Edge Cases section names. */
const HOSTILE = '=SUM(A1:A9), she said "maybe",\nand then -1 or @home'

/**
 * A minimal RFC 4180 reader: quoted fields, doubled quotes, embedded CRLF and commas.
 * Deliberately strict — it is standing in for a spreadsheet, so it must not be lenient
 * in ways a spreadsheet is not.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let index = 0

  while (index < text.length) {
    const char = text[index]

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        inQuotes = false
        index += 1
        continue
      }
      field += char
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = true
      index += 1
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      index += 1
      continue
    }
    if (char === '\r' && text[index + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      index += 2
      continue
    }
    field += char
    index += 1
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function input(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    classroomName: 'Tuesday club',
    roster: [
      { learnerId: 'l1', alias: 'Comet', isActive: true },
      { learnerId: 'l2', alias: 'Nimbus', isActive: true },
    ],
    progress: [
      {
        learnerId: 'l1',
        moduleId: 'what-the-model-sees',
        state: 'completed',
        completedSteps: ['read-the-goal', 'make-a-project'],
        updatedAt: '2026-01-01T10:00:00.000Z',
      },
    ],
    reflections: [
      {
        learnerId: 'l1',
        moduleId: 'what-the-model-sees',
        questionId: 'what-it-used',
        answer: HOSTILE,
        updatedAt: '2026-01-01T10:00:00.000Z',
      },
    ],
    runs: [
      {
        learnerId: 'l1',
        projectName: 'Shapes',
        finishedAt: '2026-01-01T10:00:00.000Z',
        overallAccuracy: 0.91,
        imbalanceRatio: 8,
        perClass: [],
      },
    ],
    moduleIds: ['what-the-model-sees', 'reading-a-heat-map'],
    ...overrides,
  }
}

describe('a hostile reflection survives intact (FR-043, SC-021)', () => {
  it('round-trips a comma, a double quote and a line break', () => {
    const rows = parseCsv(buildClassroomCsv(input()))
    const cell = rows.find((row) => row[0] === 'Comet' && row[5] === 'what-it-used')?.[6]

    // Every character she typed, with exactly one apostrophe added at the front —
    // which is the whole of the trade-off this export makes.
    expect(cell).toBe(`'${HOSTILE}`)
    expect(cell).toContain(',')
    expect(cell).toContain('"maybe"')
    expect(cell).toContain('\n')
  })

  it('does not shred the row, so the columns after the reflection still line up', () => {
    const rows = parseCsv(buildClassroomCsv(input()))
    // The failure this catches: an unquoted comma splits the field and every later
    // column shifts left, silently, for that learner only.
    for (const row of rows) {
      expect(row).toHaveLength(CSV_COLUMNS.length)
    }
    const cometRow = rows.find((row) => row[0] === 'Comet' && row[5] === 'what-it-used')
    expect(cometRow?.at(-1)).toBe('yes')
    expect(cometRow?.at(-3)).toBe('91')
  })

  it('the answer is recoverable exactly by stripping one leading apostrophe', () => {
    const rows = parseCsv(buildClassroomCsv(input()))
    const cell = rows.find((row) => row[5] === 'what-it-used')?.[6] ?? ''
    // The reversibility is what makes "nothing is lost" a true claim rather than a
    // hopeful one: an educator or a script can get the original back.
    expect(cell.replace(/^'/, '')).toBe(HOSTILE)
  })
})

describe('no cell can be read as a formula', () => {
  for (const starter of ['=', '+', '-', '@', '\t', '\r']) {
    it(`neutralises a leading ${JSON.stringify(starter)}`, () => {
      expect(neutraliseFormula(`${starter}1+1`)).toBe(`'${starter}1+1`)
    })
  }

  it('leaves ordinary text completely alone', () => {
    // Over-eager neutralisation would put an apostrophe on every answer in the file.
    for (const text of ['It used the background.', '1+1 is two', 'a=b', '', 'Sofía']) {
      expect(neutraliseFormula(text)).toBe(text)
    }
  })

  it('applies to every column, not only the reflection', () => {
    // A class name and a project name are learner text too. Restricting this to the
    // column that obviously carries free text is how the next one gets missed.
    const csv = buildClassroomCsv(
      input({ roster: [{ learnerId: 'l1', alias: '=cmd|calc', isActive: true }] }),
    )
    expect(parseCsv(csv)[1]?.[0]).toBe("'=cmd|calc")
  })

  it('neutralises before quoting, so the apostrophe is inside the quoted field', () => {
    // The other order produces `'"=1+1"`, where the apostrophe is outside the field
    // and the cell still starts with `=`.
    expect(csvField('=1+1')).toBe('"\'=1+1"')
  })
})

describe('one row per learner and module (FR-043)', () => {
  it('emits a row for every learner and every module, including untouched ones', () => {
    const rows = parseCsv(buildClassroomCsv(input()))
    const body = rows.slice(1)

    // Two learners × two modules, and Comet's module 1 has one answer, so four rows.
    expect(body).toHaveLength(4)
    expect(body.filter((row) => row[0] === 'Comet')).toHaveLength(2)
    expect(body.filter((row) => row[0] === 'Nimbus')).toHaveLength(2)
  })

  it('gives a module she never started an empty reflection rather than no row', () => {
    const rows = parseCsv(buildClassroomCsv(input()))
    const untouched = rows.find((row) => row[0] === 'Nimbus' && row[1] === 'reading-a-heat-map')

    // An educator scanning for gaps must see the gap, not have to notice a row is
    // absent — which is a much harder thing to see.
    expect(untouched?.[2]).toBe('not_started')
    expect(untouched?.[6]).toBe('')
  })

  it('gives each of three answers to one module its own row', () => {
    const rows = parseCsv(
      buildClassroomCsv(
        input({
          reflections: ['a', 'b', 'c'].map((questionId) => ({
            learnerId: 'l1',
            moduleId: 'what-the-model-sees',
            questionId,
            answer: `answer ${questionId}`,
            updatedAt: '2026-01-01T10:00:00.000Z',
          })),
        }),
      ),
    )
    const cometModule1 = rows.filter(
      (row) => row[0] === 'Comet' && row[1] === 'what-the-model-sees',
    )
    // Three rows rather than a `reflection_2` column most rows leave empty.
    expect(cometModule1).toHaveLength(3)
    expect(cometModule1.map((row) => row[5])).toEqual(['a', 'b', 'c'])
  })

  it('starts with a header naming every column', () => {
    const rows = parseCsv(buildClassroomCsv(input()))
    expect(rows[0]).toEqual([...CSV_COLUMNS])
  })

  it('uses CRLF row separators and terminates the last row', () => {
    const csv = buildClassroomCsv(input())
    // RFC 4180. A lone LF is mangled by older Excel builds on Windows, which is
    // precisely the environment a school runs.
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.split('\r\n').length).toBeGreaterThan(4)
  })
})

describe('the export identifies learners by alias only (SC-016)', () => {
  it('contains no username, no email address and no learner id', () => {
    const csv = buildClassroomCsv(input())

    // The file is a thing she may email to a colleague or leave on a shared drive.
    // It must not be the place a username escapes.
    expect(csv).not.toContain('learner-l1')
    expect(csv).not.toContain('l1')
    expect(csv).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i)
    expect(csv).toContain('Comet')
  })

  it('has no column that could hold an identifier', () => {
    // Structural rather than content-based: a column named `username` would be
    // filled by the next person to touch this file.
    for (const column of CSV_COLUMNS) {
      expect(column).not.toMatch(/username|email|learner_id|real_name|dob/)
    }
  })

  it('has no column that could hold an image (FR-041)', () => {
    for (const column of CSV_COLUMNS) {
      expect(column).not.toMatch(/image|photo|sample|thumbnail|blob|weights/)
    }
  })
})

describe('the file name', () => {
  it('carries the classroom and the day', () => {
    expect(classroomCsvFileName('Tuesday club', '2026-03-04T10:00:00.000Z')).toBe(
      'Tuesday-club-progress-2026-03-04.csv',
    )
  })

  it('keeps accented names and strips path separators', () => {
    // NFC, not NFKD: NFKD would decompose the accent into a combining mark that the
    // `\p{L}` filter then strips, quietly turning "Sofía" into "Sofia" in a product
    // whose second locale is Spanish.
    expect(classroomCsvFileName('Sofía B', '2026-03-04T00:00:00.000Z')).toBe(
      'Sofía-B-progress-2026-03-04.csv',
    )
    expect(classroomCsvFileName('3º B', '2026-03-04T00:00:00.000Z')).toBe('3º-B-progress-2026-03-04.csv')
    expect(classroomCsvFileName('../etc', '2026-03-04T00:00:00.000Z')).toBe(
      'etc-progress-2026-03-04.csv',
    )
  })

  it('falls back rather than producing a nameless file', () => {
    expect(classroomCsvFileName('???', '2026-03-04T00:00:00.000Z')).toBe(
      'classroom-progress-2026-03-04.csv',
    )
  })
})
