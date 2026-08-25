/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, setupI18n } from '../helpers/render'
import { ConfusionMatrix } from '@/features/results/ConfusionMatrix'
import { ImbalanceNotice } from '@/features/results/ImbalanceNotice'
import { ClassBalance } from '@/features/results/ClassBalance'
import { RunComparison } from '@/features/results/RunComparison'
import { compareRuns, mostConfusedPair, safeFileName } from '@/features/results/analysis'
import { evaluate, IMBALANCE_THRESHOLD } from '@/ml/metrics'
import type { ModelRecord, RunClassMetric } from '@/lib/db'
import type { TrainedModel } from '@/ml/train'

/**
 * T081 / US7 — FR-009, FR-020, FR-021, Scenario 7.1 and 7.2.
 *
 * The three properties worth defending, in order of how badly a regression hurts:
 *
 * 1. **Matrix orientation: rows are the true class.** A transposed matrix still
 *    looks like a confusion matrix and reverses every conclusion a learner draws
 *    from it. Nothing about the rendering looks wrong when it happens, which is why
 *    it is asserted here against a deliberately asymmetric matrix — a symmetric
 *    fixture would pass either way and prove nothing.
 * 2. **The imbalance notice appears AND the model is still usable.** FR-009 permits
 *    training on imbalanced classes and the fairness lesson is built on a learner
 *    doing it deliberately, so a notice that read as a failure — or a guard that
 *    blocked the run — would delete a module from the curriculum.
 * 3. **Per-class figures are per class.** A single overall accuracy hides exactly
 *    the finding US7 exists to surface.
 */

/** 40 photos of "Many", 5 of "Few". The skew the fairness lesson is built on. */
const SKEWED: readonly RunClassMetric[] = [
  { classId: 'c-many', className: 'Many', sampleCount: 40, accuracy: 1 },
  { classId: 'c-few', className: 'Few', sampleCount: 5, accuracy: 0.2 },
]

/**
 * Deliberately asymmetric: 4 of the 5 "Few" photos were called "Many", and none of
 * the "Many" photos were called "Few". Transposing this changes what it says, which
 * is exactly the property the orientation test needs.
 */
const SKEWED_CONFUSION: readonly (readonly number[])[] = [
  [40, 0],
  [4, 1],
]

/**
 * The data row for a class, found by its row header.
 *
 * Not `getByRole('row', { name })`: a row's accessible name includes every cell in
 * it, so the header row — which lists every class name as a column heading —
 * matches any class name too. Only body rows have a `rowheader`.
 */
function bodyRow(className: string): HTMLElement {
  const row = screen
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryByRole('rowheader')?.textContent === className)
  if (!row) throw new Error(`No confusion-matrix row for "${className}"`)
  return row
}

beforeEach(async () => {
  await setupI18n('en')
})

describe('confusion matrix orientation (FR-020)', () => {
  it('puts the TRUE class in rows and the PREDICTED class in columns', () => {
    renderWithProviders(<ConfusionMatrix perClass={SKEWED} confusion={SKEWED_CONFUSION} />)

    // The "Few" row must read 4 then 1 — four of her five Few photos were called
    // Many. Transposed, the same numbers would appear in the "Many" row and the
    // learner would conclude the opposite.
    const cells = within(bodyRow('Few')).getAllByRole('cell')
    expect(cells).toHaveLength(2)
    expect(cells[0]).toHaveTextContent('4')
    expect(cells[1]).toHaveTextContent('1')

    const manyCells = within(bodyRow('Many')).getAllByRole('cell')
    expect(manyCells[0]).toHaveTextContent('40')
    expect(manyCells[1]).toHaveTextContent('0')
  })

  it('states the orientation in words, not only in the layout', () => {
    renderWithProviders(<ConfusionMatrix perClass={SKEWED} confusion={SKEWED_CONFUSION} />)
    // A learner cannot infer the orientation from a grid of numbers, and getting it
    // backwards is the single most likely misreading of this view.
    expect(screen.getByText(/rows are the class the photo really belongs to/i)).toBeInTheDocument()
  })

  it('gives every cell an accessible name naming BOTH classes', () => {
    renderWithProviders(<ConfusionMatrix perClass={SKEWED} confusion={SKEWED_CONFUSION} />)
    // "4" read out of a grid a screen-reader user cannot see is meaningless.
    expect(
      screen.getByText(/4 photos, 80% of the Few photos, were called Many/i),
    ).toBeInTheDocument()
  })

  it('shades by row share, so a small class is as readable as a big one', () => {
    renderWithProviders(<ConfusionMatrix perClass={SKEWED} confusion={SKEWED_CONFUSION} />)

    const fewCells = within(bodyRow('Few')).getAllByRole('cell')
    const manyCells = within(bodyRow('Many')).getAllByRole('cell')

    // 4/5 = 80% and 40/40 = 100%: both hot. Shaded by raw count instead, the Few
    // row's 4 would be almost the coldest cell in the table and the whole finding
    // would be invisible.
    expect(fewCells[0]?.getAttribute('style')).toContain('background-color')
    expect(fewCells[0]?.getAttribute('style')).not.toEqual(
      // 80% and 20% must not render the same colour.
      fewCells[1]?.getAttribute('style'),
    )
    expect(manyCells[1]?.getAttribute('style')).toContain('background-color')
  })

  it('renders nothing at all when there are no classes', () => {
    const { container } = renderWithProviders(<ConfusionMatrix perClass={[]} confusion={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('imbalance is reported and never blocks (FR-009, FR-021, Scenario 7.2)', () => {
  it('names both classes, the ratio, and the likely effect', () => {
    renderWithProviders(
      <ImbalanceNotice perClass={SKEWED} confusion={SKEWED_CONFUSION} imbalanceRatio={8} />,
    )

    const notice = screen.getByTestId('imbalance-notice')
    expect(notice).toHaveTextContent(/40 photos of Many and only 5 of Few/i)
    expect(notice).toHaveTextContent(/8\.0 times as many/i)
    // FR-021 asks for the likely EFFECT, not just the ratio. A number alone is
    // something a 12-year-old has no way to interpret.
    expect(notice).toHaveTextContent(/guessing Many is usually a safe bet/i)
    expect(notice).toHaveTextContent(/poor at Few in particular/i)
  })

  it('says explicitly that the model is trained and testable right now', () => {
    renderWithProviders(
      <ImbalanceNotice perClass={SKEWED} confusion={SKEWED_CONFUSION} imbalanceRatio={8} />,
    )
    // Scenario 7.2. Without this sentence a warning next to a result reads as
    // "this result is void", and she stops before the lesson can happen.
    expect(screen.getByTestId('imbalance-notice')).toHaveTextContent(
      /trained and you can test it right now/i,
    )
  })

  it('is a status rather than an alert, because a skewed run is a teaching point', () => {
    renderWithProviders(
      <ImbalanceNotice perClass={SKEWED} confusion={SKEWED_CONFUSION} imbalanceRatio={8} />,
    )
    // `role="alert"` would interrupt a screen-reader user to announce something
    // she may well have done on purpose.
    expect(screen.getByTestId('imbalance-notice')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('points at the lesson, but after the explanation rather than before it', () => {
    renderWithProviders(
      <ImbalanceNotice perClass={SKEWED} confusion={SKEWED_CONFUSION} imbalanceRatio={8} />,
    )
    const notice = screen.getByTestId('imbalance-notice')
    const link = within(notice).getByRole('link', { name: /why this happens/i })
    expect(link).toHaveAttribute('href', '/lessons/fairness')

    const text = notice.textContent ?? ''
    expect(text.indexOf('safe bet')).toBeLessThan(text.indexOf('why this happens'))
  })

  it('exposes no control that could prevent or delay training', () => {
    renderWithProviders(
      <ImbalanceNotice perClass={SKEWED} confusion={SKEWED_CONFUSION} imbalanceRatio={8} />,
    )
    // The regression this guards against is a well-meaning "Fix the balance first"
    // button, which would read as a precondition and stop the lesson happening.
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('stays silent below the threshold, so the notice keeps meaning something', () => {
    renderWithProviders(
      <ImbalanceNotice
        perClass={SKEWED}
        confusion={SKEWED_CONFUSION}
        imbalanceRatio={IMBALANCE_THRESHOLD - 0.1}
      />,
    )
    expect(screen.queryByTestId('imbalance-notice')).toBeNull()
  })

  it('stays silent when the ratio is unknown rather than printing a placeholder', () => {
    // `null` is what an empty class produces — `Infinity` is not storable. Printing
    // "∞ times as many" next to real figures destroys trust in all of them.
    renderWithProviders(
      <ImbalanceNotice perClass={SKEWED} confusion={SKEWED_CONFUSION} imbalanceRatio={null} />,
    )
    expect(screen.queryByTestId('imbalance-notice')).toBeNull()
  })
})

describe('per-class sample counts (FR-020)', () => {
  it('shows a count for every class, and the total', () => {
    renderWithProviders(
      <ClassBalance
        counts={[
          { classId: 'a', className: 'Many', sampleCount: 40 },
          { classId: 'b', className: 'Few', sampleCount: 5 },
        ]}
      />,
    )
    expect(screen.getByText(/45 photos altogether/i)).toBeInTheDocument()
    // `Meter` reports a whole percentage, 0-100.
    expect(screen.getByRole('meter', { name: 'Many' })).toHaveAttribute('aria-valuenow', '100')
    // Scaled to the largest class, not to the total: 5/40 = 13%, not 5/45 = 11%.
    expect(screen.getByRole('meter', { name: 'Few' })).toHaveAttribute('aria-valuenow', '13')
  })

  it('renders before training, which is when more photographs are still possible', () => {
    // No evaluation, no model — just counts. This is the placement decision that
    // makes FR-021 actionable rather than a post-mortem.
    renderWithProviders(
      <ClassBalance counts={[{ classId: 'a', className: 'Empty', sampleCount: 0 }]} />,
    )
    expect(screen.getByText(/0 photos altogether/i)).toBeInTheDocument()
  })
})

describe('the figures come from the ML core unchanged (FR-020)', () => {
  it('reports per-class accuracy that matches evaluate()', () => {
    // A stub model that always predicts class 0. Against 3 samples of class 0 and 2
    // of class 1 it must score 100% and 0%, and the confusion must put the two
    // class-1 samples in row 1, column 0 — the orientation the view depends on.
    const model = {
      classCount: 2,
      embeddingSize: 1,
      predictFromEmbedding: () => [
        { classIndex: 0, probability: 0.9 },
        { classIndex: 1, probability: 0.1 },
      ],
    } as unknown as TrainedModel

    const result = evaluate(
      model,
      new Float32Array([1, 1, 1, 1, 1]),
      new Uint8Array([0, 0, 0, 1, 1]),
      2,
      1,
    )

    expect(result.perClass.map((entry) => entry.accuracy)).toEqual([1, 0])
    expect(result.confusion).toEqual([
      [3, 0],
      [2, 0],
    ])
    expect(result.imbalanceRatio).toBeCloseTo(1.5)
    expect(result.imbalanced).toBe(false)
  })
})

describe('run comparison (T087, FR-010, Scenario 7.3)', () => {
  function run(id: string, finishedAt: string, perClass: readonly RunClassMetric[]): ModelRecord {
    return {
      runId: id,
      projectId: 'p1',
      artifactKey: id,
      classOrder: perClass.map((entry) => entry.classId),
      status: 'ready',
      savedAt: finishedAt,
      metrics: {
        perClass,
        confusion: perClass.map((_, index) => perClass.map((__, j) => (index === j ? 1 : 0))),
        overallAccuracy: perClass.reduce((sum, e) => sum + e.accuracy, 0) / perClass.length,
        imbalanceRatio: 1,
        backboneAlpha: 0.5,
        epochs: 20,
        finishedAt,
      },
    }
  }

  const skewed = run('r1', '2026-01-01T10:00:00.000Z', SKEWED)
  const rebalanced = run('r2', '2026-01-01T11:00:00.000Z', [
    { classId: 'c-many', className: 'Many', sampleCount: 40, accuracy: 0.95 },
    { classId: 'c-few', className: 'Few', sampleCount: 38, accuracy: 0.9 },
  ])

  it('says which classes changed, by name', () => {
    renderWithProviders(<RunComparison runs={[rebalanced, skewed]} />)

    expect(screen.getByTestId('comparison-overall')).toHaveTextContent(/from 60% to 93%/i)
    // The requirement is "which classes changed", and a name is the answer. Both
    // moved here: Few by +70 points, Many by −5.
    const summary = screen.getByTestId('comparison-summary')
    expect(summary).toHaveTextContent(/Many/)
    expect(summary).toHaveTextContent(/Few/)
  })

  it('marks direction as a word, so it is not an unlabelled arrow', () => {
    renderWithProviders(<RunComparison runs={[rebalanced, skewed]} />)
    expect(screen.getAllByTestId('delta-better').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('delta-worse').length).toBeGreaterThan(0)
  })

  it('shows the sample counts beside the accuracies, so the change has a visible cause', () => {
    renderWithProviders(<RunComparison runs={[rebalanced, skewed]} />)
    // "Few got better" is a fact; "Few went from 5 photos to 38" is the reason.
    expect(screen.getByText('20% of 5')).toBeInTheDocument()
    expect(screen.getByText('90% of 38')).toBeInTheDocument()
  })

  it('explains where the comparison will appear when only one run exists', () => {
    renderWithProviders(<RunComparison runs={[skewed]} />)
    expect(screen.getByText(/train a second time/i)).toBeInTheDocument()
  })

  it('lets her pick which two runs to compare', async () => {
    const user = userEvent.setup()
    const third = run('r3', '2026-01-01T12:00:00.000Z', SKEWED)
    renderWithProviders(<RunComparison runs={[third, rebalanced, skewed]} />)

    await user.selectOptions(screen.getByLabelText(/earlier run/i), 'r3')
    expect(screen.getByText(/those are the same run/i)).toBeInTheDocument()
  })
})

describe('comparison matching rules (T087)', () => {
  const before: readonly RunClassMetric[] = [
    { classId: 'a', className: 'Cats', sampleCount: 10, accuracy: 0.5 },
    { classId: 'b', className: 'Dogs', sampleCount: 10, accuracy: 0.5 },
  ]

  it('matches by id, so an inserted class does not shift every comparison', () => {
    // "Birds" is inserted FIRST, shifting Cats and Dogs by one index. Positional
    // matching would compare Cats against Birds and report nonsense confidently.
    const after: readonly RunClassMetric[] = [
      { classId: 'c', className: 'Birds', sampleCount: 10, accuracy: 0.9 },
      { classId: 'a', className: 'Cats', sampleCount: 10, accuracy: 0.5 },
      { classId: 'b', className: 'Dogs', sampleCount: 10, accuracy: 0.5 },
    ]

    const deltas = compareRuns(before, after)
    expect(deltas.find((d) => d.classId === 'a')?.direction).toBe('same')
    expect(deltas.find((d) => d.classId === 'b')?.direction).toBe('same')
    expect(deltas.find((d) => d.classId === 'c')?.direction).toBe('added')
  })

  it('follows a renamed class by id and reports it under its new name (D2)', () => {
    const after: readonly RunClassMetric[] = [
      { classId: 'a', className: 'Kittens', sampleCount: 10, accuracy: 0.9 },
      { classId: 'b', className: 'Dogs', sampleCount: 10, accuracy: 0.5 },
    ]
    const delta = compareRuns(before, after).find((d) => d.classId === 'a')
    expect(delta?.className).toBe('Kittens')
    expect(delta?.direction).toBe('better')
    expect(delta?.baselineAccuracy).toBe(0.5)
  })

  it('reports a deleted class rather than dropping it silently', () => {
    const deltas = compareRuns(before, [before[0]!])
    expect(deltas.find((d) => d.classId === 'b')?.direction).toBe('removed')
  })

  it('treats a rounding-sized difference as unchanged', () => {
    const after: readonly RunClassMetric[] = [
      { classId: 'a', className: 'Cats', sampleCount: 10, accuracy: 0.5001 },
      { classId: 'b', className: 'Dogs', sampleCount: 10, accuracy: 0.5 },
    ]
    expect(compareRuns(before, after).every((d) => d.direction === 'same')).toBe(true)
  })
})

describe('the most-confused pair (T084, T086)', () => {
  it('finds the off-diagonal pair with the largest row share', () => {
    const pair = mostConfusedPair(SKEWED, SKEWED_CONFUSION)
    expect(pair).toMatchObject({ trueClass: 'Few', predictedClass: 'Many', count: 4 })
    expect(pair?.share).toBeCloseTo(0.8)
  })

  it('ignores the diagonal, which is correctness rather than confusion', () => {
    expect(
      mostConfusedPair(SKEWED, [
        [40, 0],
        [0, 5],
      ]),
    ).toBeNull()
  })

  it('does not let a large class win on raw count alone', () => {
    // Many sends 8 of 40 (20%) to Few; Few sends 2 of 5 (40%) to Many. The finding
    // is the second one, even though its count is smaller.
    const pair = mostConfusedPair(SKEWED, [
      [32, 8],
      [2, 3],
    ])
    expect(pair?.trueClass).toBe('Few')
  })

  it('survives a class with no samples without dividing by zero', () => {
    expect(
      mostConfusedPair(
        [
          { classId: 'a', className: 'A', sampleCount: 0, accuracy: 0 },
          { classId: 'b', className: 'B', sampleCount: 0, accuracy: 0 },
        ],
        [
          [0, 0],
          [0, 0],
        ],
      ),
    ).toBeNull()
  })
})

describe('the figures survive a reload (Scenario 7.1)', () => {
  it('reads the newest stored run when the session holds no live evaluation', async () => {
    const { useLab } = await import('@/features/lab/labStore')
    const { ResultsPanel } = await import('@/features/results/ResultsPanel')
    const dbModule = await import('@/lib/db')

    const stored: ModelRecord = {
      runId: 'r1',
      projectId: 'p1',
      artifactKey: 'r1',
      classOrder: ['c-many', 'c-few'],
      status: 'ready',
      savedAt: '2026-01-01T10:00:00.000Z',
      metrics: {
        perClass: SKEWED,
        confusion: SKEWED_CONFUSION,
        overallAccuracy: 0.91,
        imbalanceRatio: 8,
        backboneAlpha: 0.5,
        epochs: 20,
        finishedAt: '2026-01-01T10:00:00.000Z',
      },
    }
    vi.spyOn(dbModule, 'listFinishedRuns').mockResolvedValue([stored])

    // A reopened project: classes and counts are restored from IndexedDB, but
    // `evaluation` and `model` are null because the model is not reloaded.
    useLab.setState({
      projectId: 'p1',
      project: {
        id: 'p1',
        name: 'Shapes',
        ownerId: null,
        createdAt: '2026-01-01T09:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.000Z',
        activeRunId: 'r1',
        backboneAlpha: 0.5,
      },
      classes: [
        { id: 'c-many', projectId: 'p1', name: 'Many', order: 0, createdAt: '' },
        { id: 'c-few', projectId: 'p1', name: 'Few', order: 1, createdAt: '' },
      ],
      sampleCounts: { 'c-many': 40, 'c-few': 5 },
      evaluation: null,
      model: null,
      runId: 'r1',
    })

    renderWithProviders(<ResultsPanel />)

    // Without the fallback these three would be absent while the project card
    // still said "trained model ready" — which reads as the lab having lost them.
    expect(await screen.findByTestId('overall-accuracy')).toHaveTextContent(/91%/)
    expect(await screen.findByTestId('imbalance-notice')).toBeVisible()
    expect(within(bodyRow('Few')).getAllByRole('cell')[0]).toHaveTextContent('4')

    vi.restoreAllMocks()
  })
})

describe('export file naming (T088)', () => {
  it('keeps accented and non-Latin names instead of stripping them to nothing', () => {
    expect(safeFileName('¿fruta o no?')).toBe('fruta-o-no-model')
    expect(safeFileName('Обучение')).toBe('Обучение-model')
  })

  it('removes path separators, so a name cannot become a path', () => {
    expect(safeFileName('../../etc/passwd')).toBe('etcpasswd-model')
    expect(safeFileName('a/b\\c')).toBe('abc-model')
  })

  it('falls back rather than producing an empty filename', () => {
    expect(safeFileName('???')).toBe('model')
    expect(safeFileName('   ')).toBe('model')
  })
})
