import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { useLab } from '@/features/lab/labStore'
import * as db from '@/lib/db'

/**
 * T044 / FR-004 — review and delete individual photos.
 *
 * FR-004 asks for individual deletion specifically, and the reason shows up the
 * first time a learner uses the lab: a burst capture picks up two frames of her
 * hand reaching for the object, and being able to remove exactly those two is the
 * difference between fixing a shortcut and starting the class again.
 *
 * The blob URLs are revoked on unmount. A grid of forty 15 KB thumbnails left
 * unrevoked across every class switch is a leak that ends with a phone tab dying
 * mid-lesson, and nothing in the interface would suggest why.
 */

/** Rendered before "show all", so a forty-photo class does not fill a phone screen. */
const INITIAL_VISIBLE = 12

export function SampleGrid() {
  const { t } = useTranslation('capture')
  const { projectId, classes, selectedClassId, refreshClasses } = useLab()
  const [samples, setSamples] = useState<readonly db.SampleRecord[]>([])
  const [expanded, setExpanded] = useState(false)

  const selectedClass = useMemo(
    () => classes.find((klass) => klass.id === selectedClassId) ?? null,
    [classes, selectedClassId],
  )

  useEffect(() => {
    if (!projectId || !selectedClassId) {
      setSamples([])
      return
    }
    let live = true
    void db.listSamples(projectId, selectedClassId).then((loaded) => {
      if (live) setSamples(loaded)
    })
    return () => {
      live = false
    }
  }, [projectId, selectedClassId, classes])

  const visible = expanded ? samples : samples.slice(0, INITIAL_VISIBLE)

  async function remove(id: string) {
    await db.deleteSample(id)
    setSamples((current) => current.filter((sample) => sample.id !== id))
    // Refresh so the per-class count in ClassList moves at the same time; two
    // views of the same number disagreeing is a small but corrosive bug.
    await refreshClasses()
  }

  if (!selectedClass) return null

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">
        {t('samples.heading', { name: selectedClass.name })}
      </h3>

      {samples.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('samples.empty')}</p>
      ) : (
        <>
          <ul className="grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4">
            {visible.map((sample, index) => (
              <SampleThumb
                key={sample.id}
                sample={sample}
                index={index + 1}
                className={selectedClass.name}
                onDelete={() => void remove(sample.id)}
              />
            ))}
          </ul>

          {samples.length > INITIAL_VISIBLE ? (
            <Button
              variant="ghost"
              onClick={() => {
                setExpanded((value) => !value)
              }}
            >
              {expanded ? t('samples.showFewer') : t('samples.showAll', { count: samples.length })}
            </Button>
          ) : null}
        </>
      )}
    </div>
  )
}

function SampleThumb({
  sample,
  index,
  className,
  onDelete,
}: {
  readonly sample: db.SampleRecord
  readonly index: number
  readonly className: string
  readonly onDelete: () => void
}) {
  const { t } = useTranslation('capture')
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const created = URL.createObjectURL(sample.image)
    setUrl(created)
    // Revoked on unmount. Without this, switching classes forty times in a lesson
    // holds every thumbnail's bytes alive until the tab dies.
    return () => {
      URL.revokeObjectURL(created)
    }
  }, [sample.image])

  return (
    <li className="relative">
      {url ? (
        <img
          src={url}
          // SC-009: naming the class as well as the index means the alternative
          // text says something a sighted user can also see — which class this
          // photo is teaching.
          alt={t('samples.thumbnailAlt', { index, name: className })}
          className="aspect-square w-full rounded border border-border-subtle object-cover"
        />
      ) : (
        <div className="aspect-square w-full rounded border border-border-subtle bg-surface-sunken" />
      )}
      <button
        type="button"
        onClick={onDelete}
        aria-label={t('samples.delete', { index })}
        // Deliberately not confirmed. One photo out of forty is a cheap, obvious
        // mistake to recover from by taking another, and a dialogue per deletion
        // would make pruning a burst unbearable. Deleting a whole CLASS is
        // confirmed, because that is not recoverable.
        className="absolute top-1 right-1 flex size-8 items-center justify-center rounded-full bg-navy/70 text-ink-inverse"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </li>
  )
}
