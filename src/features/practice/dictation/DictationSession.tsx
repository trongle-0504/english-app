import { ArrowLeft, ArrowRight, CheckCheck, Eye, EyeOff, Flag, Volume2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Button, Card, Kbd, Progress, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/cn'
import { DiffLegend, DiffText } from '../components/DiffText'
import { compareSentence, type SentenceComparison } from '../lib/compare'
import { DictationSummary } from './DictationSummary'

export interface Attempt {
  input: string
  /** Set when checked; cleared again as soon as the input is edited. */
  result?: SentenceComparison
}

export type Rate = '0.75' | '1'

const RATE_OPTIONS: { value: Rate; label: string }[] = [
  { value: '0.75', label: '0.75×' },
  { value: '1', label: '1×' },
]

interface DictationSessionProps {
  sentences: string[]
  source: string
  rate: Rate
  onRateChange: (rate: Rate) => void
  speak: (text: string, rate: number) => void
  speaking: boolean
  onNewText: () => void
}

const emptyAttempts = (count: number): Attempt[] => Array.from({ length: count }, () => ({ input: '' }))

function SentencePills({ attempts, current, onSelect }: { attempts: Attempt[]; current: number; onSelect: (index: number) => void }) {
  return (
    <nav aria-label="Sentences" className="flex flex-wrap gap-1.5">
      {attempts.map((attempt, i) => {
        const status = attempt.result ? (attempt.result.correct ? 'correct' : 'wrong') : undefined
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            aria-current={i === current ? 'step' : undefined}
            aria-label={`Sentence ${i + 1}${status ? `, ${status}` : ''}`}
            className={cn(
              'flex size-8 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-all hover:scale-110',
              status === 'correct' && 'border-emerald-500 bg-emerald-500 text-white',
              status === 'wrong' && 'border-rose-500 bg-rose-500 text-white',
              !status && 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
              i === current && 'ring-2 ring-brand-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900',
            )}
          >
            {i + 1}
          </button>
        )
      })}
    </nav>
  )
}

export function DictationSession({ sentences, source, rate, onRateChange, speak, speaking, onNewText }: DictationSessionProps) {
  const [attempts, setAttempts] = useState(() => emptyAttempts(sentences.length))
  const [current, setCurrent] = useState(0)
  const [finished, setFinished] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const inputId = useId()

  const attempt = attempts[current]
  const checkedCount = attempts.filter((a) => a.result).length
  const isLast = current === sentences.length - 1

  const play = (index = current) => speak(sentences[index], Number(rate))
  const update = (patch: Attempt) => setAttempts((prev) => prev.with(current, patch))

  const goTo = (index: number) => {
    setCurrent(index)
    play(index)
    inputRef.current?.focus()
  }
  const check = () => update({ ...attempt, result: compareSentence(attempt.input, sentences[current]) })
  const next = () => (isLast ? setFinished(true) : goTo(current + 1))

  if (finished) {
    return (
      <DictationSummary
        sentences={sentences}
        attempts={attempts}
        onRestart={() => {
          setAttempts(emptyAttempts(sentences.length))
          setFinished(false)
          goTo(0)
        }}
        onNewText={onNewText}
      />
    )
  }

  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-700 tabular-nums dark:text-slate-200">
            Sentence {current + 1} <span className="text-slate-400">/ {sentences.length}</span>
          </p>
          <SegmentedControl size="sm" value={rate} onChange={onRateChange} options={RATE_OPTIONS} />
        </div>
        <Progress value={(checkedCount / sentences.length) * 100} className="mt-3" />
        <div className="mt-4">
          <SentencePills attempts={attempts} current={current} onSelect={goTo} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="space-y-5 p-4 sm:p-8">
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => play()}
              className={cn(
                'flex size-16 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/25 transition-all hover:scale-105 hover:bg-brand-700 active:scale-95 dark:bg-brand-500 dark:text-slate-950 dark:hover:bg-brand-400',
                speaking && 'ring-8 ring-brand-500/20',
              )}
              aria-label="Play sentence"
            >
              <Volume2 className={cn('size-7', speaking && 'animate-pulse')} />
            </button>
            <div>
              <p className="font-bold text-slate-900 dark:text-white">{speaking ? 'Playing…' : 'Listen, then type what you hear'}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Press play as many times as you need.</p>
            </div>
          </div>

          <div>
            <label htmlFor={inputId} className="sr-only">
              {`Your transcription of sentence ${current + 1}`}
            </label>
            <textarea
              id={inputId}
              ref={inputRef}
              rows={3}
              autoFocus
              value={attempt.input}
              onChange={(event) => update({ input: event.target.value })}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                event.preventDefault()
                if (attempt.result) next()
                else if (attempt.input.trim()) check()
              }}
              placeholder="Type the sentence…"
              spellCheck={false}
              autoComplete="off"
              className={cn(
                'w-full resize-none rounded-2xl border bg-white p-4 text-lg leading-relaxed text-slate-900 placeholder:text-slate-400 focus:ring-4 focus:outline-none dark:bg-slate-900 dark:text-white',
                !attempt.result && 'border-slate-200 focus:border-brand-400 focus:ring-brand-500/10 dark:border-slate-700',
                attempt.result?.correct && 'border-emerald-500 focus:ring-emerald-500/10',
                attempt.result && !attempt.result.correct && 'border-rose-400 focus:ring-rose-500/10',
              )}
            />
          </div>

          <div aria-live="polite">
            {attempt.result ? (
              <div
                className={cn(
                  'animate-slide-up space-y-2 rounded-2xl border p-4',
                  attempt.result.correct
                    ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30'
                    : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={cn('font-bold', attempt.result.correct ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>
                    {attempt.result.correct ? 'Perfect!' : 'Almost — compare with the original'}
                  </p>
                  {attempt.result.correct ? null : <DiffLegend />}
                </div>
                <DiffText parts={attempt.result.parts} className="text-[15px] text-slate-700 dark:text-slate-200" />
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-3 sm:px-8 dark:border-slate-800 dark:bg-slate-900/40">
          <p className="hidden items-center gap-1.5 text-xs text-slate-500 sm:flex dark:text-slate-400">
            <Kbd>Enter</Kbd> {attempt.result ? 'next sentence' : 'check'} · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => goTo(current - 1)} disabled={current === 0} aria-label="Previous sentence">
              <ArrowLeft className="size-4" />
            </Button>
            {attempt.result ? (
              <Button onClick={next}>
                {isLast ? 'Finish' : 'Next'}
                {isLast ? <Flag className="size-4" /> : <ArrowRight className="size-4" />}
              </Button>
            ) : (
              <Button onClick={check} disabled={!attempt.input.trim()}>
                <CheckCheck className="size-4" />
                Check
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div>
        <Button variant="ghost" size="sm" onClick={() => setShowSource(!showSource)} aria-expanded={showSource}>
          {showSource ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          {showSource ? 'Hide source' : 'Show source'}
        </Button>
        {showSource ? (
          <Card className="animate-fade-in mt-2 p-4 sm:p-5 text-[15px] leading-relaxed whitespace-pre-line text-slate-600 dark:text-slate-300">{source}</Card>
        ) : null}
      </div>
    </div>
  )
}
