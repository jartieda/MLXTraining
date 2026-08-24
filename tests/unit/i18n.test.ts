import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * T013 / FR-044 / SC-005 — the translation-completeness gate.
 *
 * SC-005 requires zero untranslated strings, and no project has ever achieved that by
 * discipline: English gets added under deadline, Spanish is "caught up later", and a
 * Spanish-speaking learner meets a half-English interface. This test makes that a red
 * build instead.
 *
 * It reads the locale files from disk rather than importing `resources` from
 * src/lib/i18n.ts on purpose. Importing the module would only compare what the module
 * happens to register, so a namespace added to `en/` and forgotten in the import list
 * would pass — which is precisely the omission most likely to happen.
 */

const LOCALES_DIR = join(fileURLToPath(new URL('../../src/locales', import.meta.url)))
const REFERENCE = 'en'
const TARGETS = ['es'] as const

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

function readNamespaces(locale: string): string[] {
  return readdirSync(join(LOCALES_DIR, locale))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort()
}

function readNamespace(locale: string, ns: string): Json {
  return JSON.parse(readFileSync(join(LOCALES_DIR, locale, `${ns}.json`), 'utf8')) as Json
}

/** Flattens to `a.b.c` paths, so a failure names the exact missing key. */
function flatten(value: Json, prefix = ''): Map<string, Json> {
  const out = new Map<string, Json>()
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      for (const [path, leaf] of flatten(child, prefix ? `${prefix}.${key}` : key)) {
        out.set(path, leaf)
      }
    }
    return out
  }
  out.set(prefix, value)
  return out
}

describe('locale completeness', () => {
  const referenceNamespaces = readNamespaces(REFERENCE)

  it('ships at least one namespace to compare', () => {
    expect(referenceNamespaces.length).toBeGreaterThan(0)
  })

  for (const target of TARGETS) {
    describe(`${REFERENCE} → ${target}`, () => {
      it('has the same set of namespace files', () => {
        expect(readNamespaces(target)).toEqual(referenceNamespaces)
      })

      for (const ns of referenceNamespaces) {
        it(`${ns}: every key present in ${REFERENCE} exists in ${target}`, () => {
          const reference = flatten(readNamespace(REFERENCE, ns))
          const translated = flatten(readNamespace(target, ns))

          const missing = [...reference.keys()].filter((k) => !translated.has(k))
          expect(missing, `missing in ${target}/${ns}.json: ${missing.join(', ')}`).toEqual([])
        })

        it(`${ns}: ${target} has no key absent from ${REFERENCE}`, () => {
          // The reverse direction matters too: an orphaned Spanish key is either a typo
          // that renders as a raw key path, or a string whose English original was
          // deleted. Both are defects, and neither is visible from the interface.
          const reference = flatten(readNamespace(REFERENCE, ns))
          const translated = flatten(readNamespace(target, ns))

          const orphaned = [...translated.keys()].filter((k) => !reference.has(k))
          expect(orphaned, `orphaned in ${target}/${ns}.json: ${orphaned.join(', ')}`).toEqual([])
        })

        it(`${ns}: no ${target} value is left as its ${REFERENCE} placeholder`, () => {
          // A copied-but-untranslated string is worse than a missing one: the missing key
          // is caught above, while a copy renders as confident English. Short shared
          // tokens are genuinely identical across the two languages, so only values long
          // enough to be a sentence are compared.
          const reference = flatten(readNamespace(REFERENCE, ns))
          const translated = flatten(readNamespace(target, ns))

          const untranslated = [...reference.entries()]
            .filter(([key, value]) => {
              if (typeof value !== 'string' || value.length < 25) return false
              return translated.get(key) === value
            })
            .map(([key]) => key)

          expect(
            untranslated,
            `identical to ${REFERENCE} in ${target}/${ns}.json: ${untranslated.join(', ')}`,
          ).toEqual([])
        })

        it(`${ns}: interpolation placeholders match`, () => {
          // `{{count}}` mistyped as `{{cont}}` in translation renders the literal braces
          // to the learner. Nothing else catches it.
          const reference = flatten(readNamespace(REFERENCE, ns))
          const translated = flatten(readNamespace(target, ns))
          const mismatched: string[] = []

          for (const [key, value] of reference) {
            if (typeof value !== 'string') continue
            const other = translated.get(key)
            if (typeof other !== 'string') continue

            const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)}}/g)].map((m) => m[1]).sort()
            const a = placeholders(value)
            const b = placeholders(other)
            if (a.join(',') !== b.join(',')) mismatched.push(`${key} (${a.join(',')} vs ${b.join(',')})`)
          }

          expect(mismatched, `placeholder mismatch: ${mismatched.join('; ')}`).toEqual([])
        })
      }
    })
  }
})
