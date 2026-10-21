// The result pages' side of Speaking & Writing ↔ Review: the "Ôn tập" button of a phrase from outside the library (its
// card: the library card if you added the phrase to Vocabulary / Notes, else a "Speaking & Writing" card made from it),
// and the review cards you used yourself in this work.
import { BookmarkCheck, BookPlus, Check, Loader2, X } from 'lucide-react'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui'
import type { CardPhrase } from '@/types/content'
import type { PhraseGroup, WorkKind } from '@/types/practice'
import type { RealUse } from '@/types/review'
import { STAGE_LABEL } from '../review/ladder'
import { loadReviews, useReviewStore } from '../review/store'
import { phraseCardId } from './phrase-groups'
import { cardIdOf, practiceApi, waitForCards } from './practice-api'

type Work = { kind: WorkKind; id: string; title: string }
const WorkContext = createContext<Work | null>(null)

/** The work whose phrases are shown below (the "Ôn tập" buttons make cards that link back to it). */
export function PhraseWorkProvider({ work, children }: { work: Work; children: ReactNode }) {
  return <WorkContext.Provider value={work}>{children}</WorkContext.Provider>
}

/** "Ôn tập" on a phrase row; hidden outside a result page or without the review server. */
export function PhraseReviewButton({
  term,
  group,
  meaning_vi,
  example,
  phrase,
}: {
  term: string
  group: PhraseGroup
  meaning_vi?: string
  example?: string
  phrase?: CardPhrase
}) {
  const work = useContext(WorkContext)
  const { status, cards } = useReviewStore()
  const [busy, setBusy] = useState(false)
  const [cardId, setCardId] = useState<string | null>(null)
  // Its card: the library card when the phrase is in your library (asked once for the whole page).
  const [known, setKnown] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void cardIdOf(term).then((id) => live && setKnown(id))
    return () => {
      live = false
    }
  }, [term])
  const [error, setError] = useState<string | null>(null)
  if (!work || status === 'offline' || status === 'idle') return null
  if (cards[cardId ?? known ?? phraseCardId(term)]) {
    return (
      <Badge tone="emerald" title="Cụm này đang có trong ôn tập (tab Bài gần đây ở trang Review)">
        <BookmarkCheck className="size-3" /> Đang ôn
      </Badge>
    )
  }
  const add = async () => {
    setBusy(true)
    setError(null)
    try {
      const { ids } = await practiceApi.phraseCards([{ term, group, meaning_vi, example, phrase }], work)
      await waitForCards(ids)
      await loadReviews(true)
      setCardId(ids[0] ?? null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => void add()}
        title="Tạo thẻ ôn cho cụm này (dùng thẻ Vocabulary / Notes nếu cụm đã có ở đó) và thêm vào ôn tập"
        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:border-amber-400 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <BookPlus className="size-3.5" />} Ôn tập
      </button>
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </>
  )
}

/**
 * Review cards found in your own text of this work (`refPrefix`: "writing:<id>:" or "speaking:<id>:<answer>"). The scan
 * runs on the server after a review or an edit is saved: the cards are read again a moment after `stamp` changes.
 */
export function RealUsePanel({ refPrefix, stamp }: { refPrefix: string; stamp?: string }) {
  const { cards, status } = useReviewStore()
  useEffect(() => {
    if (status !== 'ready') return
    const timer = setTimeout(() => void loadReviews(true), 4000)
    return () => clearTimeout(timer)
    // Only when the text changes (not on every store update).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refPrefix, stamp])
  const uses = useMemo(() => {
    const list: RealUse[] = []
    for (const card of Object.values(cards)) for (const u of card.uses ?? []) if (u.ref.startsWith(refPrefix)) list.push(u)
    return list
  }, [cards, refPrefix])
  if (!uses.length) return null
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950/20">
      <p className="text-sm font-bold text-slate-900 dark:text-white">Thẻ ôn bạn đã tự dùng trong bài này</p>
      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
        Dùng đúng: thẻ lên bậc “Tự dùng”. Dùng sai (bài chấm đã sửa): thẻ về “Dùng đúng cụm” và đến hạn ôn ngay.
      </p>
      <ul className="space-y-1.5">
        {uses.map((u) => (
          <li key={`${u.ref}-${u.term}`} className="flex items-start gap-2 text-[13px] leading-relaxed">
            {u.ok ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <X className="mt-0.5 size-4 shrink-0 text-rose-500" />}
            <span className="min-w-0">
              <strong className="text-slate-900 dark:text-white">{u.term}</strong>
              {u.to ? (
                <span className="ml-1.5 text-xs text-slate-500">
                  {STAGE_LABEL[u.from ?? 'recognize']} → {STAGE_LABEL[u.to]}
                </span>
              ) : null}
              {!u.ok ? (
                <span className="block text-slate-600 dark:text-slate-300">
                  Bạn viết <span className="line-through decoration-rose-400">{u.wrote}</span>
                  {u.fixed ? <> → {u.fixed}</> : null}
                  {u.why ? <span className="text-slate-500"> — {u.why}</span> : null}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
