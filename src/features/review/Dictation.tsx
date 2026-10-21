// "Nghe chép" (review mode "listen"): a short, simple sentence with the word or collocation is read aloud by the
// browser's voice; the learner types it and it is compared word by word on the spot (no AI).
import { Check, Headphones, Snail, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, Kbd } from '@/components/ui'
import { cn } from '@/lib/cn'
import { speak } from '@/lib/speech'
import { DiffText } from '../practice/components/DiffText'
import { compareSentence } from '../practice/lib/compare'
import { dictationErrors } from './usageTasks'

export interface DictationAnswer {
  typed: string
  correct: boolean
  /** Words missing, extra or wrong. */
  errors: number
}

const SLOW_RATE = 0.7

export function DictationExercise({ text, onSubmit }: { text: string; onSubmit: (answer: DictationAnswer) => void }) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  const submit = () => {
    const errors = dictationErrors(typed, text)
    onSubmit({ typed, correct: errors === 0, errors })
  }

  return (
    <form
      className="flex w-full flex-col items-center gap-5 text-center"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <p className="text-sm font-semibold text-slate-500">Nghe và gõ lại cả câu</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => speak(text)}
          className="flex size-20 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 transition-transform hover:scale-105 active:scale-95 dark:bg-brand-500"
          aria-label="Play again"
        >
          <Headphones className="size-9" />
        </button>
        <button
          type="button"
          onClick={() => speak(text, { rate: SLOW_RATE })}
          className="flex size-12 items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="Play slowly"
          title="Đọc chậm"
        >
          <Snail className="size-5" />
        </button>
      </div>
      <textarea
        ref={inputRef}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === ' ' && e.ctrlKey) {
            e.preventDefault()
            speak(text)
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        rows={2}
        placeholder="Gõ câu bạn nghe được…"
        aria-label="What you heard"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className="w-full max-w-xl resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-lg focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
      />
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button type="submit" size="lg">
          Submit
        </Button>
        <span className="text-xs text-slate-400">
          <Kbd>Enter</Kbd> nộp · <Kbd>Ctrl</Kbd> + <Kbd>Space</Kbd> nghe lại
        </span>
      </div>
      <button
        type="button"
        onClick={() => onSubmit({ typed: '', correct: false, errors: Infinity })}
        className="-my-2 px-2 py-2 text-xs font-semibold text-slate-400 hover:text-slate-600"
      >
        I don't know — show answer
      </button>
    </form>
  )
}

/** The sentence with what was typed differently marked, shown above the card's answer. */
export function DictationResult({ text, answer }: { text: string; answer: DictationAnswer }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl px-4 py-3 text-[15px]',
        answer.correct
          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
          : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
      )}
    >
      {answer.correct ? <Check className="mt-1 size-4 shrink-0" /> : <X className="mt-1 size-4 shrink-0" />}
      <div className="min-w-0 space-y-1">
        {answer.correct || !answer.typed ? <p>{text}</p> : <DiffText parts={compareSentence(answer.typed, text).parts} />}
        <p className="text-xs opacity-80">
          {answer.correct ? 'Chính xác từng từ!' : answer.typed ? `${answer.errors} từ sai / thiếu / thừa` : 'Đáp án'}
          <button type="button" onClick={() => speak(text)} className="ml-2 font-semibold underline">
            Nghe lại
          </button>
        </p>
      </div>
    </div>
  )
}
