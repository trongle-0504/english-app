import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, BookOpen, ChevronRight, CornerDownLeft, ExternalLink, Languages, Layers, Link2, Loader2, NotebookPen, Search, Tags, X } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge, Button, Kbd } from '@/components/ui'
import { cn } from '@/lib/cn'
import { SpeakButton } from '@/components/SpeakButton'
import { loadData, onDataInvalidated } from '@/lib/data'
import type { LookupIndex, VocabRelation, VocabWord } from '@/types/content'
import type { DolHit, LookupExtra, TopicHit } from '@/types/lookup'
import { NoteCard } from '../notes/NoteCard'
import { NOTE_TYPE_TONES, noteKey } from '../notes/noteTypes'
import { slugify } from '@/lib/text'
import { ReviewToggle } from '../review/ReviewButtons'
import { RichText } from '../words/RichText'
import { WordCard } from '../words/WordCard'
import { DolStatusBanner } from '../practice/DolStatusBanner'
import { DolCard, TopicCard } from './ExtraCards'
import { createLookup, type LookupResult } from './rank'

type Search = ReturnType<typeof createLookup>

interface Dictionary {
  search: Search
  /** Note ids and lower-cased titles → id, so related notes link like on the Notes page. */
  noteIds: ReadonlyMap<string, string>
}

const plain = (s?: string) => s?.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()

const OPEN_IN: Record<LookupResult['kind'], string> = {
  vocabulary: 'Vocabulary',
  collocation: 'Collocations',
  'word-collocation': 'Vocabulary',
  note: 'Notes',
}

const KIND_STYLE: Record<LookupResult['kind'], { icon: typeof BookOpen; className: string }> = {
  vocabulary: { icon: BookOpen, className: 'bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300' },
  collocation: { icon: Layers, className: 'bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300' },
  'word-collocation': { icon: Link2, className: 'bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300' },
  note: { icon: NotebookPen, className: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300' },
}

function SourceBadge({ result }: { result: LookupResult }) {
  switch (result.kind) {
    case 'vocabulary':
      return <Badge tone="sky">Vocabulary</Badge>
    case 'collocation':
      return <Badge tone="violet">Collocation · {result.lesson}</Badge>
    case 'word-collocation':
      return <Badge tone="violet">Collocation · {result.parent.word}</Badge>
    case 'note':
      return <Badge tone={NOTE_TYPE_TONES[result.note.type]}>Note · {result.note.type}</Badge>
  }
}

const pronunciationOf = (result: LookupResult) =>
  result.kind === 'vocabulary' || result.kind === 'collocation'
    ? result.word.pronunciation
    : result.kind === 'word-collocation'
      ? result.relation.pronunciation
      : result.note.type === 'Structure'
        ? undefined
        : result.note.pronunciation

function ResultRow({ result, active, onSelect, onHover }: { result: LookupResult; active: boolean; onSelect: () => void; onHover: () => void }) {
  const style = KIND_STYLE[result.kind]
  const ipa = pronunciationOf(result)
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseMove={onHover}
      className={cn('flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors', active && 'bg-slate-100 dark:bg-slate-800')}
    >
      <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', style.className)}>
        <style.icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-semibold text-slate-900 dark:text-white">{result.term}</span>
          {ipa ? <span className="ipa text-xs text-slate-400">{ipa}</span> : null}
          <SourceBadge result={result} />
        </span>
        {result.meaning ? <span className="mt-0.5 line-clamp-1 text-sm text-slate-500 dark:text-slate-400">{plain(result.meaning)}</span> : null}
      </span>
      {active ? <CornerDownLeft className="mt-2 size-4 shrink-0 text-slate-400" /> : null}
    </button>
  )
}

/** A collocation listed inside a vocabulary word, with a way into that word. */
function WordCollocationCard({ relation, parent, onOpenParent }: { relation: VocabRelation; parent: VocabWord; onOpenParent: () => void }) {
  return (
    <article className="rounded-3xl border border-slate-200/80 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          <RichText text={relation.text} />
        </h3>
        <SpeakButton text={relation.text} className="-ml-1" />
        {relation.pronunciation ? <span className="ipa text-base text-slate-500 dark:text-slate-400">{relation.pronunciation}</span> : null}
        {relation.type ? <Badge tone="violet">{relation.type}</Badge> : null}
        <ReviewToggle id={`wcolloc:${parent.id}:${slugify(relation.text)}`} className="ml-auto" />
      </div>
      {relation.meaning_vi ? <RichText text={relation.meaning_vi} className="mt-4 block text-[15px] text-slate-800 dark:text-slate-100" /> : null}
      {relation.examples?.length ? (
        <ul className="mt-3 space-y-1.5 border-l-2 border-brand-200 pl-4 dark:border-brand-800">
          {relation.examples.map((example) => (
            <li key={example} className="flex items-start gap-1 text-sm text-slate-600 italic dark:text-slate-300">
              <RichText text={example} className="flex-1" />
              <SpeakButton text={example} className="-my-1 size-7" />
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        onClick={onOpenParent}
        className="mt-5 flex w-full items-center gap-3 rounded-2xl bg-slate-50 p-3 text-left transition-colors hover:bg-slate-100 dark:bg-slate-950/40 dark:hover:bg-slate-800/60"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300">
          <BookOpen className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-slate-400">Collocation of the word</span>
          <span className="block font-semibold text-slate-900 dark:text-white">{parent.word}</span>
        </span>
        <ChevronRight className="size-4 text-slate-400" />
      </button>
    </article>
  )
}

/** A result row of any source: your library, a topic collocation, a DOL headword. */
type Item =
  | { type: 'library'; key: string; result: LookupResult }
  | { type: 'topic'; key: string; hit: TopicHit }
  | { type: 'dol'; key: string; hit: DolHit }

/** The sources in order of trust: yours first. */
const SECTION: Record<Item['type'], string> = {
  library: 'Your library · Vocabulary, Collocations, Notes, Topic collocations',
  topic: 'Your library · Vocabulary, Collocations, Notes, Topic collocations',
  dol: 'DOL dictionary · Vietnamese → English',
}

/** A topic collocation or a DOL headword (its English shows when the entry is cached; else it is fetched on open). */
function ExtraRow({ item, active, onSelect, onHover }: { item: Item; active: boolean; onSelect: () => void; onHover: () => void }) {
  if (item.type === 'library') return null
  const topic = item.type === 'topic'
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseMove={onHover}
      className={cn('flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors', active && 'bg-slate-100 dark:bg-slate-800')}
    >
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
          topic ? 'bg-teal-50 text-teal-600 dark:bg-teal-950/60 dark:text-teal-300' : 'bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-300',
        )}
      >
        {topic ? <Tags className="size-4" /> : <Languages className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-semibold text-slate-900 dark:text-white">{topic ? item.hit.term : item.hit.vi}</span>
          {topic ? <Badge tone="teal">Topic · {item.hit.topic}</Badge> : <Badge tone="orange">DOL</Badge>}
        </span>
        <span className="mt-0.5 line-clamp-1 text-sm text-slate-500 dark:text-slate-400">
          {topic ? item.hit.meaning_vi : item.hit.en ? `→ ${item.hit.en}` : 'Open to look up its English'}
        </span>
      </span>
      {active ? <CornerDownLeft className="mt-2 size-4 shrink-0 text-slate-400" /> : null}
    </button>
  )
}

/** Header dictionary: search your library, then topic collocations and the DOL dictionary; show the full entry in place. */
export default function WordLookup({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [dictionary, setDictionary] = useState<Dictionary | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<LookupResult | null>(null)
  const [active, setActive] = useState(0)
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    if (!open || dictionary) return
    loadData<LookupIndex>('lookup.json').then(
      (index) => {
        const noteIds = new Map<string, string>()
        for (const note of index.notes) {
          noteIds.set(noteKey(note.title), note.id)
          noteIds.set(noteKey(note.id), note.id)
        }
        setDictionary({ search: createLookup(index), noteIds })
      },
      () => setFailed(true),
    )
  }, [open, dictionary])

  // New words or notes (admin saves, edits under content/) invalidate the data; rebuild on next use.
  useEffect(
    () =>
      onDataInvalidated((prefix) => {
        if ('lookup.json'.startsWith(prefix)) setDictionary(null)
      }),
    [],
  )

  const results = useMemo(() => (dictionary ? dictionary.search(deferredQuery) : []), [dictionary, deferredQuery])

  // Topic collocations and the DOL dictionary (server), after your library: asked a moment after typing stops.
  const [extra, setExtra] = useState<{ q: string; data: LookupExtra } | null>(null)
  const [extraSelected, setExtraSelected] = useState<Item | null>(null)
  useEffect(() => {
    const q = deferredQuery.trim()
    if (!open || q.length < 2) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/lookup?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((res) => (res.ok && (res.headers.get('content-type') ?? '').includes('json') ? (res.json() as Promise<LookupExtra>) : null))
        .then((data) => data && setExtra({ q, data }))
        // No local server (static hosting): your library is still searched.
        .catch(() => {})
    }, 200)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [open, deferredQuery])
  const extraNow = extra && extra.q === deferredQuery.trim() ? extra.data : null
  // Your library and your topic collocations together, by how well they match (the library first on a tie); then the
  // DOL dictionary, which is not yours.
  const items = useMemo<Item[]>(() => {
    const ours = [
      ...results.map((result) => ({ rank: result.rank ?? 9, order: 0, item: { type: 'library', key: result.key, result } as Item })),
      ...(extraNow?.topic ?? []).map((hit) => ({ rank: hit.rank, order: 1, item: { type: 'topic', key: `t:${hit.id}`, hit } as Item })),
    ]
      .sort((a, b) => a.rank - b.rank || a.order - b.order)
      .slice(0, 10)
      .map((x) => x.item)
    return [...ours, ...(extraNow?.dol ?? []).map((hit): Item => ({ type: 'dol', key: `d:${hit.url}`, hit }))]
  }, [results, extraNow])
  const [shownItems, setShownItems] = useState(items)
  if (shownItems !== items) {
    setShownItems(items)
    if (shownItems.length === 0 || items[0]?.key !== shownItems[0]?.key) setActive(0)
  }
  const pick = (item: Item) => (item.type === 'library' ? setSelected(item.result) : setExtraSelected(item))

  const close = () => onOpenChange(false)
  const trimmed = deferredQuery.trim()
  const loading = open && !dictionary && !failed

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value)
        if (!value) {
          setSelected(null)
          setExtraSelected(null)
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="animate-scale-in fixed top-[6dvh] left-1/2 z-50 flex max-h-[88dvh] w-[min(56rem,calc(100vw-1.5rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl outline-none dark:border-slate-800 dark:bg-slate-950"
        >
          <Dialog.Title className="sr-only">Look up a word</Dialog.Title>

          {selected ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                  <ArrowLeft className="size-4" /> Results
                </Button>
                <div className="flex items-center gap-1">
                  <Link
                    to={selected.href}
                    onClick={close}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/50"
                  >
                    Open in {OPEN_IN[selected.kind]} <ExternalLink className="size-3.5" />
                  </Link>
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Close">
                      <X className="size-4" />
                    </Button>
                  </Dialog.Close>
                </div>
              </div>
              <div className="scrollbar-thin animate-slide-up overflow-y-auto p-3 sm:p-4">
                {selected.kind === 'vocabulary' || selected.kind === 'collocation' ? (
                  <WordCard
                    key={selected.key}
                    word={selected.word}
                    defaultExpanded
                    anchor={false}
                    reviewId={selected.kind === 'vocabulary' ? `vocab:${selected.word.id}` : `colloc:${selected.lessonId}:${selected.word.id}`}
                  />
                ) : selected.kind === 'word-collocation' ? (
                  <WordCollocationCard
                    relation={selected.relation}
                    parent={selected.parent}
                    onOpenParent={() =>
                      setSelected({
                        kind: 'vocabulary',
                        key: `v:${selected.parent.id}`,
                        term: selected.parent.word,
                        meaning: selected.parent.senses[0]?.definition_vi,
                        word: selected.parent,
                        href: selected.href,
                      })
                    }
                  />
                ) : (
                  <NoteCard note={selected.note} lookup={dictionary?.noteIds ?? new Map()} onRelatedClick={close} />
                )}
              </div>
            </>
          ) : extraSelected && extraSelected.type !== 'library' ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
                <Button variant="ghost" size="sm" onClick={() => setExtraSelected(null)}>
                  <ArrowLeft className="size-4" /> Results
                </Button>
                <Dialog.Close asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Close">
                    <X className="size-4" />
                  </Button>
                </Dialog.Close>
              </div>
              <div className="scrollbar-thin animate-slide-up overflow-y-auto p-3 sm:p-4">
                {extraSelected.type === 'topic' ? <TopicCard hit={extraSelected.hit} /> : <DolCard key={extraSelected.hit.url} hit={extraSelected.hit} />}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
                {loading ? <Loader2 className="size-5 animate-spin text-slate-400" /> : <Search className="size-5 text-slate-400" />}
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setActive((i) => Math.min(i + 1, items.length - 1))
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setActive((i) => Math.max(i - 1, 0))
                    } else if (e.key === 'Enter' && items[active]) {
                      e.preventDefault()
                      pick(items[active])
                    }
                  }}
                  placeholder="Look up a word or phrase — English or Vietnamese, e.g. đàm phán"
                  aria-label="Look up a word or phrase"
                  className="h-14 flex-1 bg-transparent text-base text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white"
                />
                <Kbd>Esc</Kbd>
              </div>
              <div className="scrollbar-thin overflow-y-auto p-2">
                {failed ? (
                  <p className="px-3 py-10 text-center text-sm text-rose-600">Could not load the dictionary. Reload the page and try again.</p>
                ) : !trimmed || trimmed.length < 2 ? (
                  <p className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    Searches your <span className="font-semibold text-slate-700 dark:text-slate-200">Vocabulary</span>,{' '}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Collocations</span> and{' '}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Notes</span> first, then{' '}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Topic collocations</span> and the{' '}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">DOL dictionary</span> (Vietnamese → English).
                  </p>
                ) : loading ? null : items.length === 0 ? (
                  <p className="px-3 py-10 text-center text-sm text-slate-500">{extraNow ? `Nothing matches “${trimmed}”.` : 'Searching…'}</p>
                ) : (
                  items.map((item, index) => {
                    const heading = index === 0 || SECTION[items[index - 1].type] !== SECTION[item.type] ? SECTION[item.type] : null
                    return (
                      <div key={item.key}>
                        {heading ? (
                          <p className="px-3 pt-3 pb-1 text-[11px] font-bold tracking-wide text-slate-400 uppercase first:pt-1">{heading}</p>
                        ) : null}
                        {item.type === 'library' ? (
                          <ResultRow result={item.result} active={index === active} onHover={() => setActive(index)} onSelect={() => pick(item)} />
                        ) : (
                          <ExtraRow item={item} active={index === active} onHover={() => setActive(index)} onSelect={() => pick(item)} />
                        )}
                      </div>
                    )
                  })
                )}
                {trimmed.length >= 2 ? <DolStatusBanner compact className="mx-1 mt-2" /> : null}
                {trimmed.length >= 2 && extraNow && !extraNow.dolReady ? (
                  <p className="px-3 pt-2 text-xs text-slate-400">The DOL word list is being downloaded; try again in a minute.</p>
                ) : null}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
