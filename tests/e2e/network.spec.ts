import { test, expect, type Page, type Request } from '@playwright/test'

/**
 * T036 + T137 / FR-048, SC-010, Principle I — no image or model bytes leave the device.
 *
 * **T137 is where SC-010 is established.** T036 built the harness before there was a
 * journey to run it across, and said so: a pass then proved almost nothing, because an
 * application that makes no requests at all passes trivially. This file now runs the
 * same watcher across the complete journey — capture, train, test, both explanations,
 * the figures, the model export, and the lesson reflections that legitimately do cross
 * the wire — and it is merge-blocking in CI.
 *
 * The watcher is deliberately paranoid in three independent ways, because each catches
 * a different mistake:
 *
 * - **Magic bytes**, for a raw blob POSTed as a body.
 * - **Text markers**, for a base64 data URL or a serialised TensorFlow.js model,
 *   which is what an accidental `JSON.stringify(model)` produces.
 * - **A blunt size ceiling**, because nothing this application legitimately sends is
 *   large. Names, counts, figures and reflection text are all small; a 256 KB request
 *   body is a picture or a set of weights by elimination, whatever encoding it used.
 *
 * The third is the one that would catch an encoding nobody thought of, and it is the
 * reason the size check is not redundant with the other two.
 */

/** Sniffed against every request body. */
const IMAGE_MAGIC: readonly (readonly [string, readonly number[]])[] = [
  ['JPEG', [0xff, 0xd8, 0xff]],
  ['PNG', [0x89, 0x50, 0x4e, 0x47]],
  ['GIF', [0x47, 0x49, 0x46, 0x38]],
  ['BMP', [0x42, 0x4d]],
  ['WEBP', [0x52, 0x49, 0x46, 0x46]],
]

/** Text markers for a base64 or JSON-encoded image, or a serialised model. */
const SUSPICIOUS_TEXT: readonly (readonly [string, RegExp])[] = [
  ['a base64 data URL for an image', /data:image\/[a-z+]+;base64,/i],
  // The leading bytes of a JPEG and a PNG in base64. A data-URL prefix is easy to
  // strip; these are what the payload actually starts with either way.
  ['base64 JPEG bytes', /\/9j\/[A-Za-z0-9+/]{40,}/],
  ['base64 PNG bytes', /iVBORw0KGgo[A-Za-z0-9+/]{40,}/],
  ['a TensorFlow.js weights manifest', /"weightsManifest"/],
  ['a TensorFlow.js model topology', /"modelTopology"/],
  ['a serialised weight specification', /"weightSpecs"/],
  ['a Keras layer graph', /"class_name"\s*:\s*"(Sequential|Model|Functional)"/],
]

/** Content types that could carry an image or a model, in either direction. */
const FORBIDDEN_CONTENT_TYPES = /^(image\/|video\/|application\/octet-stream)/i

export interface Escape {
  readonly url: string
  readonly method: string
  readonly reason: string
}

/**
 * Watches every outgoing request for the lifetime of the page.
 *
 * Same-origin GETs of our own assets are exempt: fetching the MobileNet weights
 * and the fixture images from our own `public/` directory is inbound, and treating
 * a model DOWNLOAD as an egress would make the gate impossible to pass. What
 * matters is bytes going OUT, so only requests with a body are inspected, plus
 * any cross-origin request at all.
 */
export function watchForEscapes(page: Page): { escapes: Escape[]; requests: Request[] } {
  const escapes: Escape[] = []
  const requests: Request[] = []

  page.on('request', (request) => {
    requests.push(request)

    const url = request.url()
    const method = request.method()

    // A same-origin GET or HEAD carries no body worth inspecting and is how the
    // application loads its own code, fonts and backbone weights.
    const isInbound = method === 'GET' || method === 'HEAD'
    const origin = new URL(page.url() === 'about:blank' ? url : page.url()).origin
    const sameOrigin = url.startsWith(origin)

    if (isInbound && sameOrigin) return

    // Principle I / R14: `connect-src` is restricted to the Supabase project, so
    // ANY other cross-origin destination is a finding regardless of payload.
    if (!sameOrigin && !url.startsWith('data:') && !url.startsWith('blob:')) {
      const host = new URL(url).host
      if (!/\.supabase\.(co|in)$/.test(host) && host !== '127.0.0.1' && host !== 'localhost') {
        escapes.push({ url, method, reason: `request to a third-party origin (${host})` })
        return
      }
    }

    const headers = request.headers()
    const contentType = headers['content-type'] ?? ''
    if (FORBIDDEN_CONTENT_TYPES.test(contentType)) {
      escapes.push({ url, method, reason: `content-type "${contentType}" can carry image or model bytes` })
    }

    const body = request.postDataBuffer()
    if (!body || body.length === 0) return

    for (const [name, magic] of IMAGE_MAGIC) {
      if (magic.every((byte, index) => body[index] === byte)) {
        escapes.push({ url, method, reason: `body begins with ${name} magic bytes` })
        return
      }
    }

    // Only the first slice is scanned as text: a request body large enough to hold
    // an image is itself worth reporting, and decoding megabytes per request would
    // slow the whole suite.
    const text = body.subarray(0, 200_000).toString('utf8')
    for (const [description, pattern] of SUSPICIOUS_TEXT) {
      if (pattern.test(text)) {
        escapes.push({ url, method, reason: `body contains ${description}` })
        return
      }
    }

    // A last, blunt check. Nothing this application legitimately sends is large:
    // the remote store holds names, counts, figures and reflections. A 256 KB
    // request body is a picture or a set of weights by elimination, even if it is
    // encoded in a way none of the patterns above recognise.
    if (body.length > 256_000) {
      escapes.push({
        url,
        method,
        reason: `body is ${String(body.length)} bytes, far larger than any metadata this application sends`,
      })
    }
  })

  return { escapes, requests }
}

export function assertNothingEscaped(escapes: readonly Escape[]): void {
  expect(
    escapes.map((e) => `${e.method} ${e.url} — ${e.reason}`),
    'Principle I is non-negotiable: no image or model bytes may leave the device (FR-048, SC-010)',
  ).toEqual([])
}

test.describe('no image or model bytes leave the device', () => {
  test('the landing page and the anonymous routes send nothing', async ({ page }) => {
    const { escapes, requests } = watchForEscapes(page)

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await page.getByRole('link', { name: /my projects|mis proyectos/i }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    assertNothingEscaped(escapes)

    // The floor. Without it, a build that failed to load any JavaScript at all
    // would pass this suite, and a gate that passes on a broken application is
    // worse than no gate.
    expect(
      requests.length,
      'the page made almost no requests, so this run asserted nothing',
    ).toBeGreaterThan(3)
  })

  /**
   * T137 / SC-010 — the complete journey, in one page lifetime.
   *
   * One test rather than several, deliberately. The watcher is per-page, and the
   * failure this exists to catch is a request made *somewhere* in a long session —
   * splitting the journey across pages would give each phase a fresh watcher and lose
   * exactly the cross-phase egress a real lesson would produce.
   *
   * It ends with the model export, which is the one place bytes legitimately leave the
   * browser. `downloads://` is a browser save rather than a network call, and asserting
   * that here is the check that the distinction is real rather than claimed.
   */
  test('the complete journey sends no image and no model (SC-010)', async ({ page }) => {
    test.setTimeout(1_800_000)
    const { escapes, requests } = watchForEscapes(page)

    // ── W1: capture and train, deliberately imbalanced so the figures and the
    // imbalance notice are exercised too.
    await page.goto('/projects')
    await page.getByRole('button', { name: /new project|nuevo proyecto/i }).click()
    await page.getByLabel(/project name|nombre del proyecto/i).fill('Full journey')
    await page.getByRole('button', { name: /^save$|^guardar$/i }).click()

    for (const [className, files] of [
      [
        'Stripes',
        [
          'class-stripes-h-0.png',
          'class-stripes-h-1.png',
          'class-stripes-h-2.png',
          'class-stripes-h-3.png',
        ],
      ],
      ['Circles', ['class-circle-0.png']],
    ] as const) {
      await page.getByRole('button', { name: /add a class|añadir una clase/i }).click()
      await page.getByLabel(/class name|nombre de la clase/i).fill(className)
      await page.keyboard.press('Enter')
      await page.getByRole('radio', { name: new RegExp(className, 'i') }).click()
      await expect(page.getByRole('button', { name: /choose photos|elegir fotos/i })).toBeEnabled({
        timeout: 300_000,
      })
      await page
        .locator('#upload-samples-input')
        .setInputFiles(files.map((file) => `tests/fixtures/${file}`))
      await expect(page.getByText(/added \d+ photos?/i)).toBeVisible({ timeout: 180_000 })
    }

    await page.getByRole('button', { name: /^train$|^entrenar$/i }).click()
    await expect(page.getByText(/trained\.|entrenado\./i)).toBeVisible({ timeout: 600_000 })

    // ── W5 / US7: the figures, the confusion matrix and the imbalance notice.
    await expect(page.getByTestId('overall-accuracy')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('imbalance-notice')).toBeVisible({ timeout: 60_000 })

    // ── W2: live prediction against the camera, which is where a frame could most
    // easily be sent somewhere by accident.
    await page.getByRole('button', { name: /turn on the camera|encender la cámara/i }).click()
    await expect(page.getByLabel(/camera preview|vista previa/i)).toBeVisible()
    await page.getByRole('button', { name: /start guessing|empezar a adivinar/i }).click()
    await expect(page.getByText(/\d+% sure|\d+% de seguridad/i)).toBeVisible({ timeout: 300_000 })
    await page.getByRole('button', { name: /stop guessing|dejar de adivinar/i }).click()

    // ── W3: freeze, explain, and compare both methods.
    await page.getByRole('button', { name: /freeze this frame|congelar esta imagen/i }).click()
    await expect(page.getByText(/frame frozen|imagen congelada/i)).toBeVisible()
    await page.getByRole('button', { name: /show me why|muéstrame por qué/i }).click()
    await expect(page.getByTestId('heatmap-description')).toBeVisible({ timeout: 600_000 })
    await page.getByRole('button', { name: /work out both|calcular los dos/i }).click()
    await expect(page.getByTestId('occlusion-description')).toBeVisible({ timeout: 900_000 })
    await expect(page.getByTestId('agreement')).toBeVisible()

    // ── The export: the one place bytes leave the browser at all, by a learner's own
    // explicit action to a destination she can see (FR-048). `downloads://` is a
    // browser save rather than a network call, and this is where that distinction is
    // checked rather than claimed.
    //
    // Done here, before leaving the lab, because the export needs the live model
    // handle. Reopening a project restores its figures and its status but not the
    // model itself — FR-031 asks for "trained-model status" and that is what it
    // restores — so the export is offered only in the session that trained it.
    await expect(page.getByRole('button', { name: /export the model/i })).toBeVisible({
      timeout: 60_000,
    })
    await page.getByRole('button', { name: /export the model/i }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('dialog').getByRole('button', { name: /download it/i }).click()
    await download

    // ── The lessons, which are the one place a learner's own words legitimately
    // cross the wire. Anonymous here, so nothing is written — the signed-in case is
    // covered by us5-learning-path.spec.ts, which runs this same watcher.
    await page.goto('/lessons/what-the-model-sees')
    await page.getByRole('textbox').first().fill('It used the background, I think.')
    await expect(page.getByTestId('lessons-anonymous')).toBeVisible()

    // ── The assertion SC-010 rests on, over every request of the whole session.
    assertNothingEscaped(escapes)

    // And a floor, so a run that silently did nothing cannot pass. A journey this
    // long fetches the application, the fonts and 5.4 MB of backbone weights.
    expect(
      requests.length,
      'the journey made too few requests to have actually happened',
    ).toBeGreaterThan(20)

    console.log(
      `\nT137 / SC-010: ${String(requests.length)} requests watched across the complete journey, ` +
        'zero image or model bytes leaving the device.\n',
    )
  })
})
