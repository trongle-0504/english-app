import { ArrowRight, Flag, Lightbulb, SkipForward } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Badge, Button, Card, Kbd } from '@/components/ui'
import type { QuizQuestion } from '@/types/content'
import { grade, responseText, type QuizAnswer } from '../lib/quiz'
import { AnswerFeedback } from './AnswerFeedback'
import { BlankSentence } from './BlankSentence'
import { ChoiceList } from './ChoiceList'
import { ShortAnswerField } from './ShortAnswerField'

const CHOICE_KEYS = [
  ['1', 'a'],
  ['2', 'b'],
  ['3', 'c'],
  ['4', 'd'],
]

interface QuestionViewProps {
  question: QuizQuestion
  answer?: QuizAnswer
  onAnswer: (answer: QuizAnswer) => void
  onSkip: () => void
  onNext: () => void
  isLast: boolean
}

/** One question: sentence with live blank, answer controls, feedback and navigation. Remount per question. */
export function QuestionView({ question, answer, onAnswer, onSkip, onNext, isLast }: QuestionViewProps) {
  /** Set once graded; a skipped question can still be answered. */
  const outcome = answer?.outcome === 'skipped' ? undefined : answer?.outcome
  const response = outcome ? answer?.response : undefined
  const [draft, setDraft] = useState(response ?? '')
  const nextRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isChoice = question.type === 'multiple_choice'

  const submit = (response: string) => {
    flushSync(() => onAnswer({ response, outcome: grade(question, response) }))
    nextRef.current?.focus()
  }

  useEffect(() => {
    if (!isChoice && !outcome) inputRef.current?.focus()
  }, [isChoice, outcome])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
      const target = event.target as HTMLElement
      if (target.closest('input:not([readonly]), textarea, select, [contenteditable="true"]')) return
      if (isChoice && !outcome) {
        const index = CHOICE_KEYS.findIndex((keys) => keys.includes(event.key.toLowerCase()))
        const option = question.options[index]
        if (option) {
          event.preventDefault()
          submit(option.id)
        }
      }
      if (answer && (event.key === 'ArrowRight' || (event.key === 'Enter' && !target.closest('button, a')))) {
        event.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const fill = isChoice ? responseText(question, response ?? '') : draft

  return (
    <Card className="animate-fade-in overflow-hidden">
      <div className="space-y-6 p-4 sm:p-8">
        {!isChoice && (question.hint || question.collocation_type) ? (
          <div className="flex flex-wrap items-center gap-2">
            {question.hint ? (
              <Badge tone="amber" className="text-xs">
                <Lightbulb className="size-3.5" aria-hidden />
                {question.hint}
              </Badge>
            ) : null}
            {question.collocation_type ? <Badge>{question.collocation_type}</Badge> : null}
          </div>
        ) : null}

        <BlankSentence
          sentence={question.sentence}
          fill={fill}
          tone={outcome ?? 'idle'}
          className="text-xl leading-relaxed font-medium text-slate-900 text-pretty sm:text-2xl dark:text-white"
        />

        {isChoice ? (
          <ChoiceList question={question} chosen={response} onChoose={submit} />
        ) : (
          <ShortAnswerField
            value={draft}
            onChange={setDraft}
            onSubmit={() => submit(draft)}
            outcome={outcome}
            inputRef={inputRef}
          />
        )}

        <div aria-live="polite">
          {outcome ? <AnswerFeedback question={question} correct={outcome === 'correct'} /> : null}
          {answer?.outcome === 'skipped' ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              You skipped this question. Answer it now or move on.
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-3 sm:px-8 dark:border-slate-800 dark:bg-slate-900/40">
        <p className="hidden items-center gap-1.5 text-xs text-slate-500 sm:flex dark:text-slate-400">
          {answer ? (
            <>
              <Kbd>Enter</Kbd> or <Kbd>→</Kbd> to continue
            </>
          ) : isChoice ? (
            <>
              Press <Kbd>1</Kbd>–<Kbd>4</Kbd> or <Kbd>A</Kbd>–<Kbd>D</Kbd>
            </>
          ) : (
            <>
              <Kbd>Enter</Kbd> to check
            </>
          )}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {answer ? null : (
            <Button variant="ghost" onClick={onSkip}>
              <SkipForward className="size-4" />
              Skip
            </Button>
          )}
          {answer ? (
            <Button ref={nextRef} onClick={onNext}>
              {isLast ? (
                <>
                  Finish
                  <Flag className="size-4" />
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
