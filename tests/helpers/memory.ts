import * as tf from '@tensorflow/tfjs'
import { afterEach, beforeEach, expect } from 'vitest'

/**
 * T020 / R8: tensor-leak assertion.
 *
 * Every exported function in src/ml/ must leave tf.memory().numTensors unchanged, except
 * those documented to return a disposable handle. This matters more here than in a
 * typical application: the lab runs live inference at 10 fps on a low-end Chromebook, so
 * a single tensor leaked per frame exhausts GPU memory within a minute of a learner
 * pointing a camera at herself. That failure looks like "the lab froze", which nobody
 * would trace back to a missing tf.tidy.
 *
 * Use `expectNoTensorLeak()` inside a describe block to wrap every test in it.
 */
export function expectNoTensorLeak(options: { allow?: number } = {}): void {
  const allow = options.allow ?? 0
  let before = 0

  beforeEach(() => {
    before = tf.memory().numTensors
  })

  afterEach(() => {
    const after = tf.memory().numTensors
    const leaked = after - before
    expect(
      leaked,
      `leaked ${String(leaked)} tensor(s): ${String(before)} before, ${String(after)} after. ` +
        `Wrap the body in tf.tidy, or dispose the handle the function returned (R8).`,
    ).toBeLessThanOrEqual(allow)
  })
}

/** Runs a function and returns how many tensors it leaked, for a targeted assertion. */
export async function countLeakedTensors(fn: () => Promise<void> | void): Promise<number> {
  const before = tf.memory().numTensors
  await fn()
  return tf.memory().numTensors - before
}
