// "Bài gần đây": the phrases of your recent work that are not in Vocabulary / Notes. Their cards ("Speaking & Writing")
// are only recognised and recalled; the ones you pick are added to the library — a full entry written by the Admin
// generator, with the Tự dùng questions, rewrites and dictation of "Luyện dùng từ" — one after the other.
import { Check, ExternalLink, Loader2, Plus, Square, SquareCheck, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button, Card } from '@/components/ui'
import { AdminApiError } from '@/features/admin/api'
import { cn } from '@/lib/cn'
import { PHRASE_GROUP_LABEL, PHRASE_GROUP_LABEL_EN, type PhraseGroup, type RecentPhrase, type RecentResponse } from '@/types/practice'
import { addToLibrary, type LibraryTarget } from '../practice/library-add'
import { practiceApi } from '../practice/practice-api'
import { InfoTip } from './InfoTip'
import { loadReviews, removeFromReview, useReviewStore } from './store'

/** A card of the library: Vocabulary, Collocations (lessons and inside words), Notes. */
const isLibraryCard = (id: string) => /^(vocab|colloc|wcolloc|note):/.test(id)

const GROUP_DOT: Record<PhraseGroup, string> = { library: 'bg-brand-500', extra: 'bg-violet-500', wording: 'bg-slate-400' }

type Outcome = { ok: boolean; text: string; href?: string }

export function NotInLibrary({
  data,
  onAdded,
  onCreateCards,
}: {
  data: RecentResponse
  onAdded: () => Promise<unknown>
  onCreateCards: (ids: string[]) => Promise<void>
}) {
  const review = useReviewStore()
  // Each phrase once (its first work), only those whose card is not a library card.
  const items = useMemo(() => {
    const seen = new Map<string, RecentPhrase & { work: string }>()
    for (const w of data.works) for (const p of w.phrases) if (!isLibraryCard(p.id) && !seen.has(p.id)) seen.set(p.id, { ...p, work: w.title })
    return [...seen.values()]
  }, [data])
  const [group, setGroup] = useState<PhraseGroup | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState<LibraryTarget>('vocabulary')
  const [running, setRunning] = useState<{ at: number; total: number; term: string } | null>(null)
  const [reviewRunning, setReviewRunning] = useState(false)
  const [outcomes, setOutcomes] = useState<Map<string, Outcome>>(new Map())
  const stop = useRef(false)

  const shown = items.filter((i) => !group || i.group === group)
  const counts = (Object.keys(PHRASE_GROUP_LABEL) as PhraseGroup[])
    .map((g) => ({ g, n: items.filter((i) => i.group === g).length }))
    .filter((c) => c.n)
  const allShown = shown.length > 0 && shown.every((i) => picked.has(i.id))
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])))
  const toggleAll = () =>
    setPicked((p) => (allShown ? new Set([...p].filter((id) => !shown.some((i) => i.id === id))) : new Set([...p, ...shown.map((i) => i.id)])))

  const run = async () => {
    const queue = items.filter((i) => picked.has(i.id) && !outcomes.get(i.id)?.ok)
    stop.current = false
    for (const [n, item] of queue.entries()) {
      if (stop.current) break
      setRunning({ at: n + 1, total: queue.length, term: item.term })
      let outcome: Outcome
      try {
        const done = await addToLibrary(target, { phrase: item.term, meaning_vi: item.meaning_vi ?? '', example: item.example ?? item.term })
        await practiceApi.libraryAdded([{ term: item.term, cardId: done.cardId }])
        outcome = { ok: true, text: done.label, href: done.href }
      } catch (e) {
        // Already in the library (409): the phrase is linked to that entry's card when its words match.
        const exists = e instanceof AdminApiError && e.status === 409
        if (exists) await practiceApi.libraryAdded([{ term: item.term }]).catch(() => {})
        outcome = { ok: exists, text: exists ? 'Already in the library' : (e as Error).message }
      }

      setOutcomes((m) => new Map(m).set(item.id, outcome))
      if (outcome.ok) setPicked((p) => new Set([...p].filter((x) => x !== item.id)))
    }
    setRunning(null)
    await loadReviews(true)
    await onAdded()
  }

  const addToReview = async () => {
    if (!picked.size) return
    setReviewRunning(true)
    try {
      await onCreateCards([...picked])
      setPicked(new Set())
    } finally {
      setReviewRunning(false)
    }
  }

  const removeSelectedFromReview = async () => {
    const ids = [...picked].filter((id) => Boolean(review.cards[id]))
    if (!ids.length) return
    setReviewRunning(true)
    try {
      await removeFromReview(ids)
      setPicked((current) => new Set([...current].filter((id) => !ids.includes(id))))
      await onAdded()
    } finally {
      setReviewRunning(false)
    }
  }

  const selectedReviewCount = [...picked].filter((id) => Boolean(review.cards[id])).length

  if (!items.length) return null
  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          Phrases not in Vocabulary / Notes <span className="font-semibold text-slate-400 tabular-nums">{items.length}</span>
          <InfoTip>
            Thẻ của các cụm này chỉ ôn Nhận ra và Nhớ ra từ (không vào Luyện dùng từ). Muốn học kỹ cụm nào thì chọn và thêm vào Vocabulary hoặc Notes:
            AI viết mục đầy đủ (nghĩa, ví dụ, collocation, câu hỏi Tự dùng, bài Viết lại câu, câu Nghe chép), thẻ thư viện thay cho thẻ cụm (tiến độ
            đã có được giữ) và được học ngay hôm nay. Mỗi cụm mất khoảng 20–40 giây, thêm lần lượt.
          </InfoTip>
        </h3>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs font-semibold text-slate-500">Filter:</span>
          <button
            type="button"
            onClick={() => setGroup(null)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs font-semibold',
              !group
                ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-300'
                : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300',
            )}
          >
            All
          </button>
          {counts.map(({ g, n }) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroup(group === g ? null : g)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                group === g
                  ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-300'
                  : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300',
              )}
            >
              <span className={cn('size-2 rounded-full', GROUP_DOT[g])} />
              {PHRASE_GROUP_LABEL_EN[g]} <span className="opacity-70 tabular-nums">{n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
        <button
          type="button"
          onClick={toggleAll}
          disabled={Boolean(running)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 disabled:opacity-50 dark:text-slate-300"
        >
          {allShown ? <SquareCheck className="size-4 text-brand-600" /> : <Square className="size-4" />} Select all
        </button>
        <span className="text-xs text-slate-400">· {picked.size} selected</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Save to:</span>
          <div
            role="radiogroup"
            aria-label="Save to"
            className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800"
          >
            {(['vocabulary', 'note'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={target === t}
                disabled={Boolean(running)}
                onClick={() => setTarget(t)}
                className={cn(
                  'rounded-lg px-3 py-1 text-xs font-semibold transition-all',
                  target === t
                    ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-700 dark:text-white dark:ring-slate-600'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
                )}
              >
                {t === 'vocabulary' ? 'Vocabulary' : 'Notes'}
              </button>
            ))}
          </div>
          <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:block dark:bg-slate-700" aria-hidden />
          {running || reviewRunning ? (
            <Button size="sm" variant="outline" disabled={reviewRunning} onClick={() => (stop.current = true)}>
              {reviewRunning ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              {reviewRunning ? 'Adding selected cards…' : 'Stop after this one'}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={!picked.size} onClick={() => void addToReview()}>
                <Plus className="size-4" /> Add to review {picked.size ? `(${picked.size})` : ''}
              </Button>
              {selectedReviewCount ? (
                <Button size="sm" variant="outline" disabled={reviewRunning} onClick={() => void removeSelectedFromReview()}>
                  <X className="size-4" /> Remove from review ({selectedReviewCount})
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={!picked.size}
                onClick={() => void run()}
                className="shadow-md shadow-brand-600/25 disabled:bg-slate-200 disabled:text-slate-500 disabled:opacity-100 disabled:shadow-none dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
                title={picked.size ? undefined : 'Tick chọn cụm ở danh sách bên dưới trước'}
              >
                <Plus className="size-4" /> {picked.size ? `Add ${picked.size} ${picked.size === 1 ? 'phrase' : 'phrases'}` : 'Add phrases'}
              </Button>
            </>
          )}
        </div>
      </div>
      {running ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Loader2 className="size-4 animate-spin" /> Adding {running.at}/{running.total}: <strong>{running.term}</strong> (about 20–40 s each)
        </p>
      ) : null}

      <ul className="mt-2 max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
        {shown.map((item) => {
          const outcome = outcomes.get(item.id)
          const stored = review.cards[item.id]
          return (
            <li key={item.id} className="flex items-start gap-2.5 py-2">
              <button
                type="button"
                onClick={() => toggle(item.id)}
                disabled={Boolean(running) || outcome?.ok}
                aria-pressed={picked.has(item.id)}
                className="relative mt-0.5 text-slate-400 hit-area disabled:opacity-40"
                title="Chọn"
              >
                {picked.has(item.id) ? <SquareCheck className="size-4 text-brand-600" /> : <Square className="size-4" />}
              </button>
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', GROUP_DOT[item.group])} title={PHRASE_GROUP_LABEL[item.group]} />
              <div className="min-w-0 flex-1 text-sm">
                <p>
                  <span className="font-semibold text-slate-900 dark:text-white">{item.term}</span>
                  {item.meaning_vi ? <span className="text-slate-500 dark:text-slate-400"> — {item.meaning_vi}</span> : null}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {item.work}
                  {stored ? ` · phrase card ${stored.fsrs.state === 0 ? 'new' : 'learning'}` : !item.exists ? ' · no card yet' : ''}
                </p>
              </div>
              {outcome ? (
                outcome.ok ? (
                  outcome.href ? (
                    <Link
                      to={outcome.href}
                      target="_blank"
                      className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                    >
                      <Check className="size-3.5" /> {outcome.text} <ExternalLink className="size-3" />
                    </Link>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      <Check className="size-3.5" /> {outcome.text}
                    </span>
                  )
                ) : (
                  <span className="max-w-48 shrink-0 text-xs text-rose-600" title={outcome.text}>
                    {outcome.text}
                  </span>
                )
              ) : null}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
