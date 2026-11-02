/* eslint-disable @typescript-eslint/require-await -- async fakes mirror the real engine signature */
import { describe, expect, it } from 'vitest'
import { AUDIT_PAIRS, runAudit, summarizeAudit, type AuditRow } from '@/features/llmLab/compare/audit'

const OPTIONS = [
  { letter: 'A', text: 'Sí' },
  { letter: 'B', text: 'No' },
]
const row = (a: number | null, b: number | null): AuditRow => ({
  pair: AUDIT_PAIRS[0]!,
  a,
  b,
  delta: a !== null && b !== null ? b - a : null,
})

describe('bias audit', () => {
  it('has five pairs, each name with the gender the Spanish template agrees with', () => {
    expect(AUDIT_PAIRS).toHaveLength(5)
    for (const pair of AUDIT_PAIRS) {
      expect(['f', 'm']).toContain(pair.a.gender)
      expect(['f', 'm']).toContain(pair.b.gender)
      expect(pair.a.name).not.toBe(pair.b.name)
    }
  })

  it('averages the size of the differences, whichever way they go', () => {
    const summary = summarizeAudit([row(0.6, 0.8), row(0.8, 0.7), row(0.5, 0.5)])
    expect(summary.meanAbsDelta).toBeCloseTo(0.1)
    expect(summary.largest?.delta).toBeCloseTo(0.2)
    expect(summary.noticeable).toBe(2)
    expect(summary.band).toBe('small')
  })

  it('leaves out pairs it could not measure, and says so when none could be', () => {
    expect(summarizeAudit([row(0.6, 0.6), row(null, 0.7)]).measured).toBe(1)
    expect(summarizeAudit([row(null, null)]).band).toBe('unknown')
  })

  it('asks once per name and reads the probability of «Sí»', async () => {
    const prompts: string[] = []
    const rows = await runAudit(
      {
        nextTokenAlternatives: async (prompt) => {
          prompts.push(prompt)
          return [{ token: 'A', logprob: Math.log(prompt.includes('Javier') ? 0.8 : 0.6) }]
        },
      },
      AUDIT_PAIRS.slice(0, 2),
      (person) => `${person.name} (${person.gender})`,
      OPTIONS,
      'A',
      'Responde solo con la letra.',
      () => undefined,
    )
    expect(prompts).toHaveLength(4)
    expect(prompts[0]).toContain('Lucía (f)')
    expect(rows[0]?.delta).toBeCloseTo(0.2)
    expect(rows[1]?.delta).toBeCloseTo(0)
  })

  it('stops between pairs when asked to', async () => {
    const controller = new AbortController()
    let calls = 0
    await expect(
      runAudit(
        {
          nextTokenAlternatives: async () => {
            calls += 1
            if (calls === 2) controller.abort()
            return [{ token: 'A', logprob: Math.log(0.7) }]
          },
        },
        AUDIT_PAIRS,
        (person) => person.name,
        OPTIONS,
        'A',
        '',
        () => undefined,
        controller.signal,
      ),
    ).rejects.toThrow()
    expect(calls).toBe(2)
  })
})
