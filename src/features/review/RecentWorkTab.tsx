// "Bài gần đây" (Review page tab): the review, limited to the phrases of your Speaking / Writing of the last days — the
// result pages' three lists ("Cụm từ trong thư viện", "Cụm ngoài thư viện", "Cụm AI tự viết, đã tra từ điển"). The
// cards are your usual cards: what you learn here counts everywhere.
import { CalendarClock, Check, ExternalLink, Loader2, NotebookPen, PenLine, Play, Plus, RefreshCw, Repeat, Sparkles, Trophy, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge, buttonClass, Card, EmptyState } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useLocalStorage } from '@/lib/storage'
import type { ReviewIndex } from '@/types/content'
import { PHRASE_GROUP_LABEL, PHRASE_GROUP_LABEL_EN, WORK_LABEL, type PhraseGroup, type RecentResponse } from '@/types/practice'
import type { RealUse, StoredCard } from '@/types/review'
import { practiceApi, waitForCards } from '../practice/practice-api'
import { InfoTip } from './InfoTip'
import { NotInLibrary } from './NotInLibrary'
import { stageOf, STAGE_LABEL_EN } from './ladder'
import { buildQueue } from './queue'
import { ActionTileBody, actionTileClass, InfoStat, HeroBackdrop, PillChoice, PrimaryActionBody, primaryActionClass, StudyCardsArt } from './HeroParts'
import { DEFAULT_RECENT_DAYS, RECENT_DAYS, RECENT_DAYS_KEY, RECENT_NEW, RECENT_NEW_KEY } from './recent-scope'
import { StartSessionButton } from './StartSessionButton'
import { loadReviews, useReviewStore } from './store'
import { DEFAULT_USAGE_COUNT, USAGE_COUNT_KEY, USAGE_COUNTS, usageCandidates } from './usagePlan'

const GROUP_STYLE: Record<PhraseGroup, string> = {
  library: 'border-brand-200 bg-brand-50/60 text-brand-800 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200',
  extra: 'border-violet-200 bg-violet-50/60 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200',
  wording: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200',
}
const GROUP_DOT: Record<PhraseGroup, string> = {
  library: 'bg-brand-500',
  extra: 'bg-violet-500',
  wording: 'bg-slate-400',
}

/** Where a phrase's card stands. */
function statusOf(id: string, known: ReadonlySet<string>, card: StoredCard | undefined): { label: string; done?: boolean } {
  if (!known.has(id)) return { label: 'no card yet' }
  if (!card) return { label: 'not in reviews' }
  if (card.done) return { label: 'known', done: true }
  if (card.fsrs.state === 0) return { label: 'new' }
  if (card.fsrs.state !== 2) return { label: 'learning' }
  return { label: STAGE_LABEL_EN[stageOf(card)], done: true }
}

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
  })

/** Recent work's phrases (GET /api/practice/recent); `reload` after writing cards. */
function useRecentWork(days: number) {
  const [data, setData] = useState<RecentResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    setError(null)
    try {
      const next = await practiceApi.recent(days)
      setData(next)
      return next
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }, [days])
  useEffect(() => {
    setData(null)
    void reload()
  }, [reload])
  return { data: data?.days === days ? data : null, error, reload }
}

export function RecentWorkTab({ index }: { index: ReviewIndex }) {
  const review = useReviewStore()
  const [days, setDays] = useLocalStorage<number>(RECENT_DAYS_KEY, DEFAULT_RECENT_DAYS)
  const [newMax] = useLocalStorage<number>(RECENT_NEW_KEY, 20)
  const { data, error, reload } = useRecentWork(days)
  // The period ends now: fixed when the page opens (enough for a list of days).
  const [now] = useState(() => Date.now())
  const [message, setMessage] = useState<{
    tone: 'ok' | 'error'
    text: string
  } | null>(null)

  const byId = useMemo(() => new Map(index.cards.map((c) => [c.id, c])), [index])
  const known = useMemo(() => new Set(byId.keys()), [byId])
  const ids = useMemo(() => new Set(data?.ids ?? []), [data])

  const counts = useMemo(() => {
    if (!data || !review.settings) return null
    const q = buildQueue(review.cards, review.settings, review.today, known, {
      only: ids,
      newLimit: newMax,
    })
    const stored = data.ids.map((id) => review.cards[id]).filter(Boolean)
    return {
      due: q.counts.due + q.counts.learning,
      fresh: q.counts.newAvailable,
      learned: stored.filter((c) => c.fsrs.state === 2 || c.done).length,
      session: q.order.length,
      toWrite: data.ids.filter((id) => !known.has(id)).length,
      toAdd: data.ids.filter((id) => known.has(id) && !review.cards[id]).length,
      usage: usageCandidates(review.cards, byId, review.settings).filter((p) => ids.has(p.id)).length,
    }
  }, [data, review, known, ids, byId, newMax])

  const groupCounts = useMemo(() => {
    const seen = new Map<string, PhraseGroup>()
    for (const w of data?.works ?? []) for (const p of w.phrases) if (!seen.has(p.id)) seen.set(p.id, p.group)
    const out: Record<PhraseGroup, number> = {
      library: 0,
      extra: 0,
      wording: 0,
    }
    for (const g of seen.values()) out[g]++
    return out
  }, [data])

  // Your own uses of cards in the period (Writing essays, edited answers).
  const uses = useMemo(() => {
    const cutoff = now - days * 86_400_000
    const list: RealUse[] = []
    for (const card of Object.values(review.cards)) for (const u of card.uses ?? []) if (Date.parse(u.at) >= cutoff) list.push(u)
    return list.sort((a, b) => b.at.localeCompare(a.at))
  }, [review.cards, days, now])

  const createCards = async (phraseIds: string[]) => {
    setMessage(null)
    try {
      const r = await practiceApi.createRecentCards(days, phraseIds)
      const next = await reload()
      if (next) await waitForCards(next.ids)
      await loadReviews(true)
      setMessage({
        tone: 'ok',
        text: `Created ${r.created} new cards and added ${r.added} selected cards to your reviews${r.merged ? `; merged ${r.merged} duplicates into Vocabulary/Notes` : ''}.`,
      })
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message })
    }
  }

  if (review.status === 'offline')
    return <EmptyState title="Reviews need the local server" description="Start the app with npm run dev (or npm start) and reload." />

  const missing = (counts?.toWrite ?? 0) + (counts?.toAdd ?? 0)
  return (
    <div className="space-y-6">
      <Card className="relative overflow-hidden p-4 sm:p-7">
        <HeroBackdrop from="bg-amber-200/50" to="bg-sky-200/40" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-[0.14em] text-amber-600 uppercase dark:text-amber-400">Recent Speaking & Writing</p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-balance text-slate-900 sm:text-3xl dark:text-white">
              {data ? `${data.ids.length} phrases from ${data.works.length} pieces of work` : 'Gathering phrases from your work…'}
            </h2>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-400 dark:text-slate-500">Includes:</span>
              {(Object.keys(groupCounts) as PhraseGroup[]).map((g) => (
                <span key={g} className="inline-flex items-center gap-1.5">
                  <span className={cn('size-2 rounded-full', GROUP_DOT[g])} />
                  {PHRASE_GROUP_LABEL_EN[g]} <strong className="text-slate-700 tabular-nums dark:text-slate-200">{groupCounts[g]}</strong>
                </span>
              ))}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                Work from the last
                <InfoTip>
                  Chỉ ôn các cụm của những bài Speaking / Writing bạn làm trong khoảng này: Cụm trong thư viện, Cụm ngoài thư viện và Cụm AI tự viết đã
                  tra từ điển (cụm màu cam “chưa xác nhận” được bỏ qua). Thẻ là thẻ ôn thường của bạn: học ở đây thì tiến độ ở trang Review cũng đổi theo.
                </InfoTip>
              </span>
              {RECENT_DAYS.map((d) => (
                <PillChoice key={d} on={days === d} onClick={() => setDays(d)}>
                  {d} days
                </PillChoice>
              ))}
              <button
                type="button"
                onClick={() => void reload()}
                title="Tải lại"
                className="relative ml-1 hit-area rounded-full p-1.5 text-slate-400 hover:bg-white hover:text-slate-600 dark:hover:bg-slate-800"
              >
                <RefreshCw className="size-3.5" />
              </button>
            </div>
          </div>
          <StudyCardsArt className="hidden w-36 shrink-0 sm:block lg:w-44" accent="#f59e0b" />
        </div>

        <div className="relative mt-6 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
            <InfoStat tint="sky" icon={<CalendarClock className="size-5" />} value={counts ? counts.due : '—'} label="due" />
            <InfoStat
              tint="amber"
              icon={<Sparkles className="size-5" />}
              value={counts ? counts.fresh : '—'}
              label="new"
              chip={`up to ${newMax} a session`}
              tip={<InfoTip>Thẻ chưa học lần nào. Mỗi phiên giới thiệu tối đa số thẻ mới bạn chọn khi bấm Ôn (không tính vào hạn mức thẻ mới mỗi ngày).</InfoTip>}
            />
            <InfoStat
              tint="emerald"
              icon={<Trophy className="size-5" />}
              value={counts ? counts.learned : '—'}
              label="known"
              chip={data && counts ? `${Math.round((counts.learned / Math.max(1, data.ids.length)) * 100)}%` : undefined}
            />
          </div>

          <div className="flex flex-col gap-3">
            {counts?.session ? (
              <StartSessionButton
                to={`/review/session?recent=${days}`}
                className={primaryActionClass}
                counts={{ label: 'New cards per session (max)', values: RECENT_NEW, initial: 20, storageKey: RECENT_NEW_KEY, param: 'newMax' }}
              >
                <PrimaryActionBody
                  icon={<Play className="size-5 fill-current" />}
                  title="Review recent work"
                  hint={`${counts.due} due · up to ${Math.min(newMax, counts.fresh)} new`}
                />
              </StartSessionButton>
            ) : data && !missing ? (
              <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 px-4 py-3.5 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900">
                <Trophy className="size-5 shrink-0" />
                <span className="text-sm font-semibold">All due cards of your recent work are done 🎉</span>
              </div>
            ) : null}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2.5">
              <StartSessionButton
                to={`/review/session?practice=1&recent=${days}`}
                heading="Practise again for how long?"
                variant="outline"
                className={actionTileClass('violet')}
                title="Ôn lại các thẻ đã học của bài gần đây; lịch ôn không đổi"
              >
                <ActionTileBody tint="violet" icon={<Repeat className="size-4" />} title="Practice again" hint="studied cards, schedule unchanged" />
              </StartSessionButton>
              {counts?.usage ? (
                <StartSessionButton
                  to={`/review/usage?recent=${days}`}
                  heading="Usage practice"
                  variant="outline"
                  className={actionTileClass('amber')}
                  title="Luyện dùng các từ đã học của bài gần đây (điền cụm, viết lại câu, tự đặt câu); lịch ôn không đổi"
                  counts={{ label: 'Cards', values: USAGE_COUNTS, initial: DEFAULT_USAGE_COUNT, storageKey: USAGE_COUNT_KEY, param: 'count' }}
                >
                  <ActionTileBody tint="amber" icon={<PenLine className="size-4" />} title={`Usage practice · ${counts.usage}`} hint="collocation, rewrite, own sentence" />
                </StartSessionButton>
              ) : null}
              <Link to="/practice/mistakes" className={cn(buttonClass('outline', 'md'), actionTileClass('rose'))}>
                <ActionTileBody tint="rose" icon={<NotebookPen className="size-4" />} title="Mistake log" hint="the mistakes you keep making" />
              </Link>
            </div>
          </div>
        </div>

        {missing ? (
          <div className="relative mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-amber-300 bg-amber-50/70 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
            <span className="flex size-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <Plus className="size-4" />
            </span>
            <p className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-100">
              <strong>{missing} phrases</strong> have no review card yet. Create them to include them in “Review recent work”.
            </p>
            <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">Chọn cụm bên dưới rồi bấm “Add to review”.</span>
          </div>
        ) : null}
        {message ? (
          <p className={cn('relative mt-4 text-sm', message.tone === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600')}>
            {message.text}
          </p>
        ) : null}
        {error ? <p className="relative mt-4 text-sm text-rose-600">{error}</p> : null}
      </Card>

      {data ? <NotInLibrary data={data} onAdded={reload} onCreateCards={(ids) => createCards(ids)} /> : null}

      {uses.length ? (
        <Card className="p-4 sm:p-6">
          <h3 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            Cards you used in your own work
            <InfoTip>
              Cụm của thẻ bạn đã học, tìm thấy trong chính bài viết của bạn (bài Writing, hoặc câu trả lời / bài mẫu bạn sửa). Dùng đúng: thẻ lên bậc
              “Tự dùng”. Dùng sai (bài chấm đã sửa): thẻ về bậc “Dùng đúng cụm” và đến hạn ôn ngay.
            </InfoTip>
          </h3>
          <ul className="mt-3 grid gap-2.5 md:grid-cols-2">
            {uses.slice(0, 12).map((u) => (
              <li
                key={`${u.ref}-${u.term}`}
                className="flex items-start gap-2 rounded-xl border border-slate-100 px-3 py-2.5 text-[13px] dark:border-slate-800"
              >
                {u.ok ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <X className="mt-0.5 size-4 shrink-0 text-rose-500" />}
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {u.term}
                    {u.to ? (
                      <span className="ml-2 text-xs font-medium text-slate-500">
                        {STAGE_LABEL_EN[u.from ?? 'recognize']} → {STAGE_LABEL_EN[u.to]}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {u.ok ? (
                      u.sentence.replace(/\*\*/g, '')
                    ) : (
                      <>
                        <span className="line-through decoration-rose-400">{u.wrote}</span>
                        {u.fixed ? <> → {u.fixed}</> : null}
                        {u.why ? <span className="text-slate-500"> — {u.why}</span> : null}
                      </>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {!data ? (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" /> Gathering phrases from your recent work…
        </p>
      ) : !data.works.length ? (
        <EmptyState
          title={`No work in the last ${days} days`}
          description="Do a Speaking Ideas or Writing Review, or choose a longer period."
        />
      ) : (
        <div className="space-y-3">
          {data.works.map((w) => (
            <Card key={`${w.kind}-${w.id}`} className="p-4 sm:p-5">
              <div className="mb-2.5 flex flex-wrap items-center gap-2">
                <Badge tone={w.kind === 'speaking' ? 'violet' : w.kind === 'talk' ? 'teal' : 'sky'}>{WORK_LABEL[w.kind]}</Badge>
                <Link
                  to={w.href}
                  className="min-w-0 flex-1 truncate font-semibold text-slate-900 hover:text-brand-700 dark:text-white dark:hover:text-brand-300"
                >
                  {w.title}
                </Link>
                <span className="text-xs text-slate-400">
                  {dayOf(w.at)} · {w.phrases.length} phrases
                </span>
                <Link to={w.href} className="relative text-slate-400 hit-area hover:text-brand-600" title="Mở bài">
                  <ExternalLink className="size-3.5" />
                </Link>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {w.phrases.map((p) => {
                  const status = statusOf(p.id, known, review.cards[p.id])
                  return (
                    <li
                      key={p.id}
                      title={`${PHRASE_GROUP_LABEL[p.group]}${p.meaning_vi ? ` — ${p.meaning_vi}` : ''}`}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[13px]',
                        GROUP_STYLE[p.group],
                        !known.has(p.id) && 'border-dashed opacity-70',
                      )}
                    >
                      <span className="font-medium">{p.term}</span>
                      <span className={cn('text-[11px]', status.done ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'opacity-60')}>
                        {status.label}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
