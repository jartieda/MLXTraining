/**
 * Runs before every Vitest file, in both the node and jsdom environments.
 *
 * jest-dom's matchers are only meaningful with a DOM, so they are registered
 * lazily. Importing them unconditionally would pull a DOM dependency into the
 * node environment that src/ml/ is tested in, which is exactly what Principle VI
 * forbids.
 */
if (typeof globalThis.document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')

  /**
   * jsdom implements neither `URL.createObjectURL` nor `revokeObjectURL`, and the
   * sample grid depends on both — on the second one especially, since an unrevoked
   * thumbnail per class switch is the leak that kills a phone tab mid-lesson.
   *
   * The stub counts outstanding handles rather than merely returning a string, so
   * a test can assert that every URL a component created was released. A no-op
   * would let the leak this pair exists to prevent pass unnoticed.
   */
  const outstanding = new Map<string, Blob | MediaSource>()
  let sequence = 0

  const urlConstructor = globalThis.URL as unknown as {
    createObjectURL: (object: Blob | MediaSource) => string
    revokeObjectURL: (url: string) => void
  }

  urlConstructor.createObjectURL = (object) => {
    sequence += 1
    const handle = `blob:ml4g-test/${String(sequence)}`
    outstanding.set(handle, object)
    return handle
  }

  urlConstructor.revokeObjectURL = (url) => {
    outstanding.delete(url)
  }

  ;(globalThis as unknown as { __objectUrlsOutstanding: () => number }).__objectUrlsOutstanding =
    () => outstanding.size

  /**
   * jsdom implements `<dialog>` as an element but not its modal behaviour, so
   * `showModal()` throws. `<dialog>` is supported by every browser in the target
   * range (plan.md pins Safari 17+, and it landed in 15.4), so this is a gap in
   * the test environment rather than in the platform — which is why the component
   * uses the native element and gets focus trapping, the top layer and inert
   * background content for free instead of hand-rolling them.
   *
   * The stub keeps `open` and the `close`/`cancel` events honest, because
   * `Dialog.tsx` routes Escape through `cancel` on purpose so that keyboard
   * dismissal and the close button take the same path.
   */
  const dialog = globalThis.HTMLDialogElement?.prototype as
    | (HTMLDialogElement & { showModal: () => void; show: () => void; close: (v?: string) => void })
    | undefined

  if (dialog) {
    dialog.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true
    }
    dialog.show = function show(this: HTMLDialogElement) {
      this.open = true
    }
    dialog.close = function close(this: HTMLDialogElement, returnValue?: string) {
      this.open = false
      if (returnValue !== undefined) this.returnValue = returnValue
      this.dispatchEvent(new Event('close'))
    }
  }
}
