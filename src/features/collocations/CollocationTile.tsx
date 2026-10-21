import { memo } from 'react'
import { Badge } from '@/components/ui'
import type { VocabWord } from '@/types/content'
import { ReviewToggle } from '../review/ReviewButtons'
import { collocationTypeTone } from '../words/collocationType'
import { RichText } from '../words/RichText'
import { SpeakButton } from '@/components/SpeakButton'

/** Compact card for one collocation in a lesson grid. */
export const CollocationTile = memo(function CollocationTile({ word, reviewId }: { word: VocabWord; reviewId?: string }) {
  const sense = word.senses[0]
  return (
    <article
      id={word.id}
      className="flex scroll-mt-40 flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-900/[0.03] dark:border-slate-800 dark:bg-slate-900/60"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="leading-snug font-bold text-slate-900 dark:text-white">{word.word}</h3>
          {word.pronunciation ? <p className="ipa mt-0.5 text-xs text-slate-400">{word.pronunciation}</p> : null}
        </div>
        <div className="-mt-1 -mr-1 flex shrink-0 items-center gap-1">
          {reviewId ? <ReviewToggle id={reviewId} /> : null}
          <SpeakButton text={word.word} />
        </div>
      </div>
      {word.collocation_type || word.part_of_speech.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {word.collocation_type ? <Badge tone={collocationTypeTone(word.collocation_type)}>{word.collocation_type}</Badge> : null}
          {word.part_of_speech.map((pos) => (
            <Badge key={pos}>{pos}</Badge>
          ))}
        </div>
      ) : null}
      {sense ? (
        <>
          <RichText text={sense.definition_vi} className="mt-3 block text-sm leading-relaxed text-slate-700 dark:text-slate-300" />
          {sense.examples.length ? (
            <ul className="mt-2 space-y-1 border-l-2 border-brand-200 pl-3 dark:border-brand-800">
              {sense.examples.map((example) => (
                <li key={example} className="text-[13px] text-slate-500 italic dark:text-slate-400">
                  <RichText text={example} />
                </li>
              ))}
            </ul>
          ) : null}
          {sense.usage_notes_vi ? (
            <RichText text={sense.usage_notes_vi} className="mt-3 block rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" />
          ) : null}
        </>
      ) : null}
    </article>
  )
})
