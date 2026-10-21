import { CircleCheck, CircleX } from 'lucide-react'
import { Badge } from '@/components/ui'
import { Markdown } from '@/components/Markdown'
import { cn } from '@/lib/cn'
import type { QuizQuestion } from '@/types/content'
import { SpeakButton } from '@/components/SpeakButton'
import { correctAnswerText, fillBlank } from '../lib/quiz'

/** Result panel shown once a question is graded: verdict, correct answer, explanation. */
export function AnswerFeedback({ question, correct }: { question: QuizQuestion; correct: boolean }) {
  const answer = correctAnswerText(question)
  const Icon = correct ? CircleCheck : CircleX
  return (
    <div
      className={cn(
        'animate-slide-up rounded-2xl border p-4 sm:p-5',
        correct
          ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30'
          : 'border-rose-200 bg-rose-50/70 dark:border-rose-900/60 dark:bg-rose-950/30',
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 size-5 shrink-0', correct ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn('font-bold', correct ? 'text-emerald-800 dark:text-emerald-200' : 'text-rose-800 dark:text-rose-200')}>
              {correct ? 'Correct!' : 'Not quite'}
            </p>
            {question.collocation_type ? <Badge>{question.collocation_type}</Badge> : null}
          </div>
          {correct ? null : (
            <p className="text-sm text-slate-700 dark:text-slate-200">
              Answer: <strong className="font-semibold text-emerald-700 dark:text-emerald-300">{answer}</strong>
            </p>
          )}
          {question.explanation ? (
            <Markdown className="text-slate-600 dark:text-slate-300">{question.explanation}</Markdown>
          ) : null}
        </div>
        <SpeakButton text={fillBlank(question.sentence, answer)} label="Listen to the sentence" />
      </div>
    </div>
  )
}
