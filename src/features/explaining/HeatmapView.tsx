import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { HeatmapCanvas } from '@/components/HeatmapCanvas'
import { Legend } from '@/components/Legend'
import { useLab } from '@/features/lab/labStore'
import type { FrozenFrame } from '@/features/testing/FreezeFrame'
import * as db from '@/lib/db'
import { gradCam, summariseHeatMap, type HeatMapSummary } from '@/ml/explain/gradcam'
import { applyColormap, legendStops } from '@/ml/explain/colormap'
import type { HeatMap, TargetLayer } from '@/ml/types'

/**
 * T056, T057, T058 / FR-016, FR-017, FR-018, FR-019, D8, Principle III.
 *
 * Three obligations shape this component, and none of them is decoration.
 *
 * **Any class, not just the predicted one** (FR-016). The class selector lists
 * every class, and the hint says outright that asking why it did *not* pick the
 * other one is often more interesting — that question is most of the pedagogical
 * value of having a heat map at all.
 *
 * **Evidence, not the reason** (FR-018, Principle III). The framing copy is
 * permanent and adjacent to the map, not tucked behind a tooltip. A heat map
 * presented as "the reason" teaches a learner that the model reasons, which is the
 * single most damaging misconception this product could instil.
 *
 * **A text alternative** (FR-017, SC-009). A canvas is invisible to a screen
 * reader, so the positional description is the only route to the same information.
 * It is derived from the map by `summariseHeatMap`, and it refuses to name a
 * position when the evidence is spread out — saying "the top left" about a diffuse
 * map is a more confident claim than the data supports.
 */

/** Ten stops reads as a smooth ramp without becoming a pixel-hunting exercise. */
const LEGEND_STOPS = 10
const DEFAULT_OPACITY = 0.65

export interface HeatmapViewProps {
  readonly frozen: FrozenFrame | null
}

export function HeatmapView({ frozen }: HeatmapViewProps) {
  const { t } = useTranslation('explaining')
  const { classes, model, backbone, runId } = useLab()

  const [classIndex, setClassIndex] = useState(0)
  const [targetLayer, setTargetLayer] = useState<TargetLayer>('conv_pw_13_relu')
  const [opacity, setOpacity] = useState(DEFAULT_OPACITY)
  const [map, setMap] = useState<HeatMap | null>(null)
  const [computing, setComputing] = useState(false)
  const [fromCache, setFromCache] = useState(false)
  const [failed, setFailed] = useState(false)

  const explainedClass = classes[classIndex] ?? null

  // The map belongs to one (frame, class, layer) triple. Clearing it when any of
  // them changes is what stops a stale map being shown as though it described the
  // new selection — which would look entirely plausible and be wrong.
  useEffect(() => {
    setMap(null)
    setFromCache(false)
    setFailed(false)
  }, [frozen?.hash, classIndex, targetLayer])

  const explain = useCallback(async () => {
    if (!frozen || !model || !backbone || !explainedClass) return

    setComputing(true)
    setFailed(false)

    // D8: keyed on the frame, the class, the method AND the method's parameters.
    // A map computed for `conv_pw_11_relu` must be a miss for a 7×7 request, and
    // `degenerate` is part of the key so an all-zero result is never later served
    // as though it were a real one.
    const key = {
      // Explanations are scoped to a training run: the same frame explained by a
      // retrained model is a different answer. With no run recorded (an
      // unsaved/anonymous state) the cache is skipped rather than shared.
      runId: runId ?? '',
      frameHash: frozen.hash,
      classId: explainedClass.id,
      method: 'gradcam' as const,
      params: { targetLayer, degenerate: 0 },
    }

    try {
      if (runId) {
        const cached = await db.findExplanation(key)
        if (cached) {
          setMap({
            values: cached.map,
            width: cached.width,
            height: cached.height,
            method: 'gradcam',
            classIndex,
            params: cached.params,
          })
          setFromCache(true)
          return
        }
      }

      const computed = await gradCam(model, backbone, {
        image: frozen.image,
        classIndex,
        targetLayer,
      })

      setMap(computed)
      setFromCache(false)

      // Cached at its METHOD-SPECIFIC native resolution (D8, data-model.md). A
      // single "7 or 14" assumption here would corrupt every occlusion map stored
      // by US3.
      if (runId) {
        await db.cacheExplanation({
          runId,
          frameHash: frozen.hash,
          classId: explainedClass.id,
          method: 'gradcam',
          map: computed.values,
          width: computed.width,
          height: computed.height,
          params: computed.params,
        })
      }
    } catch {
      setFailed(true)
    } finally {
      setComputing(false)
    }
  }, [frozen, model, backbone, explainedClass, classIndex, targetLayer, runId])

  const summary = useMemo<HeatMapSummary | null>(() => (map ? summariseHeatMap(map) : null), [map])

  const textAlternative = useMemo(() => {
    if (!summary || !explainedClass) return t('needFrame')
    if (summary.degenerate) return t('alt.degenerate', { name: explainedClass.name })
    if (summary.diffuse) return t('alt.diffuse', { name: explainedClass.name })
    return t('alt.concentrated', {
      name: explainedClass.name,
      vertical: t(`alt.vertical.${summary.vertical}`),
      horizontal: t(`alt.horizontal.${summary.horizontal}`),
    })
  }, [summary, explainedClass, t])

  const overlay = useMemo(() => (map ? applyColormap(map, opacity) : null), [map, opacity])
  const stops = useMemo(() => legendStops(LEGEND_STOPS), [])

  if (!model) return <p className="text-sm text-ink-muted">{t('needModel')}</p>
  if (!frozen) return <p className="text-sm text-ink-muted">{t('needFrame')}</p>

  return (
    <div className="flex flex-col gap-4">
      {/* FR-016: every class, and the hint that makes the point of it. */}
      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('classSelector.label')}</span>
        <select
          value={classIndex}
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
        <span className="text-sm text-ink-muted">{t('classSelector.hint')}</span>
      </label>

      <Button onClick={() => void explain()} busy={computing} block>
        {map ? t('recompute') : t('explain')}
      </Button>

      {failed ? (
        <p role="alert" className="text-sm text-magenta">
          {t('failed')}
        </p>
      ) : null}

      {map && overlay ? (
        <>
          <HeatmapCanvas
            base={frozen.canvas}
            overlay={overlay}
            mapWidth={map.width}
            mapHeight={map.height}
            textAlternative={textAlternative}
          />

          <Legend
            stops={stops}
            lowLabel={t('legend.low')}
            highLabel={t('legend.high')}
            caption={t('legend.caption')}
          />

          {/* FR-019: the opacity slider, so the photo underneath stays visible. */}
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
            <span className="text-sm text-ink-muted">{t('opacity.hint')}</span>
          </label>

          {/* R3: the finer layer, presented as a comparison to make rather than an
              upgrade to take. "Finer is not automatically better" is the teaching
              point about explanation resolution. */}
          <fieldset className="flex flex-col gap-1 rounded border border-border-subtle p-2">
            <legend className="px-1 text-sm font-medium">{t('detail.label')}</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['conv_pw_13_relu', t('detail.coarseLabel')],
                  ['conv_pw_11_relu', t('detail.fineLabel')],
                ] as const
              ).map(([layer, label]) => (
                <label key={layer} className="flex min-h-touch items-center gap-2">
                  <input
                    type="radio"
                    name="target-layer"
                    checked={targetLayer === layer}
                    onChange={() => {
                      setTargetLayer(layer)
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <span className="text-sm text-ink-muted">{t('detail.hint')}</span>
          </fieldset>

          {/* T057 — the text alternative, as visible prose and not only as the
              canvas label. A sighted learner benefits from being told where to look
              too, and it makes the claim the map is making checkable in words. */}
          <section className="rounded bg-surface-sunken p-3">
            <h4 className="text-sm font-semibold">{t('alt.heading')}</h4>
            <p data-testid="heatmap-description" className="mt-1 text-sm">
              {textAlternative}
            </p>
            {summary && !summary.degenerate ? (
              <p className="mt-1 text-sm text-ink-muted">
                {t('alt.coverage', { percent: Math.round(summary.spread * 100) })}
              </p>
            ) : null}
          </section>

          {/* FR-018 / Principle III — permanent, adjacent, and not behind a
              disclosure. A heat map shown without this teaches a learner that the
              model has reasons. */}
          <section className="flex flex-col gap-2 rounded border border-sky-300 p-3 text-sm">
            <p>{t('framing.evidenceNotReason')}</p>
            <p>{t('framing.notProof')}</p>
            <p className="text-ink-muted">{t('framing.relativeScale')}</p>
            <p className="text-ink-muted">{t('framing.coarse', { size: map.width })}</p>
          </section>

          <p aria-live="polite" className="text-sm text-ink-muted">
            {fromCache ? t('cached') : ''}
          </p>
        </>
      ) : null}
    </div>
  )
}
