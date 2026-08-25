import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import type { TrainedModel } from '@/ml/train'
import type { RunClassMetric } from '@/lib/db'
import { safeFileName } from './analysis'

/**
 * T088 / FR-022, FR-048, Scenario 7.4 — exporting the trained head.
 *
 * FR-022's obligation is narrow and precise: state what the file contains **before**
 * producing it. So the dialogue is not a confirmation step bolted on for safety —
 * it is the deliverable, and the download only starts from inside it. A button that
 * downloaded first and explained afterwards would satisfy the letter of nothing.
 *
 * What the statement has to get right is the part a learner will otherwise assume
 * wrongly. She has just trained something on photographs of her own face and her
 * own room, and "export the model" sounds like it might carry them. It does not:
 * the file holds the small classification head's weights and her class names, and
 * the frozen MobileNet backbone is not in it either — which is also why the file
 * is useless without this lab, and saying so is more honest than letting her
 * discover it.
 *
 * This is one of the two places in the product where data crosses the device
 * boundary at a learner's request, and Principle I permits it precisely because she
 * initiates it and the destination is named: her own downloads folder. `downloads://`
 * is a browser save, not a network call — nothing is uploaded, and the no-egress
 * test (T137) passes with this feature working, which is the check that the
 * distinction is real rather than asserted.
 */

export function ExportModel({
  model,
  perClass,
  projectName,
}: {
  readonly model: TrainedModel | null
  readonly perClass: readonly RunClassMetric[]
  readonly projectName: string
}) {
  const { t } = useTranslation('results')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(false)
  const [done, setDone] = useState(false)

  if (!model) return null

  const fileName = safeFileName(projectName)

  async function produce() {
    if (!model || busy) return
    setBusy(true)
    setProblem(false)
    try {
      // `pooled` is the inference path — the one an importer would use. Saving
      // `spatial` would export the Grad-CAM variant, which shares these weights
      // but takes a different input shape and would confuse anyone who opened it.
      await model.head.pooled.save(`downloads://${fileName}`)
      setDone(true)
      setOpen(false)
    } catch {
      setProblem(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="export-heading" className="flex flex-col gap-2">
      <h3 id="export-heading" className="font-display text-base">
        {t('export.heading')}
      </h3>
      <p className="max-w-prose text-sm text-ink-muted">{t('export.intro')}</p>

      <div>
        <Button
          variant="secondary"
          onClick={() => {
            setDone(false)
            setOpen(true)
          }}
        >
          {t('export.open')}
        </Button>
      </div>

      <p aria-live="polite" className="text-sm text-ink-muted">
        {done ? t('export.done', { fileName }) : null}
      </p>
      {problem ? (
        <p role="alert" className="text-sm text-magenta">
          {t('export.failed')}
        </p>
      ) : null}

      <Dialog
        open={open}
        title={t('export.dialogTitle')}
        closeLabel={t('common:action.close')}
        dismissOnBackdrop={false}
        onClose={() => {
          setOpen(false)
        }}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false)
              }}
            >
              {t('common:action.cancel')}
            </Button>
            {/* The only path to a file. Nothing is written before this click. */}
            <Button onClick={() => void produce()} disabled={busy}>
              {busy ? t('export.producing') : t('export.confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p>{t('export.contains')}</p>
          <ul className="list-disc pl-5 text-sm">
            <li>{t('export.itemWeights')}</li>
            <li>
              {t('export.itemClasses', {
                count: perClass.length,
                names: perClass.map((entry) => entry.className).join(', '),
              })}
            </li>
            <li>{t('export.itemFiles', { fileName })}</li>
          </ul>

          {/* The absences, which are the part she would otherwise assume. */}
          <p className="text-sm font-medium">{t('export.notContains')}</p>
          <ul className="list-disc pl-5 text-sm">
            <li>{t('export.noPhotos')}</li>
            <li>{t('export.noBackbone')}</li>
          </ul>

          <p className="text-sm text-ink-muted">{t('export.destination')}</p>
        </div>
      </Dialog>
    </section>
  )
}
