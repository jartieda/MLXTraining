import { describe, it, expect } from 'vitest'

/**
 * Phase 1 checkpoint guard. Its job is not to test behaviour - there is none yet - but
 * to prove the toolchain actually runs, so that "typecheck, lint and test pass" is a
 * verified statement rather than a vacuous one.
 *
 * The environment assertion is the part worth keeping: it fails if the default Vitest
 * environment is ever switched to jsdom, which would silently let a DOM dependency into
 * src/ml/ and make the deterministic ML tests impossible to run (Principle VI).
 */
describe('phase 1 scaffold', () => {
  it('runs the test toolchain', () => {
    expect(1 + 1).toBe(2)
  })

  it('defaults to a DOM-free environment so the ML core stays testable', () => {
    expect(typeof globalThis.document).toBe('undefined')
  })
})
