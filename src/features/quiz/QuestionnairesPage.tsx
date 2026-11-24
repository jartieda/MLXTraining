import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ProjectQuestions } from './ProjectQuestions'

export function QuestionnairesPage() {
  const { t } = useTranslation('home')

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <img src="/icons/exam-list.png" alt="" aria-hidden="true" className="size-16 shrink-0 object-contain" />
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl">{t('questionnaires.title')}</h1>
          <p className="max-w-prose text-sm text-ink-muted">{t('questionnaires.intro')}</p>
        </div>
      </header>

      <section aria-labelledby="quiz-options" className="flex flex-col gap-3">
        <h2 id="quiz-options" className="font-display text-xl">{t('quizCallout.title')}</h2>
        <p className="max-w-prose text-sm text-ink-muted">{t('quizCallout.body')}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <article className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4">
            <h3 className="font-display text-lg">{t('quiz.title.pre')}</h3>
            <Link
              to="/quiz?phase=pre"
              className="flex min-h-touch w-fit items-center rounded bg-blue px-4 text-sm font-medium text-ink-inverse no-underline"
            >
              {t('quizCallout.initialCta')}
            </Link>
          </article>
          <article className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4">
            <h3 className="font-display text-lg">{t('quiz.title.post')}</h3>
            <Link
              to="/quiz?phase=post"
              className="flex min-h-touch w-fit items-center rounded bg-magenta px-4 text-sm font-medium text-ink-inverse no-underline"
            >
              {t('quizCallout.finalCta')}
            </Link>
          </article>
        </div>
      </section>

      <ProjectQuestions />
    </div>
  )
}
