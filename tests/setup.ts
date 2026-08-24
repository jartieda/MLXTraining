/**
 * Runs before every Vitest file, in both the node and jsdom environments.
 *
 * jest-dom's matchers are only meaningful with a DOM, so they are registered lazily.
 * Importing them unconditionally would pull a DOM dependency into the node environment
 * that src/ml/ is tested in, which is exactly what Principle VI forbids.
 */
if (typeof globalThis.document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
}
