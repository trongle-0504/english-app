import { ExternalLink, Info, Lightbulb, Link2 } from 'lucide-react'
import { Suspense } from 'react'
import { Link } from 'react-router'
import { SpeakButton } from '@/components/SpeakButton'
import { Badge } from '@/components/ui'
import { useData } from '@/lib/data'
import type { ReviewCard, VocabLesson } from '@/types/content'
import { RichText } from '../words/RichText'
import { CollocationItem, Chips, Label, WordCard } from '../words/WordCard'
import { WordImage } from '../words/WordImage'
import { PhraseCheck } from './PracticeCards'

const SOURCE_LABEL: Record<ReviewCard['source'], string> = {
  vocabulary: 'Vocabulary',
  collocation: 'Collocation',
  'word-collocation': 'Collocation',
  note: 'Note',
  custom: 'My card',
  essay: 'Essay',
}

export function SourceTag({ card }: { card: ReviewCard }) {
  return (
    <p className="text-xs font-bold tracking-[0.12em] text-slate-400 uppercase">
      {SOURCE_LABEL[card.source]} · <span className="text-[13px] tracking-normal normal-case">{card.origin}</span>
    </p>
  )
}

/** Hides the term inside an example so it can be shown as a clue in recall mode. */
export function blankTerm(sentence: string, term: string): string {
  const words = term.split(/\s+/).filter((w) => w.length > 2 && !/^(a|an|the|to|of|sb|sth|someone|something)$/i.test(w))
  let out = sentence.replace(/\*\*[^*]+\*\*/g, '_____')
  for (const w of words) out = out.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`, 'gi'), '_____')
  return out
}

/** Left-aligned term line for the answer side, like the vocabulary word cards. */
export function AnswerHeading({ card }: { card: ReviewCard }) {
  const isStructure = card.part_of_speech.includes('Structure')
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <h3 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">{card.term}</h3>
      <SpeakButton text={card.term} className="-ml-1" />
      {!isStructure && card.pronunciation ? <span className="ipa text-base text-slate-500 dark:text-slate-400">{card.pronunciation}</span> : null}
      {card.part_of_speech.map((pos) => (
        <Badge key={pos} tone="brand">
          {pos}
        </Badge>
      ))}
    </header>
  )
}

/** The answer side for any card in the common schema, laid out like a vocabulary word card. Empty fields are skipped. */
export function CardBack({ card, hideMnemonic = false }: { card: ReviewCard; hideMnemonic?: boolean }) {
  const mnemonic = hideMnemonic ? undefined : card.mnemonic_vi
  return (
    <div className="animate-fade-in space-y-5 text-left">
      <div className="flex gap-5">
        <div className="min-w-0 flex-1 space-y-2">
          {card.meaning_vi ? <RichText text={card.meaning_vi} className="block text-[15px] leading-snug text-slate-800 dark:text-slate-100" /> : null}
          {card.meaning_en ? <p className="text-sm text-slate-500 dark:text-slate-400">{card.meaning_en}</p> : null}
          {card.formula ? (
            <code className="inline-block rounded-md bg-brand-50 px-1.5 py-0.5 text-[12.5px] font-medium text-brand-800 dark:bg-brand-950/60 dark:text-brand-200">
              {card.formula}
            </code>
          ) : null}
          {card.examples.map((example) => (
            <div key={example.en} className="group flex items-start gap-1 text-sm leading-relaxed">
              <div className="min-w-0 flex-1">
                <RichText text={example.en} className="block text-slate-600 italic dark:text-slate-300" />
                {example.vi ? <p className="text-[13px] text-slate-400">{example.vi}</p> : null}
              </div>
              <SpeakButton text={example.en} className="-my-1 size-7 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus:opacity-100" />
            </div>
          ))}
          {card.phrase ? <PhraseCheck phrase={card.phrase} /> : null}
          {card.usage_note_vi ? (
            <div className="flex gap-1.5 pt-1 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
              <Info className="mt-0.5 size-3.5 shrink-0 text-sky-500" />
              <RichText text={card.usage_note_vi} />
            </div>
          ) : null}
        </div>
        {card.image ? (
          <WordImage
            src={card.image}
            alt={card.term}
            className="size-20 shrink-0 rounded-2xl ring-4 ring-slate-50 sm:size-28 dark:ring-slate-800"
          />
        ) : null}
      </div>

      {mnemonic || card.collocations.length || card.synonyms.length || card.antonyms.length ? (
        <div className="space-y-5 border-t border-slate-100 pt-5 dark:border-slate-800">
          {mnemonic ? (
            <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              <Lightbulb className="mt-0.5 size-5 shrink-0 text-amber-500" />
              <div className="space-y-1">
                <p className="font-bold">Mẹo nhớ</p>
                <RichText text={mnemonic} />
              </div>
            </div>
          ) : null}
          {card.collocations.length ? (
            <section>
              <Label>
                <Link2 className="mr-1 inline size-3.5" />
                {card.source === 'note' ? 'Patterns' : 'Collocations'}
              </Label>
              <ul className="grid gap-3 sm:grid-cols-2">
                {card.collocations.map((c) => (
                  <CollocationItem key={c.text} item={{ text: c.text, meaning_vi: c.meaning_vi, examples: c.example ? [c.example] : [] }} />
                ))}
              </ul>
            </section>
          ) : null}
          {card.synonyms.length || card.antonyms.length ? (
            <div className="grid gap-5 sm:grid-cols-2">
              {card.synonyms.length ? (
                <section>
                  <Label>Synonyms</Label>
                  <Chips items={card.synonyms} tone="emerald" />
                </section>
              ) : null}
              {card.antonyms.length ? (
                <section>
                  <Label>Antonyms</Label>
                  <Chips items={card.antonyms} tone="rose" />
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <OpenEntry href={card.href} label={card.phrase || card.mistake ? 'Mở bài làm' : undefined} />
    </div>
  )
}

function OpenEntry({ href, label = 'Open full entry' }: { href?: string; label?: string }) {
  return href ? (
    <Link
      to={href}
      target="_blank"
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
    >
      {label} <ExternalLink className="size-3.5" />
    </Link>
  ) : null
}

/** Vocabulary cards show the real word entry, exactly as in the vocabulary Study mode. */
function VocabAnswer({ card, lessonPath, wordId }: { card: ReviewCard; lessonPath: string; wordId: string }) {
  const lesson = useData<VocabLesson>(lessonPath)
  const word = lesson.words.find((w) => w.id === wordId)
  if (!word) return <GenericAnswer card={card} />
  return (
    <div className="animate-fade-in space-y-3">
      <WordCard word={word} defaultExpanded anchor={false} hideMnemonic className="border-0 bg-transparent p-0 shadow-none dark:bg-transparent" />
      <OpenEntry href={card.href} />
    </div>
  )
}

function GenericAnswer({ card }: { card: ReviewCard }) {
  return (
    <div className="space-y-3">
      <AnswerHeading card={card} />
      <CardBack card={card} hideMnemonic />
    </div>
  )
}

/** Everything shown once the answer is revealed. */
export function AnswerView({ card }: { card: ReviewCard }) {
  const match = card.source === 'vocabulary' ? /^\/vocabulary\/([^/]+)\/([^/#]+)#(.+)$/.exec(card.href ?? '') : null
  if (!match) return <GenericAnswer card={card} />
  return (
    <Suspense fallback={<GenericAnswer card={card} />}>
      <VocabAnswer card={card} lessonPath={`vocabulary/${match[1]}/${match[2]}.json`} wordId={decodeURIComponent(match[3])} />
    </Suspense>
  )
}

/** Term with its pronunciation and part of speech, as on the front of a recognise card. */
export function TermHeading({ card, large = true }: { card: ReviewCard; large?: boolean }) {
  const isStructure = card.part_of_speech.includes('Structure')
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="flex flex-wrap justify-center gap-1.5">
        {card.part_of_speech.map((pos) => (
          <Badge key={pos} tone="brand">
            {pos}
          </Badge>
        ))}
      </div>
      <h2
        className={
          large
            ? 'text-4xl font-extrabold tracking-tight text-balance text-slate-900 sm:text-5xl dark:text-white'
            : 'text-2xl font-extrabold text-slate-900 dark:text-white'
        }
      >
        {card.term}
      </h2>
      <div className="flex items-center gap-1">
        {!isStructure && card.pronunciation ? <span className="ipa text-lg text-slate-500 dark:text-slate-400">{card.pronunciation}</span> : null}
        <SpeakButton text={card.term} />
      </div>
    </div>
  )
}
