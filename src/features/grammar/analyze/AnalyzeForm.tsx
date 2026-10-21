import { WandSparkles } from 'lucide-react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Button, Card, Kbd } from '@/components/ui'
import { cn } from '@/lib/cn'
import { MAX_LENGTH } from './api'

const EXAMPLES = [
  'Although he was extremely tired from the long journey, he still managed to complete the final report before the strict deadline.',
  'The impact of social media on mental health is undeniable because it alters the way individuals perceive their self-worth.',
]

interface AnalyzeFormProps {
  text: string
  onTextChange: (text: string) => void
  onSubmit: () => void
  pending: boolean
}

export function AnalyzeForm({ text, onTextChange, onSubmit, pending }: AnalyzeFormProps) {
  const length = text.trim().length
  const tooLong = length > MAX_LENGTH
  const canSubmit = length > 0 && !tooLong && !pending

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (canSubmit) onSubmit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit(event)
  }

  return (
    <Card className="p-4 sm:p-6">
      <form onSubmit={submit}>
        <label htmlFor="analyze-input" className="text-sm font-bold text-slate-800 dark:text-slate-100">
          Sentence or paragraph
        </label>
        <textarea
          id="analyze-input"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={5}
          placeholder="Paste an English sentence or paragraph to deconstruct it…"
          aria-describedby="analyze-help"
          className="mt-2 block w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-base leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100"
        />
        <div id="analyze-help" className="mt-1.5 flex items-center justify-between gap-3 text-xs text-slate-400">
          <span className="hidden items-center gap-1 sm:flex">
            <Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd>+<Kbd>Enter</Kbd> to analyze
          </span>
          <span className={cn('ml-auto tabular-nums', tooLong && 'font-semibold text-rose-600')}>
            {length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-400">Try:</span>
          {EXAMPLES.map((example, i) => (
            <Button key={i} variant="ghost" size="sm" onClick={() => onTextChange(example)} title={example} className="bg-slate-100 dark:bg-slate-800">
              Example {i + 1}
            </Button>
          ))}
          <Button type="submit" loading={pending} disabled={!canSubmit} className="ml-auto">
            {pending ? null : <WandSparkles className="size-4" />}
            {pending ? 'Analyzing…' : 'Analyze'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
