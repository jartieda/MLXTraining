import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { saveExperiment } from '@/features/llmLab/compare/experimentStore'
import {
  buildProjectCardMarkdown,
  EMPTY_PROJECT_CARD,
  isCardComplete,
  loadMissionProgress,
  loadProjectCard,
  MISSIONS,
  saveMissionProgress,
  saveProjectCard,
} from '@/features/llmLab/missions/missions'
import { COMPARE_PRESETS } from '@/features/llmLab/compare/presets'
import es from '@/locales/es/llm.json'
import en from '@/locales/en/llm.json'

describe('Lab LLM missions', () => {
  it('are seven, each with every text in both languages', () => {
    expect(MISSIONS).toHaveLength(7)
    for (const locale of [es, en]) {
      for (const mission of MISSIONS) {
        const item = (locale.missions.items as Record<string, Record<string, string>>)[mission.id]
        expect(item?.title, mission.id).toBeTruthy()
        expect(item?.what, mission.id).toBeTruthy()
        expect(item?.challenge, mission.id).toBeTruthy()
        expect(item?.question, mission.id).toBeTruthy()
      }
    }
  })

  it('only point at presets that exist', () => {
    const ids = new Set(COMPARE_PRESETS.map((preset) => preset.id))
    for (const mission of MISSIONS) {
      if (mission.target?.presetId) expect(ids.has(mission.target.presetId), mission.id).toBe(true)
    }
  })

  it('keep progress and the answer on the device, one change at a time', async () => {
    await saveMissionProgress('lens', { reflection: '«contenta», no me lo esperaba' })
    await saveMissionProgress('lens', { done: true })
    const progress = await loadMissionProgress()
    expect(progress.lens?.done).toBe(true)
    expect(progress.lens?.reflection).toBe('«contenta», no me lo esperaba')
  })

  it('keep the project card, empty until filled in', async () => {
    expect(await loadProjectCard()).toEqual(EMPTY_PROJECT_CARD)
    const card = { decides: 'Qué canción escuchar', affects: 'Quien la usa', biasTested: 'Nombres', explanation: 'Te recomiendo esto porque…' }
    await saveProjectCard(card)
    expect(await loadProjectCard()).toEqual(card)
    expect(isCardComplete(card)).toBe(true)
    expect(isCardComplete({ ...card, affects: '  ' })).toBe(false)
  })

  it('build a Markdown card with the fields, the answered questions and the experiments', async () => {
    const experiment = await saveExperiment({
      presetId: 'biasName',
      modelName: 'Gemma 2 · 2B',
      promptA: 'Lucía…',
      promptB: 'Javier…',
      bet: 'no',
      band: 'large',
      summary: 'La respuesta más probable es otra.',
    })
    const markdown = buildProjectCardMarkdown({
      title: 'Ficha XAI de mi proyecto',
      date: '2 de noviembre de 2026',
      fields: [
        { label: '¿Qué decide tu app?', value: 'Qué canción escuchar' },
        { label: '¿A quién afecta?', value: '' },
      ],
      reflectionsHeading: 'Lo que he aprendido',
      reflections: [
        { mission: '3. La lupa', question: '¿Qué palabra pesaba más?', answer: 'contenta' },
        { mission: '4. ¿Dice la verdad?', question: '¿Te fías?', answer: '' },
      ],
      experimentsHeading: 'Mis experimentos',
      experiments: [experiment],
      experimentLine: (item) => `${item.presetId}: ${item.summary}`,
      empty: 'Sin completar',
      footer: 'Hecha en el Lab LLM.',
    })
    expect(markdown).toContain('# Ficha XAI de mi proyecto')
    expect(markdown).toContain('## ¿Qué decide tu app?\n\nQué canción escuchar')
    expect(markdown).toContain('## ¿A quién afecta?\n\n_Sin completar_')
    expect(markdown).toContain('**3. La lupa.** ¿Qué palabra pesaba más?\n\ncontenta')
    // Unanswered questions are left out rather than listed empty.
    expect(markdown).not.toContain('¿Te fías?')
    expect(markdown).toContain('- biasName: La respuesta más probable es otra.')
  })
})
