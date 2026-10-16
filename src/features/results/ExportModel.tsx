import { useState } from 'react'
import * as tf from '@tensorflow/tfjs'
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
  const [donePackage, setDonePackage] = useState<string | null>(null)

  if (!model) return null

  const fileName = safeFileName(projectName)

  function downloadBlob(file: string, blob: Blob): void {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = file
    link.rel = 'noopener'
    link.click()
    requestAnimationFrame(() => URL.revokeObjectURL(url))
  }

  function buildReadme(baseName: string, classes: readonly string[]): string {
    return [
      `# ${baseName} browser package`,
      '',
      'This export is a lightweight TensorFlow.js package for browser inference.',
      'It includes only the trained classification head (the decision layer), not photos.',
      '',
      '## Files',
      '',
      `- ${baseName}.model.json`,
      `- ${baseName}.weights.bin`,
      `- ${baseName}.labels.json`,
      '',
      '## Class order used by the model',
      '',
      ...classes.map((name, index) => `${String(index)}. ${name}`),
      '',
      '## Use in a browser',
      '',
      '```ts',
      "import * as tf from '@tensorflow/tfjs'",
      '',
      `const model = await tf.loadLayersModel('/models/${baseName}.model.json')`,
      `const labels = await fetch('/models/${baseName}.labels.json').then((r) => r.json())`,
      '',
      '// The head expects one embedding vector per sample, not raw pixels.',
      '// Build embeddings with the same MobileNet backbone and preprocessing',
      '// used by this lab, then pass a tensor shaped [N, embeddingSize].',
      'const embeddingBatch = tf.tensor2d([[/* ...embedding values... */]])',
      'const scores = model.predict(embeddingBatch) as tf.Tensor2D',
      'const values = await scores.array()',
      '',
      '// Highest score index maps to labels.classNames[index]',
      'console.log(values[0], labels.classNames)',
      '```',
      '',
      '## Important',
      '',
      '- This package does not contain the frozen backbone.',
      '- It does not contain any training photos.',
      '- Use the same backbone alpha and preprocessing as training to get consistent results.',
      '',
    ].join('\n')
  }

  function weightDataByteLength(weightData: tf.io.WeightData | undefined): number {
    if (!weightData) return 0
    if (weightData instanceof ArrayBuffer) return weightData.byteLength
    return weightData.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  }

  async function weightDataToArrayBuffer(weightData: tf.io.WeightData): Promise<ArrayBuffer> {
    if (weightData instanceof ArrayBuffer) return weightData
    return new Blob(weightData).arrayBuffer()
  }

  async function captureHeadArtifacts(trainedModel: TrainedModel): Promise<tf.io.ModelArtifacts> {
    let captured: tf.io.ModelArtifacts | null = null

    await trainedModel.head.pooled.save(
      tf.io.withSaveHandler(async (artifacts) => {
        captured = artifacts
        return {
          modelArtifactsInfo: {
            dateSaved: new Date(),
            modelTopologyType: 'JSON',
            modelTopologyBytes: JSON.stringify(artifacts.modelTopology ?? {}).length,
            weightSpecsBytes: JSON.stringify(artifacts.weightSpecs ?? []).length,
            weightDataBytes: weightDataByteLength(artifacts.weightData),
          },
        }
      }),
    )

    const artifacts = captured
    if (!artifacts || !artifacts.modelTopology || !artifacts.weightSpecs || !artifacts.weightData) {
      throw new Error('Could not capture model artifacts for export.')
    }

    return artifacts
  }

  async function produce() {
    if (!model || busy) return
    setBusy(true)
    setProblem(false)
    try {
      // `pooled` is the inference path — the one an importer would use. Saving
      // `spatial` would export the Grad-CAM variant, which shares these weights
      // but takes a different input shape and would confuse anyone who opened it.
      const artifacts = await captureHeadArtifacts(model)

      const packageName = `${fileName}.tflite-web`
      const modelFile = `${packageName}.model.json`
      const weightsFile = `${packageName}.weights.bin`
      const labelsFile = `${packageName}.labels.json`
      const readmeFile = `${packageName}.README.md`

      const modelJson = {
        format: 'layers-model',
        generatedBy: 'ml4g-xai-lab',
        convertedBy: 'browser-export',
        modelTopology: artifacts.modelTopology,
        weightsManifest: [{ paths: [weightsFile], weights: artifacts.weightSpecs }],
      }

      const classes = perClass.map((entry) => entry.className)
      const labelsJson = {
        classNames: classes,
        exportedAt: new Date().toISOString(),
      }

      downloadBlob(
        modelFile,
        new Blob([JSON.stringify(modelJson, null, 2)], { type: 'application/json;charset=utf-8' }),
      )
      const weightsBuffer = await weightDataToArrayBuffer(artifacts.weightData)
      downloadBlob(weightsFile, new Blob([weightsBuffer], { type: 'application/octet-stream' }))
      downloadBlob(
        labelsFile,
        new Blob([JSON.stringify(labelsJson, null, 2)], { type: 'application/json;charset=utf-8' }),
      )
      downloadBlob(
        readmeFile,
        new Blob([buildReadme(packageName, classes)], { type: 'text/markdown;charset=utf-8' }),
      )

      setDonePackage(packageName)
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
            setDonePackage(null)
            setOpen(true)
          }}
        >
          {t('export.open')}
        </Button>
      </div>

      <p aria-live="polite" className="text-sm text-ink-muted">
        {donePackage ? t('export.done', { packageName: donePackage }) : null}
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
            <li>{t('export.itemInstructions')}</li>
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
