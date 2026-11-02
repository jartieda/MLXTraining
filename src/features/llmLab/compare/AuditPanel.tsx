import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ProgressBar } from '@/components/ProgressBar'
import { LlmAbortedError, type LlmEngine } from '../llmEngine'
import { AUDIT_PAIRS, runAudit, summarizeAudit, type AuditName, type AuditRow } from './audit'
import type { AnswerOption } from './scoreOptions'

/**
 * «Auditar 5 pares de nombres», under the name-bias case of the comparator: the same
 * application with five pairs of names, a table of differences and their mean.
 */

const percent = (value: number) => Math.round(value * 100)

export function AuditPanel({
  engine,
  modelName,
  disabled,
  onRunningChange,
}: {
  readonly engine: LlmEngine | null
  readonly modelName: string
  /** Another comparison is running. */
  readonly disabled: boolean
  readonly onRunningChange: (running: boolean) => void
}) {
  const { t } = useTranslation('llm')
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState<readonly AuditRow[]>([])
  const [finished, setFinished] = useState<{ rows: readonly AuditRow[]; modelName: string } | null>(null)
  const [status, setStatus] = useState<'stopped' | 'failed' | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    onRunningChange(running)
  }, [running, onRunningChange])

  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  const options: AnswerOption[] = [
    { letter: 'A', text: t('compare.presets.biasName.options.A') },
    { letter: 'B', text: t('compare.presets.biasName.options.B') },
  ]
  const textFor = (person: AuditName) => t(`compare.audit.template_${person.gender}`, { name: person.name })

  async function handleAudit() {
    if (!engine || running) return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setStatus(null)
    setRows([])
    setFinished(null)
    try {
      const result = await runAudit(engine, AUDIT_PAIRS, textFor, options, 'A', t('compare.optionsInstruction'), setRows, controller.signal)
      if (controller.signal.aborted) throw new LlmAbortedError()
      setFinished({ rows: result, modelName })
    } catch (error) {
      if (error instanceof LlmAbortedError || controller.signal.aborted) setStatus('stopped')
      else {
        console.warn('Audit failed:', error)
        setStatus('failed')
      }
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  const summary = finished ? summarizeAudit(finished.rows) : null

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3" data-testid="audit">
      <h3 className="font-semibold">{t('compare.audit.title')}</h3>
      <p className="max-w-prose text-sm text-ink-muted">{t('compare.audit.intro', { count: AUDIT_PAIRS.length * 2 })}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={running || disabled || !engine}
          onClick={() => {
            void handleAudit()
          }}
        >
          {t('compare.audit.run')}
        </Button>
      </div>

      {running ? (
        <ProgressBar
          label={t('compare.audit.progressLabel')}
          value={rows.length / AUDIT_PAIRS.length}
          detail={t('compare.audit.progress', { done: rows.length, total: AUDIT_PAIRS.length })}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                abortRef.current?.abort()
              }}
            >
              {t('chat.stop')}
            </Button>
          }
        />
      ) : null}
      {status === 'stopped' ? <p role="status" className="text-sm text-ink-muted">{t('compare.audit.stopped')}</p> : null}
      {status === 'failed' ? <p role="alert" className="text-sm text-red-700">{t('compare.failed')}</p> : null}

      {finished && summary ? (
        <>
          <p className="text-xs text-ink-muted">{t('compare.conditions', { model: finished.modelName })}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="pb-1 text-left text-ink-muted">{t('compare.audit.caption')}</caption>
              <thead>
                <tr className="border-b border-border-subtle">
                  <th scope="col" className="py-1 pr-2">{t('compare.audit.colPair')}</th>
                  <th scope="col" className="py-1 pr-2 tabular-nums">{t('compare.audit.colA')}</th>
                  <th scope="col" className="py-1 pr-2 tabular-nums">{t('compare.audit.colB')}</th>
                  <th scope="col" className="py-1 tabular-nums">{t('compare.audit.colDelta')}</th>
                </tr>
              </thead>
              <tbody>
                {finished.rows.map((row) => (
                  <tr key={`${row.pair.a.name}-${row.pair.b.name}`} className="border-b border-border-subtle">
                    <th scope="row" className="py-1 pr-2 font-normal">{row.pair.a.name} / {row.pair.b.name}</th>
                    <td className="py-1 pr-2 tabular-nums">{row.a === null ? t('compare.notMeasuredShort') : `${percent(row.a)} %`}</td>
                    <td className="py-1 pr-2 tabular-nums">{row.b === null ? t('compare.notMeasuredShort') : `${percent(row.b)} %`}</td>
                    <td className="py-1 tabular-nums">{row.delta === null ? '—' : signed(row.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section aria-live="polite" data-testid="audit-verdict" className="flex flex-col gap-1 rounded border border-border-subtle p-3 text-sm">
            <h4 className="font-semibold">
              {t('compare.audit.verdictHeading')} <span data-testid="audit-band">{t(`compare.verdict.${summary.band}`)}</span>
            </h4>
            {summary.meanAbsDelta !== null && summary.largest ? (
              <>
                <p>{t('compare.audit.mean', { points: percent(summary.meanAbsDelta), measured: summary.measured })}</p>
                <p>
                  {t('compare.audit.largest', {
                    a: summary.largest.pair.a.name,
                    b: summary.largest.pair.b.name,
                    points: Math.abs(percent(summary.largest.delta ?? 0)),
                  })}
                </p>
                <p>{t('compare.audit.noticeable', { count: summary.noticeable, total: summary.measured })}</p>
              </>
            ) : (
              <p>{t('compare.audit.noneMeasured')}</p>
            )}
            <p className="text-ink-muted">{t('compare.audit.lesson')}</p>
          </section>
        </>
      ) : null}
    </div>
  )
}

function signed(delta: number): string {
  const points = Math.round(delta * 100)
  return points === 0 ? '0' : `${points > 0 ? '+' : '−'}${Math.abs(points)}`
}
