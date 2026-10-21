import { memo } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui'
import { Markdown } from '@/components/Markdown'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/text'
import type { Note, NoteExample } from '@/types/content'
import { SpeakButton } from '@/components/SpeakButton'
import { ReviewToggle } from '../review/ReviewButtons'
import { WordImage } from '../words/WordImage'
import { NOTE_TYPE_TONES, noteKey } from './noteTypes'

function Label({ children }: { children: string }) {
  return <p className="mb-2 text-[11px] font-bold tracking-[0.18em] text-slate-400 uppercase dark:text-slate-500">{children}</p>
}

function ExampleLine({ example, compact }: { example: NoteExample; compact?: boolean }) {
  return (
    <div className="flex items-start gap-1.5">
      <div className="min-w-0 flex-1">
        <p className={cn('font-semibold text-slate-800 dark:text-slate-100', compact ? 'text-[13px]' : 'text-sm')}>{example.en}</p>
        <p className={cn('mt-0.5 text-slate-500 italic dark:text-slate-400', compact ? 'text-xs' : 'text-[13px]')}>{example.vi}</p>
      </div>
      <SpeakButton text={example.en} className="-mt-1 size-6" />
    </div>
  )
}

const PATTERN_HEADERS = ['Cấu trúc chính', 'Giải nghĩa', 'Ví dụ minh họa']
const PATTERN_GRID = '@xl:grid @xl:grid-cols-[minmax(8rem,0.8fr)_1fr_1.4fr]'

/** A table on wide cards; stacked blocks on narrow ones (container query). */
function Patterns({ patterns }: { patterns: Note['patterns'] }) {
  return (
    <div role="table" aria-label="Patterns" className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
      <div role="row" className={cn('hidden bg-amber-500 text-sm font-semibold text-white dark:bg-amber-600', PATTERN_GRID)}>
        {PATTERN_HEADERS.map((header) => (
          <span key={header} role="columnheader" className="px-3 py-2.5">
            {header}
          </span>
        ))}
      </div>
      {patterns.map((pattern, i) => (
        <div
          key={i}
          role="row"
          className={cn('space-y-2 border-slate-200 p-3 not-first:border-t @xl:space-y-0 @xl:p-0 dark:border-slate-800', PATTERN_GRID)}
        >
          <div role="cell" className="font-mono text-sm font-semibold text-brand-700 @xl:px-3 @xl:py-3 dark:text-brand-300">
            {pattern.pattern}
          </div>
          <div role="cell" className="text-sm text-slate-700 @xl:border-l @xl:border-slate-200 @xl:px-3 @xl:py-3 dark:text-slate-300 @xl:dark:border-slate-800">
            <Markdown>{pattern.meaning_vi}</Markdown>
          </div>
          <div role="cell" className="@xl:border-l @xl:border-slate-200 @xl:px-3 @xl:py-3 @xl:dark:border-slate-800">
            <ul className="space-y-2 rounded-lg bg-slate-50 p-2.5 @xl:bg-transparent @xl:p-0 dark:bg-slate-800/40 @xl:dark:bg-transparent">
              {pattern.examples.map((example, j) => (
                <li key={j}>
                  <ExampleLine example={example} compact />
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  )
}

interface NoteCardProps {
  note: Note
  /** Maps note ids and lower-cased titles to ids, to link `related_notes`. */
  lookup: ReadonlyMap<string, string>
  /** Give the card its `id` so /notes#<id> can scroll to it (off in the study overlay to keep ids unique). */
  anchor?: boolean
  onRelatedClick?: () => void
  /** Show the add-to-review toggle (off inside study mode). */
  reviewable?: boolean
  className?: string
}

export const NoteCard = memo(function NoteCard({ note, lookup, anchor, onRelatedClick, reviewable = true, className }: NoteCardProps) {
  return (
    <article
      id={anchor ? note.id : undefined}
      className={cn(
        '@container scroll-mt-24 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-900/[0.03] sm:p-6 dark:border-slate-800 dark:bg-slate-900/60',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Badge tone={NOTE_TYPE_TONES[note.type]} className="uppercase">
          {note.type}
        </Badge>
        {note.created_at ? (
          <time dateTime={note.created_at} className="text-xs text-slate-400 tabular-nums">
            {formatDate(note.created_at)}
          </time>
        ) : null}
      </div>

      <div className="mt-3 flex flex-col-reverse gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <h2 className="min-w-0 flex-1 break-words text-xl font-bold tracking-tight text-slate-900 first-letter:uppercase dark:text-white">{note.title}</h2>
            <SpeakButton text={note.title} className="mt-0.5" />
            {reviewable ? <ReviewToggle id={`note:${note.id}`} className="mt-1" /> : null}
          </div>
          {note.type !== 'Structure' && note.pronunciation ? <p className="ipa mt-0.5 text-brand-600 dark:text-brand-400">{note.pronunciation}</p> : null}

          {note.formula ? (
            <code className="mt-3 block rounded-xl border border-brand-100 bg-brand-50/60 px-3 py-2 font-mono text-sm font-semibold text-brand-800 dark:border-brand-900/60 dark:bg-brand-950/30 dark:text-brand-200">
              {note.formula}
            </code>
          ) : null}

          {note.meaning_vi || note.usage_context ? (
            <div className="mt-4 rounded-r-xl border-l-4 border-brand-500 bg-slate-50 px-4 py-3 dark:bg-slate-800/40">
              <Markdown className="text-slate-800 dark:text-slate-100">{note.meaning_vi}</Markdown>
              {note.usage_context ? (
                <Markdown className="mt-2 text-slate-500 italic dark:text-slate-400">{note.usage_context}</Markdown>
              ) : null}
            </div>
          ) : null}
        </div>

        {note.image ? (
          <WordImage
            src={note.image}
            alt={note.title}
            credit={note.image_credit}
            className="size-24 shrink-0 rounded-2xl ring-4 ring-slate-50 sm:size-28 dark:ring-slate-800"
          />
        ) : null}
      </div>

      {note.patterns.length ? (
        <div className="mt-5">
          <Label>Patterns</Label>
          <Patterns patterns={note.patterns} />
        </div>
      ) : null}

      {note.examples.length ? (
        <div className="mt-5">
          <Label>Examples</Label>
          <ul className="grid gap-2.5 @lg:grid-cols-2">
            {note.examples.map((example, i) => (
              <li key={i} className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/30">
                <ExampleLine example={example} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {note.related_notes.length ? (
        <div className="mt-5 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <span className="mr-1 text-xs text-slate-400">Related</span>
          {note.related_notes.map((related, i) => {
            const id = lookup.get(noteKey(related))
            const chip = 'rounded-lg px-2 py-1 text-xs font-medium'
            return id ? (
              <Link
                key={i}
                to={`/notes#${id}`}
                onClick={onRelatedClick}
                className={cn(chip, 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-300 dark:hover:bg-brand-900/60')}
              >
                {related}
              </Link>
            ) : (
              <span key={i} className={cn(chip, 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400')}>
                {related}
              </span>
            )
          })}
        </div>
      ) : null}
    </article>
  )
})
