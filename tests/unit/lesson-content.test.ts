import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LESSON_MODULES, MODULE_BY_ID, previousModule } from '@/content/lessons/modules'
import { MODULE_IDS, moduleKey, questionKey, stepKey } from '@/content/lessons/schema'

/**
 * T093 / FR-033, FR-034 — the content invariants.
 *
 * FR-034 gives every module four obligations — a goal, steps in the lab, a challenge,
 * and at least one reflection question — and FR-033 fixes which seven modules exist.
 * Neither is checkable by looking at a screen: a module missing its challenge renders
 * as a heading with nothing under it, which looks like a styling bug, and a module
 * missing its Spanish text renders a raw key path to a Spanish-speaking learner and
 * to nobody else.
 *
 * So this walks the structure against **both** locale files on disk. Reading the JSON
 * rather than importing the module is deliberate and copied from the i18n test's
 * reasoning: importing would only check what the code happens to reference, and the
 * omission most likely to happen is a key nothing references yet.
 */

const LOCALES = ['en', 'es'] as const
const LOCALES_DIR = fileURLToPath(new URL('../../src/locales', import.meta.url))

type Json = Record<string, unknown>

function readLessons(locale: string): Json {
  return JSON.parse(readFileSync(join(LOCALES_DIR, locale, 'lessons.json'), 'utf8')) as Json
}

/** Resolves a dotted path, treating a hyphenated module id as one segment. */
function at(tree: Json, path: string): unknown {
  let node: unknown = tree
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Json)[segment]
  }
  return node
}

const CONTENT = Object.fromEntries(LOCALES.map((locale) => [locale, readLessons(locale)])) as Record<
  (typeof LOCALES)[number],
  Json
>

describe('FR-033: the seven modules exist, in teaching order', () => {
  it('declares exactly the seven modules FR-033 names', () => {
    expect(LESSON_MODULES).toHaveLength(7)
    expect(LESSON_MODULES.map((module) => module.id)).toEqual([...MODULE_IDS])
  })

  it('numbers them 1 to 7 with no gaps and no duplicates', () => {
    // `order` drives the displayed number and the previous-module link, so a
    // duplicate would render two "Module 3 of 7" headings.
    expect(LESSON_MODULES.map((module) => module.order)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('keeps the arc FR-033 specifies: bias is claimed before it is proved', () => {
    const order = (id: string) => LESSON_MODULES.find((module) => module.id === id)?.order ?? 0
    // "Shortcuts and bias" is the claim; "fooling the model" is the learner proving
    // it herself. Reversed, the finding becomes a party trick.
    expect(order('shortcuts-and-bias')).toBeLessThan(order('fooling-the-model'))
    // The comparison module must follow the single-map one, or she is asked to
    // compare two things before she can read one.
    expect(order('reading-a-heat-map')).toBeLessThan(order('comparing-explanations'))
    // The presentation is last, because it presents everything before it.
    expect(order('final-presentation')).toBe(7)
  })

  it('links each module back to the one before it, and the first to nothing', () => {
    expect(previousModule('what-the-model-sees')).toBeNull()
    expect(previousModule('final-presentation')?.id).toBe('imbalance-experiment')
  })

  it('only the imbalance module embeds the run comparison (FR-036)', () => {
    const withComparison = LESSON_MODULES.filter((module) => module.showsRunComparison)
    expect(withComparison.map((module) => module.id)).toEqual(['imbalance-experiment'])
  })
})

describe('FR-034: every module has all four parts, in both locales', () => {
  for (const module of LESSON_MODULES) {
    describe(module.id, () => {
      it('has at least one step and at least one reflection question', () => {
        expect(module.steps.length).toBeGreaterThan(0)
        // FR-034's floor. A module with no question is a tutorial, not a lesson.
        expect(module.questionIds.length).toBeGreaterThan(0)
      })

      it('has unique step slugs', () => {
        // `completed_steps` is a set of slugs, so a duplicate would make one tick
        // silently complete two steps.
        const slugs = module.steps.map((step) => step.slug)
        expect(new Set(slugs).size).toBe(slugs.length)
      })

      it('has unique question ids', () => {
        // L4's unique constraint is on (learner, module, question); a duplicate id
        // would make two questions overwrite each other's answers.
        expect(new Set(module.questionIds).size).toBe(module.questionIds.length)
      })

      for (const locale of LOCALES) {
        it(`${locale}: has a title, a goal, an intro and a challenge`, () => {
          const key = moduleKey(module.id)
          for (const part of ['title', 'goal', 'intro', 'challenge']) {
            const value = at(CONTENT[locale], `${key}.${part}`)
            expect(typeof value, `${locale} ${module.id}.${part}`).toBe('string')
            expect((value as string).length, `${locale} ${module.id}.${part} is empty`).toBeGreaterThan(
              10,
            )
          }
        })

        it(`${locale}: has a title and a body for every step`, () => {
          for (const step of module.steps) {
            for (const part of ['title', 'body']) {
              const value = at(CONTENT[locale], `${stepKey(module.id, step.slug)}.${part}`)
              expect(typeof value, `${locale} ${module.id}/${step.slug}.${part}`).toBe('string')
            }
          }
        })

        it(`${locale}: has text for every reflection question`, () => {
          for (const questionId of module.questionIds) {
            const value = at(CONTENT[locale], questionKey(module.id, questionId))
            expect(typeof value, `${locale} ${module.id}/${questionId}`).toBe('string')
            // A question. Answering "what did you notice" needs a question mark to
            // read as one, and every one of these is phrased as a question.
            expect(value as string).toMatch(/[?¿]/)
          }
        })
      }
    })
  }
})

describe('FR-037: every prerequisite names a step that actually exists', () => {
  it('points at a real module and a real step slug', () => {
    // This is the assertion that matters most in the file. A prerequisite pointing
    // at a slug that no longer exists renders a link whose label is a raw i18n key,
    // in the one place a stuck learner is looking for help.
    for (const module of LESSON_MODULES) {
      for (const prerequisite of module.challengeRequires) {
        const target = MODULE_BY_ID.get(prerequisite.satisfiedBy.moduleId)
        expect(target, `${module.id} points at unknown module`).toBeDefined()
        expect(
          target?.steps.some((step) => step.slug === prerequisite.satisfiedBy.stepSlug),
          `${module.id} requires ${prerequisite.kind}, said to come from ` +
            `${prerequisite.satisfiedBy.moduleId}/${prerequisite.satisfiedBy.stepSlug}, which has no such step`,
        ).toBe(true)
      }
    }
  })

  it('never points forward to a later module', () => {
    // A prerequisite satisfied by a step in a *later* module is a loop: she cannot
    // start module 3 until she finishes module 5, which needs module 3.
    for (const module of LESSON_MODULES) {
      for (const prerequisite of module.challengeRequires) {
        const target = MODULE_BY_ID.get(prerequisite.satisfiedBy.moduleId)
        expect(
          target?.order ?? 0,
          `${module.id} (order ${String(module.order)}) requires something from ` +
            `${prerequisite.satisfiedBy.moduleId} (order ${String(target?.order ?? 0)})`,
        ).toBeLessThanOrEqual(module.order)
      }
    }
  })

  it('has a sentence for every capability kind it uses', () => {
    const used = new Set(
      LESSON_MODULES.flatMap((module) => module.challengeRequires.map((need) => need.kind)),
    )
    for (const locale of LOCALES) {
      for (const kind of used) {
        expect(typeof at(CONTENT[locale], `prerequisite.${kind}`), `${locale} prerequisite.${kind}`).toBe(
          'string',
        )
      }
    }
  })

  it('interpolates a count only where the sentence has a placeholder', () => {
    // `samplesPerClass` is the one kind with a threshold. If its sentence lost the
    // placeholder the learner would be told "you need at least photos in every class".
    const sentence = at(CONTENT.en, 'prerequisite.samplesPerClass')
    expect(sentence).toMatch(/\{\{count}}/)

    for (const module of LESSON_MODULES) {
      for (const need of module.challengeRequires) {
        if (need.kind === 'samplesPerClass') {
          expect(need.count, `${module.id} asks for samplesPerClass with no count`).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('the locale file carries no orphaned module content', () => {
  it('has no module block that the code does not declare', () => {
    for (const locale of LOCALES) {
      const modules = at(CONTENT[locale], 'modules') as Json
      const declared = new Set<string>(MODULE_IDS)
      const orphans = Object.keys(modules).filter((id) => !declared.has(id))
      // An orphaned block is content nobody will ever see — either a typo in an id,
      // or a module deleted from the code and left behind in the translation.
      expect(orphans, `orphaned modules in ${locale}/lessons.json`).toEqual([])
    }
  })

  it('has no step or question block the code does not declare', () => {
    for (const locale of LOCALES) {
      for (const module of LESSON_MODULES) {
        const block = at(CONTENT[locale], moduleKey(module.id)) as Json
        const steps = Object.keys(block.steps ?? {})
        const questions = Object.keys(block.questions ?? {})

        expect(steps.sort()).toEqual(module.steps.map((step) => step.slug).sort())
        expect(questions.sort()).toEqual([...module.questionIds].sort())
      }
    }
  })
})
