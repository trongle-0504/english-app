// /practice/mistakes — Sổ lỗi: the mistakes of your own writing across every Writing review (and the phrases flagged in
// the Speaking answers / model essays you edited): by kind, the ones you make again, how many per 100 words over time,
// and a review card for each ("this is a sentence you wrote — correct it").
import { BookmarkCheck, BookmarkPlus, ExternalLink, Loader2, NotebookPen, Repeat, TrendingDown } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge, Button, Card, EmptyState, PageHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import { MISTAKE_LABEL, WORK_LABEL, type MistakeBook, type MistakeCategory, type MistakeItem } from '@/types/practice'
import { loadReviews, useReviewStore } from '../review/store'
import { practiceApi, waitForCards } from './practice-api'

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
  })

/** Your sentence with the wrong words underlined. */
function Sentence({ item }: { item: MistakeItem }) {
  const at = item.sentence.toLowerCase().indexOf(item.wrong.toLowerCase())
  if (at < 0) return <span>{item.sentence}</span>
  return (
    <span>
      {item.sentence.slice(0, at)}
      <mark className="rounded bg-rose-50 px-0.5 text-rose-800 underline decoration-rose-400 decoration-wavy underline-offset-4 dark:bg-rose-950/50 dark:text-rose-200">
        {item.sentence.slice(at, at + item.wrong.length)}
      </mark>
      {item.sentence.slice(at + item.wrong.length)}
    </span>
  )
}

/** Mistakes per 100 words of each Writing review: are they going down? */
function Trend({ points }: { points: MistakeBook['trend'] }) {
  if (points.length < 2) return null
  const max = Math.max(...points.map((p) => p.per100), 1)
  const first = points.slice(0, Math.ceil(points.length / 2))
  const last = points.slice(Math.floor(points.length / 2))
  const avg = (ps: typeof points) => ps.reduce((s, p) => s + p.per100, 0) / ps.length
  const change = avg(last) - avg(first)
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
        <TrendingDown className="size-4 text-emerald-500" /> Lỗi trên 100 từ, từng bài Writing
      </h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Chỉ tính lỗi sai (không tính chỗ AI nâng cấp cách diễn đạt).{' '}
        {Math.abs(change) >= 0.3 ? (
          <span className={change < 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-600'}>
            Nửa sau {change < 0 ? 'giảm' : 'tăng'} {Math.abs(change).toFixed(1)} lỗi/100 từ so với nửa đầu.
          </span>
        ) : (
          'Gần như không đổi giữa các bài.'
        )}
      </p>
      <div className="mt-4 flex h-32 items-end gap-2">
        {points.map((p) => (
          <Link
            key={p.id}
            to={`/practice/writing-review?id=${p.id}`}
            title={`${p.title}\n${p.errors} lỗi / ${p.words} từ`}
            className="group flex min-w-0 flex-1 flex-col items-center gap-1"
          >
            <span className="text-[11px] font-semibold text-slate-500 tabular-nums">{p.per100}</span>
            <span
              className="w-full rounded-t-md bg-rose-300 transition-colors group-hover:bg-rose-400 dark:bg-rose-800"
              style={{ height: `${Math.max(4, (p.per100 / max) * 90)}px` }}
            />
            <span className="text-[10px] text-slate-400 tabular-nums">{dayOf(p.at)}</span>
          </Link>
        ))}
      </div>
    </Card>
  )
}

export default function MistakesPage() {
  const review = useReviewStore()
  const [book, setBook] = useState<MistakeBook | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState<MistakeCategory | null>(null)
  const [withImprove, setWithImprove] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setBook(await practiceApi.mistakes())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => void load(), [load])

  const groupByKey = useMemo(() => new Map((book?.groups ?? []).map((g) => [g.key, g])), [book])
  const repeated = useMemo(() => (book?.groups ?? []).filter((g) => g.count > 1 && g.right), [book])
  const items = useMemo(
    () => (book?.items ?? []).filter((i) => (!category || i.category === category) && (withImprove || i.severity === 'error')),
    [book, category, withImprove],
  )

  const makeCards = async (keys: string[], label: string) => {
    setBusy(label)
    setMessage(null)
    try {
      const { ids } = await practiceApi.mistakeCards(keys)
      await waitForCards(ids)
      await loadReviews(true)
      await load()
      setMessage(`Đã tạo ${ids.length} thẻ “Sửa lỗi” — chúng có trong phiên ôn của trang Review (bộ thẻ Sổ lỗi).`)
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /** The card button of a mistake: "Ôn lỗi này", or its state once it is a card. */
  const CardButton = ({ itemKey, right }: { itemKey: string; right: string }) => {
    if (!right) return <span className="text-xs text-slate-400">chưa có cách sửa</span>
    const cardId = groupByKey.get(itemKey)?.cardId
    if (cardId && review.cards[cardId])
      return (
        <Badge tone="emerald">
          <BookmarkCheck className="size-3" /> Đang ôn
        </Badge>
      )
    return (
      <button
        type="button"
        disabled={Boolean(busy)}
        onClick={() => void makeCards([itemKey], itemKey)}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-brand-700 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-brand-950/40"
      >
        {busy === itemKey ? <Loader2 className="size-3.5 animate-spin" /> : <BookmarkPlus className="size-3.5" />} Ôn lỗi này
      </button>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Writing · Speaking"
        title="Sổ lỗi"
        description="Lỗi trong chính bài viết của bạn, gom từ mọi bài Writing Review (và cụm bị đánh dấu đáng ngờ trong câu trả lời bạn tự sửa). Lỗi nào lặp lại, lỗi loại gì nhiều nhất, và biến lỗi thành thẻ ôn: thẻ cho bạn xem lại câu mình từng viết để sửa cho đúng."
      />
      {error ? <p className="mb-4 text-sm text-rose-600">{error}</p> : null}
      {!book ? (
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" /> Đang gom lỗi…
        </p>
      ) : !book.items.length ? (
        <EmptyState
          icon={<NotebookPen className="size-8" />}
          title="Chưa có lỗi nào"
          description="Chấm một bài ở Writing Review: các chỗ sửa sẽ vào sổ này."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Trend points={book.trend} />
            <Card className="p-4 sm:p-5">
              <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                <Repeat className="size-4 text-rose-500" /> Lỗi lặp lại ({repeated.length})
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">Cùng một lỗi trong nhiều câu / nhiều bài — đáng ôn nhất.</p>
              {repeated.length ? (
                <>
                  <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {repeated.map((g) => (
                      <li key={g.key} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="text-rose-700 line-through decoration-rose-300 dark:text-rose-300">{g.wrong}</span> →{' '}
                          <strong className="text-slate-900 dark:text-white">{g.right}</strong>
                          <span className="ml-1.5 text-xs text-slate-400">
                            ×{g.count} · {MISTAKE_LABEL[g.category]}
                          </span>
                        </span>
                        <CardButton itemKey={g.key} right={g.right} />
                      </li>
                    ))}
                  </ul>
                  {repeated.some((g) => !(g.cardId && review.cards[g.cardId])) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      loading={busy === 'repeated'}
                      onClick={() =>
                        void makeCards(
                          repeated.filter((g) => !(g.cardId && review.cards[g.cardId])).map((g) => g.key),
                          'repeated',
                        )
                      }
                    >
                      <BookmarkPlus className="size-4" /> Ôn tất cả lỗi lặp lại
                    </Button>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 text-sm text-slate-400">Chưa có lỗi nào lặp lại.</p>
              )}
            </Card>
          </div>
          {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCategory(null)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-semibold',
                !category
                  ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-300'
                  : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300',
              )}
            >
              Tất cả <span className="opacity-70 tabular-nums">{book.items.filter((i) => withImprove || i.severity === 'error').length}</span>
            </button>
            {book.categories.map((c) => {
              const n = withImprove ? c.count : c.errors
              if (!n) return null
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(category === c.id ? null : c.id)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-semibold',
                    category === c.id
                      ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-300'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/50',
                  )}
                >
                  {MISTAKE_LABEL[c.id]} <span className="opacity-70 tabular-nums">{n}</span>
                </button>
              )
            })}
            <label className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <input type="checkbox" checked={withImprove} onChange={(e) => setWithImprove(e.target.checked)} />
              Cả chỗ AI nâng cấp cách diễn đạt
            </label>
          </div>

          <ul className="grid gap-3 md:grid-cols-2">
            {items.map((item, i) => {
              const count = groupByKey.get(item.key)?.count ?? 1
              return (
                <li
                  key={`${item.workId}-${i}`}
                  className="space-y-1.5 rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={item.category === 'flagged' ? 'amber' : 'rose'}>{MISTAKE_LABEL[item.category]}</Badge>
                    {item.severity === 'improve' ? <Badge tone="slate">nâng cấp</Badge> : null}
                    {count > 1 ? <Badge tone="violet">lặp lại ×{count}</Badge> : null}
                    <span className="ml-auto">
                      <CardButton itemKey={item.key} right={item.right} />
                    </span>
                  </div>
                  <p className="leading-relaxed text-slate-700 dark:text-slate-200">
                    <Sentence item={item} />
                  </p>
                  {item.right ? (
                    <p>
                      <span className="text-rose-700 line-through decoration-rose-300 dark:text-rose-300">{item.wrong}</span> →{' '}
                      <strong className="text-emerald-700 dark:text-emerald-300">{item.right}</strong>
                    </p>
                  ) : null}
                  {item.why ? <p className="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{item.why}</p> : null}
                  {item.dictionary.length ? <p className="text-xs text-slate-400">{item.dictionary.join(' · ')}</p> : null}
                  <Link to={item.href} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-brand-600">
                    {WORK_LABEL[item.kind]} · {dayOf(item.at)} · {item.title} <ExternalLink className="size-3" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </>
  )
}
