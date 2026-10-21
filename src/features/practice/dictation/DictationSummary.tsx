import { FilePlus2, RotateCcw } from 'lucide-react'
import { Button, Card, SectionTitle } from '@/components/ui'
import { DiffLegend, DiffText } from '../components/DiffText'
import { ScoreRing } from '../components/ScoreRing'
import { SentenceRow } from '../components/SentenceRow'
import { percent } from '../lib/score'
import type { Attempt } from './DictationSession'

interface DictationSummaryProps {
  sentences: string[]
  attempts: Attempt[]
  onRestart: () => void
  onNewText: () => void
}

export function DictationSummary({ sentences, attempts, onRestart, onNewText }: DictationSummaryProps) {
  const correct = attempts.filter((a) => a.result?.correct).length
  const checked = attempts.filter((a) => a.result).length

  return (
    <div className="animate-slide-up space-y-6">
      <Card className="flex flex-col items-center gap-6 p-4 sm:flex-row sm:p-8">
        <ScoreRing value={percent(correct, sentences.length)} />
        <div className="flex-1 text-center sm:text-left">
          <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">Dictation complete</h2>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            <strong className="text-slate-800 dark:text-slate-100">{correct}</strong> of {sentences.length} sentences written perfectly
            {checked < sentences.length ? ` · ${sentences.length - checked} not checked` : ''}.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Button onClick={onRestart}>
              <RotateCcw className="size-4" />
              Practise again
            </Button>
            <Button variant="outline" onClick={onNewText}>
              <FilePlus2 className="size-4" />
              New text
            </Button>
          </div>
        </div>
      </Card>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="mb-0">Review</SectionTitle>
          <DiffLegend />
        </div>
        <Card className="p-4 sm:p-6">
          <ol className="divide-y divide-slate-100 dark:divide-slate-800">
            {sentences.map((sentence, i) => {
              const result = attempts[i].result
              return (
                <SentenceRow key={i} verdict={result ? (result.correct ? 'correct' : 'wrong') : 'unchecked'} number={i + 1} speakText={sentence}>
                  {result ? <DiffText parts={result.parts} /> : <p className="text-slate-500 dark:text-slate-400">{sentence}</p>}
                </SentenceRow>
              )
            })}
          </ol>
        </Card>
      </section>
    </div>
  )
}
