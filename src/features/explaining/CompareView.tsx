import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { HeatmapCanvas } from '@/components/HeatmapCanvas'
import { Legend } from '@/components/Legend'
import { Meter } from '@/components/Meter'
import { ProgressBar } from '@/components/ProgressBar'
import { useLab } from '@/features/lab/labStore'
import type { FrozenFrame } from '@/features/testing/FreezeFrame'
import * as db from '@/lib/db'
import { gradCam, summariseHeatMap } from '@/ml/explain/gradcam'
import { occlusionSensitivity } from '@/ml/explain/occlusion'
import { chooseDeviceBudget, variantCount } from '@/features/lab/deviceBudget'
import { agreement, type Agreement } from '@/ml/explain/agreement'
import { applyColormap, legendStops } from '@/ml/explain/colormap'
import { isMlError, type HeatMap } from '@/ml/types'

/**
 * T066, T067 / FR-015, FR-018, Principle III.
 *
 * Both methods on one frozen frame, for one class, **side by side and never
 * blended**.
 *
 * That last point is the whole of FR-018 and it is worth being explicit about,
 * because averaging two maps is the obvious thing to build: it produces a single
 * prettier picture and it destroys the only finding that matters. When two
 * independent methods disagree about what the model looked at, the disagreement IS
 * the result — it usually means the model is relying on something fragile. A
 * blended map hides exactly the thing a learner should be investigating, so
 * `agreement()` deliberately returns no combined map for this component to be
 * tempted by.
 *
 * The layout stacks below `md` and goes to two columns above it. On a phone the two
 * maps are one above the other rather than shrunk to half-width each: two 160 px
 * heat maps side by side at 360 px are too small to compare, which defeats the
 * point of showing both.
 */

const LEGEND_STOPS = 10
const DEFAULT_OPACITY = 0.65

type Phase = 'idle' | 'gradcam' | 'occlusion' | 'done' | 'cancelled' | 'failed'

export interface CompareViewProps {
  readonly frozen: FrozenFrame | null
}

export function CompareView({ frozen }: CompareViewProps) {
  const { t } = useTranslation('explaining')
  const { classes, model, backbone, runId, backend } = useLab()

  /**
   * T118. Recomputed on every render rather than memoised: it reads
   * `window.innerWidth`, and a rotation must change the answer (Scenario 8.3). It is
   * two comparisons, so there is nothing to memoise.
   */
  const budget = chooseDeviceBudget(
    backend,
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  )

  const abortRef = useRef<AbortController | null>(null)
  const [classIndex, setClassIndex] = useState(0)
  const [opacity, setOpacity] = useState(DEFAULT_OPACITY)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [gradcamMap, setGradcamMap] = useState<HeatMap | null>(null)
  const [occlusionMap, setOcclusionMap] = useState<HeatMap | null>(null)

  const explainedClass = classes[classIndex] ?? null

  // Both maps belong to one (frame, class) pair. Clearing them together when either
  // changes is what stops one fresh map being compared against one stale one — an
  // agreement figure computed from that would be meaningless and look fine.
  useEffect(() => {
    setGradcamMap(null)
    setOcclusionMap(null)
    setPhase('idle')
    setProgress(null)
  }, [frozen?.hash, classIndex])

  useEffect(() => () => abortRef.current?.abort(), [])

  /** Cache read, then compute, then cache write — for either method. */
  const resolveMap = useCallback(
    async (
      method: 'gradcam' | 'occlusion',
      params: Record<string, number | string>,
      compute: () => Promise<HeatMap>,
    ): Promise<HeatMap> => {
      if (!frozen || !explainedClass) throw new Error('nothing frozen')

      if (runId) {
        const cached = await db.findExplanation({
          runId,
          frameHash: frozen.hash,
          classId: explainedClass.id,
          method,
          params,
        })
        if (cached) {
          return {
            values: cached.map,
            width: cached.width,
            height: cached.height,
            method,
            classIndex,
            params: cached.params,
          }
        }
      }

      const computed = await compute()

      if (runId) {
        // Each at its own METHOD-SPECIFIC native resolution: 7 or 14 for Grad-CAM,
        // the grid size for occlusion. Storing both as though they shared one
        // resolution would corrupt every occlusion map (data-model.md).
        await db.cacheExplanation({
          runId,
          frameHash: frozen.hash,
          classId: explainedClass.id,
          method,
          map: computed.values,
          width: computed.width,
          height: computed.height,
          params: computed.params,
        })
      }

      return computed
    },
    [frozen, explainedClass, runId, classIndex],
  )

  const run = useCallback(async () => {
    if (!frozen || !model || !backbone || !explainedClass) return

    const controller = new AbortController()
    abortRef.current = controller
    setProgress(null)

    try {
      // Grad-CAM first, and shown as soon as it lands. It takes under a second
      // while occlusion takes several, so waiting for both before rendering either
      // would leave a learner looking at nothing for the entire slow part.
      setPhase('gradcam')
      const gradcamParams = { targetLayer: 'conv_pw_13_relu' as const, degenerate: 0 }
      const gradient = await resolveMap('gradcam', gradcamParams, () =>
        gradCam(model, backbone, { image: frozen.image, classIndex }),
      )
      setGradcamMap(gradient)

      setPhase('occlusion')
      // T118: coarser where the device cannot afford 144 forward passes. The grid is
      // part of the cache key (D8), so a map computed at 8×8 is a miss for a 12×12
      // request rather than a wrong hit.
      const gridSize = budget.occlusionGridSize
      const occlusionParams = {
        gridSize,
        patchSize: Math.round(frozen.image.width / gridSize),
        stride: Math.round(frozen.image.width / gridSize),
        degenerate: 0,
      }
      const covered = await resolveMap('occlusion', occlusionParams, () =>
        occlusionSensitivity(model, backbone, {
          image: frozen.image,
          classIndex,
          gridSize,
          signal: controller.signal,
          onProgress: (done, total) => {
            setProgress({ done, total })
          },
        }),
      )
      setOcclusionMap(covered)
      setPhase('done')
    } catch (error) {
      setPhase(isMlError(error) && error.code === 'ABORTED' ? 'cancelled' : 'failed')
    } finally {
      abortRef.current = null
      setProgress(null)
    }
    // `budget.occlusionGridSize` rather than `budget`: the object is rebuilt every
    // render, so depending on it would recreate this callback every time and defeat
    // the memo entirely.
  }, [frozen, model, backbone, explainedClass, classIndex, resolveMap, budget.occlusionGridSize])

  const scores = useMemo<Agreement | null>(
    () => (gradcamMap && occlusionMap ? agreement(gradcamMap, occlusionMap) : null),
    [gradcamMap, occlusionMap],
  )

  const stops = useMemo(() => legendStops(LEGEND_STOPS), [])
  const gradcamOverlay = useMemo(
    () => (gradcamMap ? applyColormap(gradcamMap, opacity) : null),
    [gradcamMap, opacity],
  )
  const occlusionOverlay = useMemo(
    () => (occlusionMap ? applyColormap(occlusionMap, opacity) : null),
    [occlusionMap, opacity],
  )

  function describe(map: HeatMap | null): string {
    if (!map || !explainedClass) return t('needFrame')
    const summary = summariseHeatMap(map)
    if (summary.degenerate) return t('alt.degenerate', { name: explainedClass.name })
    if (summary.diffuse) return t('alt.diffuse', { name: explainedClass.name })
    return t('alt.concentrated', {
      name: explainedClass.name,
      vertical: t(`alt.vertical.${summary.vertical}`),
      horizontal: t(`alt.horizontal.${summary.horizontal}`),
    })
  }

  if (!model) return <p className="text-sm text-ink-muted">{t('needModel')}</p>
  if (!frozen) return <p className="text-sm text-ink-muted">{t('needFrame')}</p>

  const busy = phase === 'gradcam' || phase === 'occlusion'
  const variants = variantCount(budget.occlusionGridSize)

  return (
    <section className="flex flex-col gap-4">
      <h3 className="font-display text-base">{t('compare.heading')}</h3>
      <p className="text-sm text-ink-muted">{t('compare.intro')}</p>

      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('classSelector.label')}</span>
        <select
          value={classIndex}
          disabled={busy}
          onChange={(event) => {
            setClassIndex(Number(event.target.value))
          }}
          className="min-h-touch rounded border border-border-subtle bg-surface px-2"
        >
          {classes.map((klass, index) => (
            <option key={klass.id} value={index}>
              {klass.name}
            </option>
          ))}
        </select>
      </label>

      <p className="text-sm text-ink-muted">{t('compare.budget', { count: variants })}</p>
      {/* T118: said out loud, because a learner comparing her map with a
          classmate's on a faster laptop needs to know why hers is chunkier. */}
      {budget.reason !== null ? (
        <p className="text-sm text-ink-muted" data-testid="coarse-grid-note">
          {t('compare.coarseGrid', { size: budget.occlusionGridSize })}
        </p>
      ) : null}

      {busy ? (
        <ProgressBar
          label={
            phase === 'gradcam' ? t('compare.progressGradcam') : t('compare.occlusionTitle')
          }
          value={progress ? progress.done / progress.total : null}
          detail={
            progress
              ? t('compare.progressOcclusion', { done: progress.done, total: progress.total })
              : t('compare.progressGradcam')
          }
          action={
            <Button
              variant="secondary"
              onClick={() => {
                abortRef.current?.abort()
              }}
            >
              {t('compare.cancel')}
            </Button>
          }
        />
      ) : (
        <Button onClick={() => void run()} block>
          {gradcamMap && occlusionMap ? t('compare.rerun') : t('compare.run')}
        </Button>
      )}

      <p aria-live="polite" className="text-sm text-ink-muted">
        {phase === 'cancelled' ? t('compare.cancelled') : ''}
      </p>
      {phase === 'failed' ? (
        <p role="alert" className="text-sm text-magenta">
          {t('failed')}
        </p>
      ) : null}

      {/* Stacked on a phone, two columns above `md`. Two 160 px maps side by side
          at 360 px would be too small to compare, which defeats showing both. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <figure className="m-0 flex flex-col gap-2">
          <h4 className="text-sm font-semibold">{t('compare.gradcamTitle')}</h4>
          {gradcamMap && gradcamOverlay ? (
            <HeatmapCanvas
              base={frozen.canvas}
              overlay={gradcamOverlay}
              mapWidth={gradcamMap.width}
              mapHeight={gradcamMap.height}
              textAlternative={describe(gradcamMap)}
            />
          ) : (
            <div className="aspect-square w-full max-w-[224px] rounded border border-border-subtle bg-surface-sunken" />
          )}
          <figcaption className="text-sm text-ink-muted">{t('compare.gradcamHow')}</figcaption>
          {gradcamMap ? (
            <p data-testid="gradcam-description" className="text-sm">
              {describe(gradcamMap)}
            </p>
          ) : null}
        </figure>

        <figure className="m-0 flex flex-col gap-2">
          <h4 className="text-sm font-semibold">{t('compare.occlusionTitle')}</h4>
          {occlusionMap && occlusionOverlay ? (
            <HeatmapCanvas
              base={frozen.canvas}
              overlay={occlusionOverlay}
              mapWidth={occlusionMap.width}
              mapHeight={occlusionMap.height}
              textAlternative={describe(occlusionMap)}
            />
          ) : (
            <div className="aspect-square w-full max-w-[224px] rounded border border-border-subtle bg-surface-sunken" />
          )}
          <figcaption className="text-sm text-ink-muted">
            {t('compare.occlusionHow', { count: variants })}
          </figcaption>
          {occlusionMap ? (
            <p data-testid="occlusion-description" className="text-sm">
              {describe(occlusionMap)}
            </p>
          ) : null}
        </figure>
      </div>

      {gradcamMap || occlusionMap ? (
        <>
          <Legend
            stops={stops}
            lowLabel={t('legend.low')}
            highLabel={t('legend.high')}
            caption={t('framing.relativeScale')}
          />
          <label className="flex flex-col gap-1">
            <span className="font-medium">{t('opacity.label')}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(opacity * 100)}
              onChange={(event) => {
                setOpacity(Number(event.target.value) / 100)
              }}
              className="min-h-touch"
            />
          </label>
        </>
      ) : null}

      {/* T067 — the agreement figure and its plain-language band. */}
      {scores ? (
        <section
          data-testid="agreement"
          className={[
            'flex flex-col gap-2 rounded border p-3 text-sm',
            scores.band === 'disagreement' ? 'border-magenta' : 'border-sky-300',
          ].join(' ')}
        >
          <h4 className="font-semibold">{t('compare.agreement.heading')}</h4>

          {/* A number and a sentence. The number alone means nothing to someone who
              has never seen a correlation coefficient, which is most of the
              audience — hence the bands (R5). */}
          <Meter
            label={t('compare.agreement.heading')}
            // Spearman runs [-1, 1]; mapped to [0, 1] for the bar so a negative
            // correlation reads as "no agreement" rather than overflowing backwards.
            value={(scores.spearman + 1) / 2}
            valueText={t('compare.agreement.score', {
              percent: Math.round(scores.spearman * 100),
            })}
            tone={scores.band === 'strong' ? 'good' : scores.band === 'partial' ? 'warn' : 'neutral'}
          />

          <p data-testid="agreement-band">{t(`compare.agreement.${scores.band}`)}</p>
          <p className="text-ink-muted">
            {t('compare.agreement.overlap', { percent: Math.round(scores.topKIoU * 100) })}
          </p>

          {/* FR-018: the disagreement case gets an EXPLICIT statement that neither
              map is guaranteed correct. Not a softened hint, and not hidden behind
              a disclosure — the whole reason for showing two methods is so this can
              be said when it is true. */}
          {scores.band === 'disagreement' ? (
            <p data-testid="disagreement-warning" className="font-medium">
              {t('compare.agreement.disagreementWarning')}
            </p>
          ) : null}

          <p className="text-ink-muted">{t('compare.agreement.noBlend')}</p>
        </section>
      ) : null}
    </section>
  )
}
