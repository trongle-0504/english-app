import { RotateCcw, Settings2, Sparkles, Trophy } from 'lucide-react'
import { Badge, Button, Card, SectionTitle } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { QuizQuestion } from '@/types/content'
import { ScoreRing } from '../components/ScoreRing'
import { SpeakButton } from '@/components/SpeakButton'
import { correctAnswerText, countOutcomes, fillBlank, responseText, type QuizAnswer } from '../lib/quiz'
import { percent } from '../lib/score'
import { BlankSentence } from './BlankSentence'

function Stat({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-2.5 text-center dark:bg-slate-800/60">
      <p className={cn('text-xl font-bold tabular-nums', className)}>{value}</p>
      <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">{label}</p>
    </div>
  )
}

function ReviewItem({ question, answer, number }: { question: QuizQuestion; answer: QuizAnswer; number: number }) {
  const correct = correctAnswerText(question)
  const given = responseText(question, answer.response)
  return (
    <li className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500 tabular-nums dark:bg-slate-800 dark:text-slate-400">
        {number}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <BlankSentence sentence={question.sentence} fill={correct} tone="correct" className="text-slate-800 dark:text-slate-100" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {answer.outcome === 'skipped' ? (
            <Badge tone="amber">Skipped</Badge>
          ) : (
            <>
              Your answer: <del className="text-rose-600 decoration-rose-400 dark:text-rose-400">{given}</del>
            </>
          )}
        </p>
      </div>
      <SpeakButton text={fillBlank(question.sentence, correct)} label="Listen to the sentence" />
    </li>
  )
}

interface QuizResultsProps {
  questions: QuizQuestion[]
  answers: QuizAnswer[]
  isNewBest: boolean
  onRetryMistakes: () => void
  onRestart: () => void
  onChangeMode: () => void
}

export function QuizResults({ questions, answers, isNewBest, onRetryMistakes, onRestart, onChangeMode }: QuizResultsProps) {
  const counts = countOutcomes(answers)
  const score = percent(counts.correct, questions.length)
  const mistakes = questions.flatMap((question, i) => (answers[i].outcome === 'correct' ? [] : [{ question, answer: answers[i], number: i + 1 }]))
  const message = score === 100 ? 'Perfect score!' : score >= 80 ? 'Great work!' : score >= 50 ? 'Good effort — keep going.' : 'Keep practising!'

  return (
    <div className="animate-slide-up space-y-6">
      <Card className="p-4 sm:p-8">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <ScoreRing value={score} />
          <div className="flex-1 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">{message}</h2>
              {isNewBest ? (
                <Badge tone="amber">
                  <Trophy className="size-3" aria-hidden />
                  New best
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-slate-500 dark:text-slate-400">
              You got <strong className="text-slate-800 dark:text-slate-100">{counts.correct}</strong> of {questions.length} right.
            </p>
            <div className="mt-4 grid max-w-sm grid-cols-3 gap-2 max-sm:mx-auto">
              <Stat label="Correct" value={counts.correct} className="text-emerald-600 dark:text-emerald-400" />
              <Stat label="Wrong" value={counts.wrong} className="text-rose-600 dark:text-rose-400" />
              <Stat label="Skipped" value={counts.skipped} className="text-amber-600 dark:text-amber-400" />
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2 border-t border-slate-100 pt-6 sm:justify-start dark:border-slate-800">
          {mistakes.length ? (
            <Button onClick={onRetryMistakes}>
              <Sparkles className="size-4" />
              Retry wrong only ({mistakes.length})
            </Button>
          ) : null}
          <Button variant={mistakes.length ? 'outline' : 'primary'} onClick={onRestart}>
            <RotateCcw className="size-4" />
            Try again
          </Button>
          <Button variant="ghost" onClick={onChangeMode}>
            <Settings2 className="size-4" />
            Change mode
          </Button>
        </div>
      </Card>

      {mistakes.length ? (
        <section>
          <SectionTitle count={mistakes.length}>Review</SectionTitle>
          <Card className="p-4 sm:p-6">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {mistakes.map((item) => (
                <ReviewItem key={item.number} {...item} />
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </div>
  )
}
