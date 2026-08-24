import { test, expect, type Page, type Request } from '@playwright/test'

/**
 * T036 / FR-048, SC-010, Principle I — no image or model bytes leave the device.
 *
 * ## What this file is, and what it is not, at this phase
 *
 * T036 builds the HARNESS. There is no journey to run it across yet, so a pass
 * here proves almost nothing — an application that makes no requests at all
 * passes trivially. That is not a defect in the test; it is the honest state of a
 * gate written before the thing it gates exists.
 *
 * **T137 is where SC-010 is actually established**, by running this same harness
 * across the complete W1–W9 journey and making it merge-blocking. The
 * `assertNothingEscaped` helper below is shared with it deliberately, so the two
 * cannot drift apart.
 *
 * To keep the current run from being vacuous, `expectedRequestFloor` asserts that
 * the page made at least a handful of requests. A future refactor that broke
 * navigation entirely would otherwise turn this suite green.
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

  test('T137 will run this across the whole journey; this run covers the shell only', async ({
    page,
  }) => {
    // Recorded as a test rather than a comment so the limitation is visible in the
    // report a reviewer reads, not only to whoever opens this file. SC-010 is not
    // yet established by this suite.
    const { escapes } = watchForEscapes(page)
    await page.goto('/lab')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    assertNothingEscaped(escapes)
  })
})
