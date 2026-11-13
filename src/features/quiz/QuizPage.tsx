import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { TextLink } from '@/components/TextLink'
import {
  attemptFileName,
  attemptsToCsv,
  clearAttempts,
  downloadText,
  IDK,
  LIKERT_ITEMS,
  LIKERT_SCALE,
  loadAttempts,
  normalizeCode,
  OPTION_IDS,
  QUIZ_ITEMS,
  QUIZ_VERSION,
  saveAttempt,
  scoreAttempt,
  type Choice,
  type QuizAttempt,
  type QuizPhase,
} from './quiz'

/**
 * The learning questionnaire page: who is answering (an anonymous code, never a name),
 * the questions, and the file to hand in. The same items before and after, in the same
 * order. Correct answers are shown only after the «post» attempt, so the «pre» attempt
 * does not teach the answers.
 */
export function QuizPage() {
  const { t, i18n } = useTranslation('home')
  const [stage, setStage] = useState<'start' | 'questions' | 'done'>('start')
  const [participant, setParticipant] = useState('')
  const [group, setGroup] = useState('')
  const [phase, setPhase] = useState<QuizPhase>('pre')
  const [startedAt, setStartedAt] = useState('')
  const [answers, setAnswers] = useState<Record<string, Choice | null>>({})
  const [likert, setLikert] = useState<Record<string, number | null>>({})
  const [openAnswer, setOpenAnswer] = useState('')
  const [finished, setFinished] = useState<QuizAttempt | null>(null)
  const [stored, setStored] = useState(() => loadAttempts().length)

  const answeredCount = QUIZ_ITEMS.filter((item) => answers[item.id]).length

  function start() {
    setStartedAt(new Date().toISOString())
    setAnswers({})
    setLikert({})
    setOpenAnswer('')
    setStage('questions')
    window.scrollTo({ top: 0 })
  }

  function finish() {
    const attempt: QuizAttempt = {
      id: crypto.randomUUID(),
      version: QUIZ_VERSION,
      participant,
      group,
      phase,
      language: i18n.resolvedLanguage ?? i18n.language,
      startedAt,
      finishedAt: new Date().toISOString(),
      answers: Object.fromEntries(QUIZ_ITEMS.map((item) => [item.id, answers[item.id] ?? null])),
      likert: Object.fromEntries(LIKERT_ITEMS.map((item) => [item.id, likert[item.id] ?? null])),
      openAnswer: openAnswer.trim(),
    }
    saveAttempt(attempt)
    setStored(loadAttempts().length)
    setFinished(attempt)
    setStage('done')
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <TextLink to="/">{t('quiz.back')}</TextLink>
        <h1 className="font-display text-3xl">{t('quiz.title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('quiz.intro')}</p>
      </header>

      {stage === 'start' ? (
        <form
          className="flex max-w-xl flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            start()
          }}
        >
          <p className="rounded-lg bg-sky-100 p-3 text-sm text-navy">{t('quiz.research')}</p>
          <label className="flex flex-col gap-1">
            <span className="font-medium">{t('quiz.participantLabel')}</span>
            <span className="text-sm text-ink-muted">{t('quiz.participantHint')}</span>
            <input
              value={participant}
              required
              onChange={(event) => {
                setParticipant(normalizeCode(event.target.value))
              }}
              className="min-h-touch rounded border border-border-subtle bg-surface px-2 font-mono"
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">{t('quiz.groupLabel')}</span>
            <span className="text-sm text-ink-muted">{t('quiz.groupHint')}</span>
            <input
              value={group}
              onChange={(event) => {
                setGroup(normalizeCode(event.target.value))
              }}
              className="min-h-touch rounded border border-border-subtle bg-surface px-2 font-mono"
              autoComplete="off"
            />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-medium">{t('quiz.phaseLabel')}</legend>
            {(['pre', 'post'] as const).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="phase"
                  checked={phase === value}
                  onChange={() => {
                    setPhase(value)
                  }}
                />
                {t(`quiz.phase.${value}`)}
              </label>
            ))}
          </fieldset>
          <div>
            <Button type="submit" disabled={participant.length === 0}>
              {t('quiz.start')}
            </Button>
          </div>
        </form>
      ) : null}

      {stage === 'questions' ? (
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            finish()
          }}
        >
          <p className="text-sm text-ink-muted">
            {t('quiz.who', { participant, phase: t(`quiz.phase.${phase}`) })}
          </p>
          <ol className="flex list-none flex-col gap-4 p-0">
            {QUIZ_ITEMS.map((item, index) => (
              <li key={item.id}>
                <fieldset className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4" data-testid={`quiz-${item.id}`}>
                  <legend className="px-1 font-medium">
                    {index + 1}. {t(`quiz.items.${item.id}.question`)}
                  </legend>
                  {([...OPTION_IDS, IDK] as const).map((option: Choice) => (
                    <label key={option} className="flex min-h-touch items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name={item.id}
                        value={option}
                        className="mt-1"
                        checked={answers[item.id] === option}
                        onChange={() => {
                          setAnswers((current) => ({ ...current, [item.id]: option }))
                        }}
                      />
                      <span className={option === IDK ? 'text-ink-muted' : undefined}>
                        {option === IDK ? t('quiz.idk') : t(`quiz.items.${item.id}.${option}`)}
                      </span>
                    </label>
                  ))}
                </fieldset>
              </li>
            ))}
          </ol>

          <section aria-labelledby="quiz-likert" className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4">
            <h2 id="quiz-likert" className="font-display text-lg">{t('quiz.likertTitle')}</h2>
            <p className="text-sm text-ink-muted">{t('quiz.likertIntro')}</p>
            {LIKERT_ITEMS.map((item) => (
              <fieldset key={item.id} className="flex flex-col gap-1" data-testid={`quiz-${item.id}`}>
                <legend className="text-sm font-medium">{t(`quiz.likert.${item.id}`)}</legend>
                <div className="flex flex-wrap gap-3">
                  {LIKERT_SCALE.map((value) => (
                    <label key={value} className="flex min-h-touch items-center gap-1 text-sm">
                      <input
                        type="radio"
                        name={item.id}
                        checked={likert[item.id] === value}
                        onChange={() => {
                          setLikert((current) => ({ ...current, [item.id]: value }))
                        }}
                      />
                      {value} <span className="text-ink-muted">{t(`quiz.scale.${value}`)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </section>

          <label className="flex flex-col gap-1">
            <span className="font-medium">{t('quiz.openQuestion')}</span>
            <textarea
              rows={4}
              value={openAnswer}
              onChange={(event) => {
                setOpenAnswer(event.target.value)
              }}
              className="rounded border border-border-subtle bg-surface px-2 py-1"
            />
          </label>

          <div className="flex flex-col gap-2">
            {answeredCount < QUIZ_ITEMS.length ? (
              <p className="text-sm text-ink-muted">{t('quiz.unanswered', { count: QUIZ_ITEMS.length - answeredCount })}</p>
            ) : null}
            <div>
              <Button type="submit">{t('quiz.finish')}</Button>
            </div>
          </div>
        </form>
      ) : null}

      {stage === 'done' && finished ? <QuizDone attempt={finished} /> : null}

      <details className="rounded-lg border border-border-subtle p-4 text-sm">
        <summary className="cursor-pointer font-medium">{t('quiz.teacher.title')}</summary>
        <div className="mt-3 flex flex-col gap-2">
          <p className="max-w-prose text-ink-muted">{t('quiz.teacher.body', { count: stored })}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={stored === 0}
              onClick={() => {
                const all = loadAttempts()
                downloadText(attemptsToCsv(all), attemptFileName(all, 'csv'), 'text/csv;charset=utf-8')
              }}
            >
              {t('quiz.teacher.downloadAll')}
            </Button>
            <Button
              variant="secondary"
              disabled={stored === 0}
              onClick={() => {
                if (window.confirm(t('quiz.teacher.clearConfirm', { count: stored }))) {
                  clearAttempts()
                  setStored(0)
                }
              }}
            >
              {t('quiz.teacher.clear')}
            </Button>
          </div>
        </div>
      </details>
    </div>
  )
}

function QuizDone({ attempt }: { readonly attempt: QuizAttempt }) {
  const { t } = useTranslation('home')
  const score = scoreAttempt(attempt.answers)

  return (
    <section aria-labelledby="quiz-done" className="flex flex-col gap-4" data-testid="quiz-done">
      <h2 id="quiz-done" className="font-display text-2xl">{t('quiz.doneTitle')}</h2>
      <p className="max-w-prose">{t(`quiz.doneBody.${attempt.phase}`)}</p>
      <div className="flex flex-col gap-2 rounded-lg border-l-4 border-magenta bg-surface-sunken p-4">
        <p className="font-medium">{t('quiz.handIn')}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              downloadText(attemptsToCsv([attempt]), attemptFileName([attempt], 'csv'), 'text/csv;charset=utf-8')
            }}
          >
            {t('quiz.downloadCsv')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              downloadText(JSON.stringify(attempt, null, 2), attemptFileName([attempt], 'json'), 'application/json')
            }}
          >
            {t('quiz.downloadJson')}
          </Button>
        </div>
      </div>

      {attempt.phase === 'post' ? (
        <section aria-labelledby="quiz-review" className="flex flex-col gap-3">
          <h3 id="quiz-review" className="font-display text-lg" data-testid="quiz-score">
            {t('quiz.score', { correct: score.correct, total: score.total })}
          </h3>
          <ol className="flex list-none flex-col gap-2 p-0">
            {QUIZ_ITEMS.map((item, index) => {
              const answer = attempt.answers[item.id] ?? null
              const right = answer === item.correct
              return (
                <li key={item.id} className="rounded border border-border-subtle p-3 text-sm">
                  <p className="font-medium">
                    {index + 1}. {t(`quiz.items.${item.id}.question`)}
                  </p>
                  <p className={right ? 'text-ink' : 'text-magenta'}>
                    {right ? t('quiz.right') : t('quiz.wrong')} {t(`quiz.items.${item.id}.${item.correct}`)}
                  </p>
                  <p className="text-ink-muted">{t(`quiz.items.${item.id}.why`)}</p>
                </li>
              )
            })}
          </ol>
        </section>
      ) : null}
    </section>
  )
}
