import * as tf from '@tensorflow/tfjs'
import type { BackendKind, BackendReport } from './types'

/**
 * T017 / R7 / FR-047 / SC-012 — backend selection.
 *
 * The contract's hardest requirement is **never throws**. SC-012 makes the
 * no-acceleration path a supported degradation rather than an error: a learner on a
 * school Chromebook with broken WebGL drivers must get a slower lab, not a blank screen.
 * Every failure below is therefore caught and turned into the next attempt, and the worst
 * case is a report of `cpu`.
 *
 * The result is memoised because `tf.setBackend` is expensive — it compiles shaders on the
 * WebGL path — and because a second, different answer part-way through a session would
 * mean tensors allocated on one backend and read on another.
 */

const PREFERENCE_ORDER: readonly BackendKind[] = ['webgl', 'wasm', 'cpu']

let cached: BackendReport | null = null
let inFlight: Promise<BackendReport> | null = null
let wasmRegistered = false

/**
 * The WASM backend registers itself as a side effect of being imported, and the import is
 * dynamic so that a device with working WebGL never downloads the `.wasm` binary
 * (SC-008's 3 s budget on a mid-range phone). Failure here is not fatal — it simply means
 * `wasm` is unavailable and the chain moves on to `cpu`.
 */
async function registerWasm(): Promise<boolean> {
  if (wasmRegistered) return true
  try {
    await import('@tensorflow/tfjs-backend-wasm')
    wasmRegistered = true
    return true
  } catch {
    return false
  }
}

async function tryBackend(kind: BackendKind): Promise<boolean> {
  try {
    if (kind === 'wasm' && !(await registerWasm())) return false

    // `setBackend` resolves `false` for an unregistered or failing backend, but it can
    // also throw on some WebGL context-loss paths, so both are handled.
    const ok = await tf.setBackend(kind)
    if (!ok) return false
    await tf.ready()

    // `setBackend` succeeding is not proof the backend works: a WebGL context can be
    // created and then fail on first use. One tiny real operation is the cheapest honest
    // check, and it is what stops a broken driver reporting itself as accelerated.
    const probe = tf.tidy(() => tf.scalar(1).add(tf.scalar(1)).dataSync()[0])
    if (probe !== 2) return false

    return tf.getBackend() === kind
  } catch {
    return false
  }
}

/**
 * Selects webgl → wasm → cpu. Idempotent: a second call returns the same report without
 * re-initialising. Never throws.
 */
export async function initBackend(preferred?: BackendKind): Promise<BackendReport> {
  if (cached) return cached
  // Concurrent callers — the lab entry route and a warm-up effect, say — must not race
  // two `setBackend` sequences against each other.
  if (inFlight) return inFlight

  const order: BackendKind[] = preferred
    ? [preferred, ...PREFERENCE_ORDER.filter((k) => k !== preferred)]
    : [...PREFERENCE_ORDER]

  inFlight = (async () => {
    const attempted: BackendKind[] = []

    for (const kind of order) {
      attempted.push(kind)
      if (await tryBackend(kind)) {
        cached = { active: kind, accelerated: kind === 'webgl', attempted }
        return cached
      }
    }

    // Every candidate failed, which should be impossible — `cpu` is pure JavaScript and
    // always registered. Report it anyway rather than throwing: the contract says this
    // function does not throw, and a report of `cpu` degrades gracefully where a
    // rejection would take the whole lab down.
    cached = {
      active: 'cpu',
      accelerated: false,
      attempted: attempted.includes('cpu') ? attempted : [...attempted, 'cpu'],
    }
    return cached
  })().finally(() => {
    inFlight = null
  })

  return inFlight
}

/** The memoised report, or `null` before `initBackend` has resolved. */
export function currentBackend(): BackendReport | null {
  return cached
}

/** Test-only: drops the memoised report so a fresh selection can be asserted. */
export function resetBackendForTesting(): void {
  cached = null
  inFlight = null
}
