import { Check, Flag, X } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, Progress } from '@/components/ui'
import type { QuizQuestion } from '@/types/content'
import { countOutcomes, MODE_LABELS, nextOpenIndex, type QuizAnswer, type QuizMode } from '../lib/quiz'
import { QuestionNavigator } from './QuestionNavigator'
import { QuestionView } from './QuestionView'

interface QuizPlayerProps {
  mode: QuizMode
  questions: QuizQuestion[]
  /** Called with one answer per question (unanswered ones count as skipped). */
  onFinish: (answers: QuizAnswer[]) => void
}

export function QuizPlayer({ mode, questions, onFinish }: QuizPlayerProps) {
  const [answers, setAnswers] = useState<(QuizAnswer | undefined)[]>(() => questions.map(() => undefined))
  const [current, setCurrent] = useState(0)

  const counts = countOutcomes(answers)
  const answeredCount = counts.correct + counts.wrong + counts.skipped
  const nextIndex = nextOpenIndex(answers, current)

  const finish = (list = answers) => onFinish(list.map((answer) => answer ?? { response: '', outcome: 'skipped' }))

  const advance = (list = answers) => {
    const next = nextOpenIndex(list, current)
    if (next == null) finish(list)
    else setCurrent(next)
  }

  const record = (answer: QuizAnswer) => {
    const list = answers.with(current, answer)
    setAnswers(list)
    return list
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Badge tone={mode === 'multiple_choice' ? 'brand' : 'violet'}>{MODE_LABELS[mode]}</Badge>
            <span className="text-sm font-semibold text-slate-700 tabular-nums dark:text-slate-200">
              Q {current + 1} <span className="text-slate-400">/ {questions.length}</span>
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm font-semibold tabular-nums">
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400" title="Correct">
              <Check className="size-4" aria-hidden />
              {counts.correct}
              <span className="sr-only">correct</span>
            </span>
            <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400" title="Wrong">
              <X className="size-4" aria-hidden />
              {counts.wrong}
              <span className="sr-only">wrong</span>
            </span>
            <Button variant="outline" size="sm" onClick={() => finish()}>
              <Flag className="size-3.5" />
              End quiz
            </Button>
          </div>
        </div>
        <Progress value={(answeredCount / questions.length) * 100} className="mt-3" />
        <div className="mt-2">
          <QuestionNavigator answers={answers} current={current} onSelect={setCurrent} />
        </div>
      </Card>

      <QuestionView
        key={current}
        question={questions[current]}
        answer={answers[current]}
        onAnswer={record}
        onSkip={() => advance(record({ response: '', outcome: 'skipped' }))}
        onNext={() => advance()}
        isLast={nextIndex == null}
      />
    </div>
  )
}
