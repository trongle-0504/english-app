import { Eraser, Play } from 'lucide-react'
import { useId } from 'react'
import { Button, Card } from '@/components/ui'
import { plural } from '@/lib/text'

interface SourceFormProps {
  value: string
  onChange: (value: string) => void
  sentenceCount: number
  onStart: () => void
}

export function SourceForm({ value, onChange, sentenceCount, onStart }: SourceFormProps) {
  const id = useId()
  return (
    <Card className="animate-slide-up p-4 sm:p-8">
      <label htmlFor={id} className="text-lg font-bold text-slate-900 dark:text-white">
        Source text
      </label>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Paste an English paragraph — an article excerpt, a model essay, anything. It is split into sentences and hidden while you practise.
      </p>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Paste your paragraph here…"
        className="mt-4 min-h-56 w-full resize-y rounded-2xl border border-slate-200 bg-white p-4 text-base leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 tabular-nums dark:text-slate-400" aria-live="polite">
          {sentenceCount ? `${plural(sentenceCount, 'sentence')} detected` : 'No text yet'}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => onChange('')} disabled={!value}>
            <Eraser className="size-4" />
            Clear
          </Button>
          <Button size="lg" onClick={onStart} disabled={!sentenceCount}>
            <Play className="size-4" />
            Start dictation
          </Button>
        </div>
      </div>
    </Card>
  )
}
