import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { useLab } from '@/features/lab/labStore'
import * as db from '@/lib/db'

/**
 * T041 / FR-001 — create, rename, reorder and delete classes.
 *
 * Two choices here are deliberate and worth not undoing.
 *
 * **Reordering is buttons, not drag-and-drop.** A drag handle is unusable with a
 * keyboard (SC-009 requires a keyboard-only pass) and fiddly on a 360 px
 * touchscreen (SC-004). Two arrow buttons are neither elegant nor ambiguous.
 *
 * **Deleting a class is confirmed and states the photo count.** Those photos exist
 * nowhere else — nothing is backed up, by design — so the cost of the action has
 * to be on screen before she takes it.
 */

type Editing = { readonly kind: 'create' } | { readonly kind: 'rename'; readonly id: string }

export function ClassList() {
  const { t } = useTranslation('capture')
  const { projectId, classes, sampleCounts, selectedClassId, selectClass, refreshClasses } = useLab()

  const [editing, setEditing] = useState<Editing | null>(null)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<db.ClassRecord | null>(null)

  function beginCreate() {
    setEditing({ kind: 'create' })
    setDraft('')
    setProblem(null)
  }

  function beginRename(klass: db.ClassRecord) {
    setEditing({ kind: 'rename', id: klass.id })
    setDraft(klass.name)
    setProblem(null)
  }

  function cancelEditing() {
    setEditing(null)
    setDraft('')
    setProblem(null)
  }

  /**
   * Storage errors are translated by CODE, not by re-implementing the validation
   * here. `db.ts` already owns the case-insensitive duplicate rule (D3); checking
   * it again in the component would give two rules that agree until one changes.
   */
  function describe(error: unknown, name: string): string {
    if (error instanceof db.StorageError) {
      switch (error.code) {
        case 'DUPLICATE_CLASS_NAME':
          return t('classes.duplicate', { name })
        case 'INVALID_NAME':
          return name.trim().length === 0 ? t('classes.tooShort') : t('classes.tooLong')
        default:
          break
      }
    }
    return t('common:error.generic')
  }

  async function submit() {
    if (!projectId || !editing) return
    const name = draft.trim()

    try {
      if (editing.kind === 'create') {
        const created = await db.addClass(projectId, name)
        await refreshClasses()
        // Select the new class immediately: a learner who has just named a class is
        // about to photograph it, and making her click it first is a step for nothing.
        selectClass(created.id)
      } else {
        await db.renameClass(editing.id, name)
        await refreshClasses()
      }
      cancelEditing()
    } catch (error) {
      setProblem(describe(error, name))
    }
  }

  async function move(index: number, direction: -1 | 1) {
    if (!projectId) return
    const target = index + direction
    if (target < 0 || target >= classes.length) return

    const order = classes.map((klass) => klass.id)
    const a = order[index]
    const b = order[target]
    if (a === undefined || b === undefined) return
    order[index] = b
    order[target] = a

    await db.reorderClasses(projectId, order)
    await refreshClasses()
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    await db.deleteClass(pendingDelete.id)
    setPendingDelete(null)
    await refreshClasses()
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{t('classes.heading')}</h3>

      {classes.length === 0 ? <p className="text-sm text-ink-muted">{t('classes.empty')}</p> : null}
      {classes.length === 1 ? (
        <p className="text-sm text-ink-muted">{t('classes.needTwo')}</p>
      ) : null}

      {/* A radiogroup, because choosing the capture target is exactly a
          single-choice question, and it gives arrow-key navigation for free. */}
      <ul role="radiogroup" aria-label={t('classes.heading')} className="flex list-none flex-col gap-2 p-0">
        {classes.map((klass, index) => {
          const count = sampleCounts[klass.id] ?? 0
          const isSelected = klass.id === selectedClassId
          const isRenaming = editing?.kind === 'rename' && editing.id === klass.id

          return (
            <li
              key={klass.id}
              className={[
                'flex flex-col gap-2 rounded border p-2',
                isSelected ? 'border-blue bg-sky-100' : 'border-border-subtle bg-surface',
              ].join(' ')}
            >
              {isRenaming ? (
                <NameField
                  label={t('classes.nameLabel')}
                  value={draft}
                  onChange={setDraft}
                  onSubmit={() => void submit()}
                  onCancel={cancelEditing}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => {
                      selectClass(klass.id)
                    }}
                    className="flex min-h-touch flex-1 items-center gap-2 text-left"
                  >
                    <span
                      aria-hidden="true"
                      className={[
                        'size-4 shrink-0 rounded-full border-2',
                        isSelected ? 'border-blue bg-blue' : 'border-border-subtle',
                      ].join(' ')}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{klass.name}</span>
                      <span className="block text-sm text-ink-muted">
                        {count === 0 ? t('classes.countZero') : t('classes.count', { count })}
                      </span>
                    </span>
                  </button>

                  <div className="flex shrink-0 items-center">
                    {index > 0 ? (
                      <IconButton
                        label={t('classes.moveUp', { name: klass.name })}
                        onClick={() => void move(index, -1)}
                        glyph="↑"
                      />
                    ) : null}
                    {index < classes.length - 1 ? (
                      <IconButton
                        label={t('classes.moveDown', { name: klass.name })}
                        onClick={() => void move(index, 1)}
                        glyph="↓"
                      />
                    ) : null}
                    <IconButton
                      label={t('classes.renameLabel', { name: klass.name })}
                      onClick={() => {
                        beginRename(klass)
                      }}
                      glyph="✎"
                    />
                    <IconButton
                      label={t('classes.delete', { name: klass.name })}
                      onClick={() => {
                        setPendingDelete(klass)
                      }}
                      glyph="✕"
                    />
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {editing?.kind === 'create' ? (
        <NameField
          label={t('classes.nameLabel')}
          value={draft}
          onChange={setDraft}
          onSubmit={() => void submit()}
          onCancel={cancelEditing}
          placeholder={t('classes.namePlaceholder')}
        />
      ) : (
        <Button variant="secondary" onClick={beginCreate} block>
          {t('classes.add')}
        </Button>
      )}

      {/* aria-live so the refusal reaches a screen-reader user, who otherwise sees
          the field simply fail to submit. */}
      {problem ? (
        <p role="alert" className="text-sm text-magenta">
          {problem}
        </p>
      ) : null}

      <Dialog
        open={pendingDelete !== null}
        title={t('classes.deleteTitle', { name: pendingDelete?.name ?? '' })}
        closeLabel={t('common:action.close')}
        dismissOnBackdrop={false}
        onClose={() => {
          setPendingDelete(null)
        }}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPendingDelete(null)
              }}
            >
              {t('common:action.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              {t('common:action.delete')}
            </Button>
          </>
        }
      >
        <p>
          {t('classes.deleteBody', {
            count: pendingDelete ? (sampleCounts[pendingDelete.id] ?? 0) : 0,
          })}
        </p>
      </Dialog>
    </div>
  )
}

function NameField({
  label,
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onSubmit: () => void
  readonly onCancel: () => void
  readonly placeholder?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex-1">
        <span className="sr-only">{label}</span>
        <input
          aria-label={label}
          value={value}
          placeholder={placeholder}
          autoFocus
          maxLength={60}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmit()
            if (event.key === 'Escape') onCancel()
          }}
          className="min-h-touch w-full rounded border border-border-subtle bg-surface px-2 text-ink"
        />
      </label>
      <Button onClick={onSubmit}>{'✓'}</Button>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  glyph,
}: {
  readonly label: string
  readonly onClick: () => void
  readonly glyph: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // The 44 px floor applies to every control, including the small ones —
      // especially the small ones (FR-046).
      className="flex min-h-touch min-w-touch items-center justify-center rounded text-ink-muted hover:bg-surface-sunken"
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  )
}
