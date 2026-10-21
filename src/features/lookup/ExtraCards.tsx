// The lookup's entries from outside your library: a topic collocation, and a DOL dictionary entry (fetched when you open
// it). Either can be added to Vocabulary / Notes — a full entry written by the Admin generator, then a review card.
import { Check, CheckCircle2, ExternalLink, FilePlus2, Loader2, NotebookText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui'
import { SpeakButton } from '@/components/SpeakButton'
import { AdminApiError } from '@/features/admin/api'
import { cn } from '@/lib/cn'
import type { DolEntryView, DolHit, DolNote, TopicHit } from '@/types/lookup'
import { addToLibrary, type LibraryTarget } from '../practice/library-add'

/** Vocabulary / Notes buttons: write the entry, then a link to it. */
function AddToLibrary({ phrase, meaning, example }: { phrase: string; meaning: string; example: string }) {
  const [busy, setBusy] = useState<LibraryTarget | null>(null)
  const [done, setDone] = useState<{ label: string; href: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const add = async (target: LibraryTarget) => {
    setBusy(target)
    setError(null)
    try {
      setDone(await addToLibrary(target, { phrase, meaning_vi: meaning, example }))
    } catch (e) {
      setError(e instanceof AdminApiError && e.status === 409 ? 'Đã có trong thư viện.' : (e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  if (done)
    return (
      <Link to={done.href} className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-300">
        <Check className="size-4" /> Added to {done.label}
      </Link>
    )
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-slate-500">Learn it in detail:</span>
      {(['vocabulary', 'note'] as const).map((t) => (
        <button
          key={t}
          type="button"
          disabled={busy !== null}
          onClick={() => void add(t)}
          title="AI viết mục đầy đủ (nghĩa, ví dụ, collocation, câu hỏi Tự dùng…) và thêm thẻ vào ôn tập"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-brand-950/40"
        >
          {busy === t ? <Loader2 className="size-3.5 animate-spin" /> : <FilePlus2 className="size-3.5" />} Add to{' '}
          {t === 'vocabulary' ? 'Vocabulary' : 'Notes'}
        </button>
      ))}
      {busy ? <span className="text-xs text-slate-500">Writing the entry (about 20–40 s)…</span> : null}
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </div>
  )
}

const CARD = 'rounded-3xl border border-slate-200/80 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900/60'

export function TopicCard({ hit }: { hit: TopicHit }) {
  return (
    <article className={CARD}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">{hit.term}</h3>
        <SpeakButton text={hit.term} className="-ml-1" />
        {hit.pronunciation ? <span className="ipa text-base text-slate-500 dark:text-slate-400">{hit.pronunciation}</span> : null}
        {hit.part_of_speech ? <Badge tone="teal">{hit.part_of_speech}</Badge> : null}
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Topic collocations · {hit.topic}
        {hit.subTopic ? ` › ${hit.subTopic}` : ''}
        {hit.group ? ` · ${hit.group}` : ''}
      </p>
      <p className="mt-4 text-[15px] text-slate-800 dark:text-slate-100">{hit.meaning_vi}</p>
      {hit.examples.length ? (
        <ul className="mt-3 space-y-1.5 border-l-2 border-teal-200 pl-4 dark:border-teal-800">
          {hit.examples.map((e) => (
            <li key={e.en} className="flex items-start gap-1 text-sm text-slate-600 italic dark:text-slate-300">
              <span className="flex-1">
                {e.en}
                {e.vi ? <span className="block text-[13px] text-slate-400 not-italic">{e.vi}</span> : null}
              </span>
              <SpeakButton text={e.en} className="-my-1 size-7" />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
        <AddToLibrary phrase={hit.term} meaning={hit.meaning_vi} example={hit.examples[0]?.en ?? hit.term} />
      </div>
    </article>
  )
}

/** DOL's note ("Ghi chú"): the synonyms told apart, as DOL lays it out — ✅ before each, red-underlined labels. */
function DolNoteView({ note }: { note: DolNote }) {
  return (
    <section className="mt-5 rounded-2xl border border-amber-100 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-100">
        <NotebookText className="size-4 text-amber-600 dark:text-amber-400" /> Notes · DOL
      </p>
      <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
        {note.map((line, i) =>
          line.length ? (
            <p key={i}>
              {line.map((r, k) =>
                r.check ? (
                  <CheckCircle2 key={k} className="mr-1 inline size-4 -translate-y-px text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <span
                    key={k}
                    className={cn(
                      r.bold && 'font-semibold text-slate-900 dark:text-white',
                      r.italic && 'text-slate-500 italic dark:text-slate-400',
                      r.label && 'underline decoration-rose-400 decoration-2 underline-offset-4',
                    )}
                  >
                    {r.text}
                  </span>
                ),
              )}
            </p>
          ) : (
            <div key={i} className="h-2" />
          ),
        )}
      </div>
    </section>
  )
}

/** A DOL entry: fetched (and cached by the server) when opened. */
export function DolCard({ hit }: { hit: DolHit }) {
  const [entry, setEntry] = useState<DolEntryView | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    fetch(`/api/lookup/dol?url=${encodeURIComponent(hit.url)}`)
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as DolEntryView & { error?: string }
        if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`)
        if (live) setEntry(json)
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [hit.url])

  if (error) return <p className={`${CARD} text-sm text-rose-600`}>{error}</p>
  if (!entry)
    return (
      <p className={`${CARD} flex items-center gap-2 text-sm text-slate-500`}>
        <Loader2 className="size-4 animate-spin" /> Looking up “{hit.vi}” in the DOL dictionary…
      </p>
    )
  return (
    <article className={CARD}>
      <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{entry.vi}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">{entry.en}</h3>
        <SpeakButton text={entry.en} className="-ml-1" />
        {entry.pronounce ? <span className="ipa text-base text-slate-500 dark:text-slate-400">/{entry.pronounce}/</span> : null}
        {entry.pos.map((p) => (
          <Badge key={p} tone="orange">
            {p.toLowerCase()}
          </Badge>
        ))}
      </div>
      {entry.definitionVi ? <p className="mt-4 text-[15px] text-slate-800 dark:text-slate-100">{entry.definitionVi}</p> : null}
      {entry.sameEn || entry.sameVi ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Similar: {[entry.sameEn, entry.sameVi].filter(Boolean).join(' · ')}</p>
      ) : null}
      {entry.examples.length ? (
        <ul className="mt-3 space-y-2 border-l-2 border-orange-200 pl-4 dark:border-orange-900">
          {entry.examples.map((e) => (
            <li key={e.en} className="flex items-start gap-1 text-sm">
              <span className="flex-1">
                <span className="block text-slate-700 italic dark:text-slate-200">{e.en}</span>
                {e.vi ? <span className="block text-[13px] text-slate-400">{e.vi}</span> : null}
              </span>
              <SpeakButton text={e.en} className="-my-1 size-7" />
            </li>
          ))}
        </ul>
      ) : null}
      {entry.note ? <DolNoteView note={entry.note} /> : null}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
        <AddToLibrary
          phrase={entry.en}
          meaning={[entry.vi, entry.definitionVi].filter(Boolean).join(' — ')}
          example={entry.examples[0]?.en ?? entry.en}
        />
        <a
          href={entry.page}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-brand-600"
        >
          DOL dictionary <ExternalLink className="size-3.5" />
        </a>
      </div>
    </article>
  )
}
