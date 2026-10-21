import { ChevronDown, Info, Lightbulb, Link2, Sprout } from 'lucide-react'
import { memo, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/text'
import { ReviewToggle } from '../review/ReviewButtons'
import type { VocabRelation, VocabSense, VocabWord } from '@/types/content'
import { collocationTypeTone } from './collocationType'
import { RichText } from './RichText'
import { SpeakButton } from '@/components/SpeakButton'
import { WordImage } from './WordImage'

export function Label({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[11px] font-bold tracking-[0.16em] text-slate-400 uppercase">{children}</p>
}

/** Definitions can be blurred for self-testing; click to reveal one. */
function Concealable({ hidden, children, className }: { hidden: boolean; children: ReactNode; className?: string }) {
  const [revealed, setRevealed] = useState(false)
  const concealed = hidden && !revealed
  return (
    <div
      className={cn('transition-[filter]', concealed && 'cursor-pointer blur-[6px] select-none hover:blur-[4px]', className)}
      onClick={concealed ? () => setRevealed(true) : undefined}
      title={concealed ? 'Click to reveal' : undefined}
    >
      {children}
    </div>
  )
}

/**
 * One sense as a compact dictionary entry: number, meaning, patterns on one line, one example.
 * Extra examples and the usage note appear when the card is expanded.
 */
function SenseBlock({ sense, index, total, hideMeaning, expanded }: { sense: VocabSense; index: number; total: number; hideMeaning: boolean; expanded: boolean }) {
  const examples = expanded ? sense.examples : sense.examples.slice(0, 1)
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      {total > 1 ? (
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-700 dark:bg-brand-900/60 dark:text-brand-300">
          {index + 1}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 space-y-1.5">
        <Concealable hidden={hideMeaning}>
          <RichText text={sense.definition_vi} className="block text-[15px] leading-snug text-slate-800 dark:text-slate-100" />
        </Concealable>

        {sense.patterns.length ? (
          <div className="flex flex-wrap gap-1.5">
            {sense.patterns.map((pattern) => (
              <code
                key={pattern}
                className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[12.5px] font-medium text-brand-800 dark:bg-brand-950/60 dark:text-brand-200"
              >
                <RichText text={pattern} />
              </code>
            ))}
          </div>
        ) : null}

        {examples.map((example) => (
          <p key={example} className="group flex items-start gap-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            <RichText text={example} className="flex-1 italic" />
            <SpeakButton text={example} className="-my-1 size-7 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus:opacity-100" />
          </p>
        ))}

        {expanded && sense.usage_notes_vi ? (
          <Concealable hidden={hideMeaning} className="flex gap-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
            <Info className="mt-0.5 size-3.5 shrink-0 text-sky-500" />
            <RichText text={sense.usage_notes_vi} />
          </Concealable>
        ) : null}
      </div>
    </li>
  )
}

export function CollocationItem({ item }: { item: VocabRelation }) {
  return (
    <li className="rounded-xl border border-slate-200/80 p-3 dark:border-slate-800">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="font-semibold text-slate-900 dark:text-white">
            <RichText text={item.text} />
          </p>
          {item.type ? <Badge className="px-2 py-0 text-[10px]">{item.type}</Badge> : null}
          {item.pronunciation ? <span className="ipa text-xs text-slate-400">{item.pronunciation}</span> : null}
        </div>
        <SpeakButton text={item.text} className="size-7" />
      </div>
      {item.meaning_vi ? <RichText text={item.meaning_vi} className="mt-1 block text-sm text-slate-700 dark:text-slate-300" /> : null}
      {item.examples?.length ? (
        <ul className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
          {item.examples.map((example) => (
            <li key={example} className="text-[13px] text-slate-600 italic dark:text-slate-400">
              <RichText text={example} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function Chips({ items, tone }: { items: VocabRelation[] | string[]; tone: 'emerald' | 'rose' | 'slate' }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const text = typeof item === 'string' ? item : item.text
        const ipa = typeof item === 'string' ? undefined : item.pronunciation
        return (
          <Badge key={text} tone={tone} className="py-1 text-xs font-medium" title={ipa}>
            {text}
            {ipa ? <span className="ipa font-normal opacity-60">{ipa}</span> : null}
          </Badge>
        )
      })}
    </div>
  )
}

function WordDetails({ word, hideMnemonic }: { word: VocabWord; hideMnemonic: boolean }) {
  const roots = word.word_roots
  return (
    <div className="animate-fade-in space-y-5 border-t border-slate-100 pt-5 dark:border-slate-800">
      {!hideMnemonic && (word.mnemonic_vi || roots?.mnemonic_vi) ? (
        <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <Lightbulb className="mt-0.5 size-5 shrink-0 text-amber-500" />
          <div className="space-y-1">
            <p className="font-bold">Mẹo nhớ</p>
            <RichText text={word.mnemonic_vi ?? roots?.mnemonic_vi} />
          </div>
        </div>
      ) : null}

      {word.collocations.length ? (
        <section>
          <Label>
            <Link2 className="mr-1 inline size-3.5" />
            Collocations
          </Label>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {word.collocations.map((item) => (
              <CollocationItem key={item.text} item={item} />
            ))}
          </ul>
        </section>
      ) : null}

      {word.synonyms.length || word.antonyms.length || word.word_family.length ? (
        <div className="grid gap-5 md:grid-cols-3">
          {word.synonyms.length ? (
            <section>
              <Label>Synonyms</Label>
              <Chips items={word.synonyms} tone="emerald" />
            </section>
          ) : null}
          {word.antonyms.length ? (
            <section>
              <Label>Antonyms</Label>
              <Chips items={word.antonyms} tone="rose" />
            </section>
          ) : null}
          {word.word_family.length ? (
            <section>
              <Label>Word family</Label>
              <Chips items={word.word_family} tone="slate" />
            </section>
          ) : null}
        </div>
      ) : null}

      {roots && (roots.origin || roots.roots.length) ? (
        <section>
          <Label>
            <Sprout className="mr-1 inline size-3.5" />
            Word roots
          </Label>
          {roots.origin ? <p className="mb-2 text-sm text-slate-500">Origin: {roots.origin}</p> : null}
          <ul className="grid gap-2 sm:grid-cols-2">
            {roots.roots.map((root) => (
              <li key={root.root} className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950/40">
                <span className="font-bold text-slate-900 dark:text-white">{root.root}</span>
                <span className="text-slate-600 dark:text-slate-300"> — {root.meaning_vi}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export function hasWordDetails(word: VocabWord, hideMnemonic = false): boolean {
  return Boolean(
    word.collocations.length ||
      word.synonyms.length ||
      word.antonyms.length ||
      word.word_family.length ||
      (!hideMnemonic && word.mnemonic_vi) ||
      (word.word_roots && (word.word_roots.origin || word.word_roots.roots.length || (!hideMnemonic && word.word_roots.mnemonic_vi))),
  )
}

interface WordCardProps {
  word: VocabWord
  /** Details (collocations, synonyms, roots…) start open. */
  defaultExpanded?: boolean
  hideMeaning?: boolean
  /** Set the word id as the element id, for #hash links (off for copies shown in overlays). */
  anchor?: boolean
  /** Review card id; shows the add-to-review toggle. */
  reviewId?: string
  /** Leave out the memory tip (the review session shows the entry without it). */
  hideMnemonic?: boolean
  className?: string
}

export const WordCard = memo(function WordCard({
  word,
  defaultExpanded = false,
  hideMeaning = false,
  anchor = true,
  reviewId,
  hideMnemonic = false,
  className,
}: WordCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  // Hidden until expanded: extra examples, usage notes, and the details section.
  const hasMore = word.senses.some((s) => s.examples.length > 1 || s.usage_notes_vi)
  const details = hasWordDetails(word, hideMnemonic)
  const showDetails = details || hasMore

  return (
    <article
      id={anchor ? word.id : undefined}
      className={cn(
        'scroll-mt-24 rounded-3xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-sm shadow-slate-900/[0.03] dark:border-slate-800 dark:bg-slate-900/60',
        className,
      )}
      // Long lists skip rendering off-screen cards. Only there: content-visibility also clips painting to the rounded
      // corners, which cuts into the first letter of the word when a copy is shown without padding (review, study mode).
      style={anchor ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 260px' } : undefined}
    >
      <div className="flex gap-5">
        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h3 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">{word.word}</h3>
            <SpeakButton text={word.word} className="-ml-1" />
            {word.pronunciation ? <span className="ipa text-base text-slate-500 dark:text-slate-400">{word.pronunciation}</span> : null}
            {word.part_of_speech.map((pos) => (
              <Badge key={pos} tone="brand">
                {pos}
              </Badge>
            ))}
            {word.collocation_type ? <Badge tone={collocationTypeTone(word.collocation_type)}>{word.collocation_type}</Badge> : null}
            {word.created_at ? <span className="text-[11px] text-slate-400">{formatDate(word.created_at)}</span> : null}
            {reviewId ? <ReviewToggle id={reviewId} className="ml-auto" /> : null}
          </header>

          <ol className="mt-3 max-w-3xl divide-y divide-slate-100 dark:divide-slate-800">
            {word.senses.map((sense, index) => (
              <SenseBlock key={index} sense={sense} index={index} total={word.senses.length} hideMeaning={hideMeaning} expanded={expanded} />
            ))}
          </ol>
        </div>

        {word.image ? (
          <WordImage src={word.image} alt={word.word} credit={word.image_credit} className="hidden size-28 shrink-0 rounded-2xl ring-4 ring-slate-50 sm:block lg:size-32 dark:ring-slate-800" />
        ) : null}
      </div>

      {showDetails ? (
        <>
          {expanded && details ? <div className="mt-5"><WordDetails word={word} hideMnemonic={hideMnemonic} /></div> : null}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-3 -ml-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-brand-700 transition-colors hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/50"
          >
            <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
            {expanded ? 'Show less' : details ? 'More examples, usage, collocations & synonyms' : 'More examples & usage'}
          </button>
        </>
      ) : null}
    </article>
  )
})
