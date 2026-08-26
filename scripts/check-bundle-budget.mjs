#!/usr/bin/env node
/**
 * T119 / SC-008 — the initial-route JavaScript budget, enforced.
 *
 * plan.md states "initial route JavaScript under 200 KB compressed, with TensorFlow.js
 * and the backbone lazy-loaded on first entry to the lab", and the constitution says a
 * change that regresses a stated performance target is a defect rather than a
 * regrettable trade. A number in a plan document is not a gate, so this is one.
 *
 * It measures what the browser actually downloads for the first paint: `index.html`
 * plus every script it references directly, gzipped. That is deliberately narrower
 * than "the dist directory" — the lab chunk, the lessons content and TensorFlow.js are
 * all lazy and none of them is charged here — and deliberately wider than "the entry
 * chunk", because a static import graph reachable from the entry is downloaded whether
 * or not the code runs.
 *
 * It also asserts the *negative*: TensorFlow.js must NOT be in the initial graph. That
 * is the check with teeth. A stray top-level `import * as tf` in a shared component
 * would add 286 KB gzipped and still leave this budget passing if the budget were the
 * only assertion, because the number would simply be re-baselined by whoever hit it.
 */

import { gzipSync } from 'node:zlib'
import { readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

/** plan.md's figure, in bytes of gzip. */
const BUDGET_BYTES = 200 * 1024

/**
 * Modules that must be lazy. Each is named with the reason, because a future
 * contributor hitting this list needs to know whether to code-split or to argue.
 */
const MUST_BE_LAZY = [
  ['@tensorflow/tfjs', 'the ML runtime — 286 KB gzipped, needed only inside the lab'],
  ['@supabase/supabase-js', 'the account client — an anonymous visitor never calls it (FR-023)'],
]

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exitCode = 1
}

let html
try {
  html = readFileSync(join(DIST, 'index.html'), 'utf8')
} catch {
  fail('No dist/index.html. Run `npm run build` first.')
  process.exit(1)
}

// Only scripts the HTML references directly. A `modulepreload` is also downloaded
// eagerly, so it counts; a dynamic import is not in the HTML at all and does not.
const referenced = [
  ...html.matchAll(/<script[^>]+src="([^"]+)"/g),
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g),
].map((match) => match[1].replace(/^\//, ''))

if (referenced.length === 0) {
  fail('dist/index.html references no scripts, so this check asserted nothing.')
  process.exit(1)
}

let total = 0
const parts = []

for (const path of new Set(referenced)) {
  const absolute = join(DIST, path)
  let raw
  try {
    raw = readFileSync(absolute)
  } catch {
    fail(`dist/index.html references ${path}, which does not exist.`)
    continue
  }
  const compressed = gzipSync(raw).length
  total += compressed
  parts.push({ path, raw: statSync(absolute).size, compressed })
}

parts.sort((a, b) => b.compressed - a.compressed)

console.log('\nInitial-route JavaScript (gzipped):')
for (const part of parts) {
  console.log(`  ${(part.compressed / 1024).toFixed(2).padStart(8)} KB  ${part.path}`)
}
console.log(`  ${'─'.repeat(8)}`)
console.log(
  `  ${(total / 1024).toFixed(2).padStart(8)} KB  total (budget ${String(BUDGET_BYTES / 1024)} KB)\n`,
)

if (total > BUDGET_BYTES) {
  fail(
    `The initial route is ${(total / 1024).toFixed(2)} KB gzipped, over the ${String(BUDGET_BYTES / 1024)} KB ` +
      'budget in plan.md. SC-008 gives the first route three seconds on a mid-range phone, and the ' +
      'constitution treats a regressed performance target as a defect. Code-split rather than ' +
      're-baselining this number.',
  )
}

// The negative assertion, which is the one with teeth.
const initialSource = parts
  .map((part) => readFileSync(join(DIST, part.path), 'utf8'))
  .join('\n')

for (const [module, why] of MUST_BE_LAZY) {
  // Markers are chosen to be library-specific class and error names, which survive
  // minification because they appear as strings. A bare package name would not do:
  // "supabase" is legitimately in the entry as part of `VITE_SUPABASE_URL`, and
  // matching it reported a false failure the first time this ran.
  const markers = {
    '@tensorflow/tfjs': /Tensor is disposed|backend_webgl|kernel_impls|tfjs-core/,
    '@supabase/supabase-js': /GoTrueClient|PostgrestClient|SupabaseAuthClient|AuthApiError/,
  }[module]

  if (markers.test(initialSource)) {
    fail(
      `${module} appears in the initial-route bundle. It must be lazily imported — ${why}. ` +
        'Look for a top-level `import` of it in a module the entry reaches statically.',
    )
  }
}

if (process.exitCode !== 1) {
  console.log('✓ Initial route within budget, and the heavy modules are lazy.\n')
}
