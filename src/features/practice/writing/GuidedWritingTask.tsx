import { CheckCheck, Eye, EyeOff, Languages, ListTree, PenLine } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Button, Card, Progress, SectionTitle } from '@/components/ui'
import { Markdown } from '@/components/Markdown'
import { cn } from '@/lib/cn'
import { useLocalStorage } from '@/lib/storage'
import type { GuidedWritingTask as GuidedWritingTaskData } from '@/types/content'
import { DiffLegend, DiffText } from '../components/DiffText'
import { SentenceRow } from '../components/SentenceRow'
import { SpeakButton } from '@/components/SpeakButton'
import { words } from '../lib/compare'
import { reviewParagraph, type ParagraphReview } from '../lib/review'
import { percent } from '../lib/score'

function Panel({ icon, title, className, children }: { icon: ReactNode; title: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-2xl border p-4 sm:p-5', className)}>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.14em] uppercase opacity-80">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function ReviewList({ review }: { review: ParagraphReview }) {
  return (
    <Card className="animate-slide-up p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-bold text-slate-900 dark:text-white">
            {review.correct} / {review.total} sentences correct
          </p>
          <Progress value={percent(review.correct, review.total)} className="mt-2 w-48" />
        </div>
        <DiffLegend />
      </div>
      <ol className="divide-y divide-slate-100 dark:divide-slate-800">
        {review.items.map((item, i) => {
          if (item.kind === 'extra')
            return (
              <SentenceRow key={i} verdict="extra">
                <del className="text-slate-500 decoration-rose-400 dark:text-slate-400">{item.user}</del>
              </SentenceRow>
            )
          if (item.kind === 'missing')
            return (
              <SentenceRow key={i} verdict="missing" number={item.targetIndex + 1} speakText={item.target}>
                <ins className="text-emerald-700 no-underline dark:text-emerald-300">{item.target}</ins>
              </SentenceRow>
            )
          return (
            <SentenceRow
              key={i}
              verdict={item.comparison.correct ? 'correct' : 'wrong'}
              number={item.targetIndex + 1}
              speakText={item.target}
            >
              <DiffText parts={item.comparison.parts} />
            </SentenceRow>
          )
        })}
      </ol>
    </Card>
  )
}

function ModelAnswer({ fullEnglish, sentences }: { fullEnglish: string; sentences: string[] }) {
  return (
    <Card className="animate-slide-up space-y-5 p-4 sm:p-6">
      <div>
        <SectionTitle>Model answer</SectionTitle>
        <Markdown className="text-slate-700 dark:text-slate-200 [&_p]:text-base">{fullEnglish}</Markdown>
      </div>
      <div>
        <SectionTitle count={sentences.length}>Sentence by sentence</SectionTitle>
        <ol className="space-y-1.5">
          {sentences.map((sentence, i) => (
            <li key={i} className="flex items-start gap-3 rounded-xl px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <span className="mt-0.5 w-6 shrink-0 text-right text-xs font-semibold text-slate-400 tabular-nums">{i + 1}.</span>
              <span className="flex-1 text-[15px] text-slate-700 dark:text-slate-200">{sentence}</span>
              <SpeakButton text={sentence} label={`Listen to sentence ${i + 1}`} />
            </li>
          ))}
        </ol>
      </div>
    </Card>
  )
}

export function GuidedWritingTask({ task, draftKey }: { task: GuidedWritingTaskData; draftKey: string }) {
  const { prompt, outlineEnglish, vietnameseText, fullEnglish, englishSentences } = task.content
  const [text, setText] = useLocalStorage(draftKey, '')
  const [review, setReview] = useState<ParagraphReview>()
  const [showAnswer, setShowAnswer] = useState(false)
  const textareaId = useId()
  const wordCount = words(text).length

  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-8">
        <p className="text-lg font-semibold text-slate-900 text-pretty dark:text-white">{prompt}</p>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            {outlineEnglish ? (
              <Panel
                icon={<ListTree className="size-3.5" />}
                title="Outline"
                className="border-slate-200 bg-slate-50/70 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200"
              >
                <Markdown>{outlineEnglish}</Markdown>
              </Panel>
            ) : null}
            <Panel
              icon={<Languages className="size-3.5" />}
              title="Vietnamese text"
              className="border-amber-200/70 bg-amber-50/70 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100"
            >
              <Markdown className="text-amber-950 dark:text-amber-100 [&_strong]:text-amber-900 dark:[&_strong]:text-amber-200">
                {vietnameseText}
              </Markdown>
            </Panel>
          </div>

          <div className="flex flex-col lg:sticky lg:top-20 lg:self-start">
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor={textareaId} className="flex items-center gap-2 text-xs font-bold tracking-[0.14em] text-slate-500 uppercase dark:text-slate-400">
                <PenLine className="size-3.5" />
                Your writing
              </label>
              <span className="text-xs text-slate-400 tabular-nums">{wordCount} words · saved locally</span>
            </div>
            <textarea
              id={textareaId}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Translate the Vietnamese text into English, sentence by sentence…"
              spellCheck
              className="min-h-72 w-full flex-1 resize-y rounded-2xl border border-slate-200 bg-white p-4 text-base leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none lg:min-h-96 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => setReview(reviewParagraph(text, englishSentences))} disabled={!text.trim()}>
                <CheckCheck className="size-4" />
                Check
              </Button>
              <Button variant="outline" onClick={() => setShowAnswer(!showAnswer)} aria-expanded={showAnswer}>
                {showAnswer ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                {showAnswer ? 'Hide answer' : 'Show answer'}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <p className="sr-only" aria-live="polite">
        {review ? `${review.correct} of ${review.total} sentences correct` : ''}
      </p>
      {review ? <ReviewList review={review} /> : null}
      {showAnswer ? <ModelAnswer fullEnglish={fullEnglish} sentences={englishSentences} /> : null}
    </div>
  )
}
