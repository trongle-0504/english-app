import { BookOpenText, Library, Plus, Sparkles } from 'lucide-react'
import { Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Markdown } from '@/components/Markdown'
import { Badge, Button, ButtonLink, Card, EmptyState, PageHeader, Progress, SearchInput, SegmentedControl, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useData } from '@/lib/data'
import { useCurrentUser } from '@/features/auth/session'
import { useQueryParam } from '@/lib/useQueryParam'
import { ESSAY_ITEM_KINDS, essayCardId, type EssayIndex, type EssayItemKind, type EssaySummary, type PhraseBank } from '@/types/essays'
import { useReviewCards, type ReviewCards } from './api'
import { KIND_META, KIND_TONE } from './lib'

/** Share of an essay's phrases already known, and how many are new. */
function coverage(essay: EssaySummary, review: ReviewCards) {
  const known = essay.cardIds.filter((id) => review.status(id) === 'known').length
  const fresh = essay.cardIds.filter((id) => !review.cards?.[id]).length
  return { known, fresh, total: essay.cardIds.length }
}

/** The next essay to study: the least-known one that is not already mostly known (plenty to learn, not overwhelming). */
function recommend(essays: EssaySummary[], review: ReviewCards): string | undefined {
  if (!review.cards) return undefined
  const scored = essays.map((e) => ({ e, ...coverage(e, review) })).filter((x) => x.total && x.known / x.total < 0.9)
  scored.sort((a, b) => b.known / b.total - a.known / a.total || a.fresh - b.fresh)
  return scored[0]?.e.id
}

function EssayCard({ essay, review, recommended }: { essay: EssaySummary; review: ReviewCards; recommended: boolean }) {
  const c = coverage(essay, review)
  return (
    <Link to={`/practice/essays/${essay.id}`} className="group block">
      <Card className={cn('h-full space-y-3 p-4 sm:p-5 transition-shadow group-hover:shadow-md', recommended && 'ring-2 ring-brand-400')}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="brand">{essay.topic}</Badge>
          {essay.taskType ? <Badge tone="slate">{essay.taskType}</Badge> : null}
          {essay.band ? <Badge tone="violet">{essay.band}</Badge> : null}
          {recommended ? (
            <Badge tone="emerald">
              <Sparkles className="size-3" /> Nên học tiếp
            </Badge>
          ) : null}
        </div>
        <h3 className="text-lg font-bold text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-300">{essay.title}</h3>
        <p className="line-clamp-2 text-sm text-slate-500 italic dark:text-slate-400">{essay.prompt}</p>
        <div className="flex flex-wrap gap-1">
          {ESSAY_ITEM_KINDS.filter((k) => essay.counts[k]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <span className={cn('size-2 rounded-full', KIND_META[k].swatch)} />
              {essay.counts[k]} {KIND_META[k].plural.toLowerCase()}
            </span>
          ))}
        </div>
        {review.cards ? (
          <div>
            <Progress value={c.total ? (c.known / c.total) * 100 : 0} />
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              Đã thuộc {c.known}/{c.total} · {c.fresh} cụm chưa học · {essay.words} từ
            </p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">{essay.words} từ</p>
        )}
      </Card>
    </Link>
  )
}

function Essays({ review }: { review: ReviewCards }) {
  const { essays } = useData<EssayIndex>('essays/index.json')
  const isAdmin = useCurrentUser()?.role === 'admin'
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState('')
  const topics = [...new Set(essays.map((e) => e.topic))].sort()
  const q = query.trim().toLowerCase()
  const visible = essays.filter((e) => (!topic || e.topic === topic) && (!q || `${e.title} ${e.prompt} ${e.topic}`.toLowerCase().includes(q)))
  const next = recommend(essays, review)
  if (!essays.length)
    return (
      <EmptyState
        icon={<Library className="size-6" />}
        title="Chưa có bài mẫu nào"
        description="Thêm bài trong Admin → Essays: dán đề và bài, AI sẽ phân tích thành bài học."
        action={
          isAdmin ? (
            <ButtonLink to="/admin/essays" size="sm">
              <Plus className="size-4" /> Thêm bài
            </ButtonLink>
          ) : undefined
        }
      />
    )
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo đề, chủ đề…" className="w-full sm:w-72" />
        {topics.length > 1 ? (
          <select
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="">Tất cả chủ đề</option>
            {topics.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {visible.map((e) => (
          <EssayCard key={e.id} essay={e} review={review} recommended={e.id === next} />
        ))}
      </div>
    </div>
  )
}

function PhraseBankView({ review }: { review: ReviewCards }) {
  const { phrases } = useData<PhraseBank>('essays/phrases.json')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | EssayItemKind>('collocation')
  const [adding, setAdding] = useState('')
  const q = query.trim().toLowerCase()
  const list = useMemo(
    () =>
      phrases.filter(
        (p) =>
          (kind === 'all' || p.kind === kind) &&
          (!q || `${p.key} ${p.meaning_vi} ${p.function ?? ''} ${p.occurrences.map((o) => o.text).join(' ')}`.toLowerCase().includes(q)),
      ),
    [phrases, kind, q],
  )
  // Linking words and frames read best grouped by what they do (concession, example, result…).
  const grouped = kind === 'linking' || kind === 'frame'
  const groups = grouped ? [...new Set(list.map((p) => p.function || 'other'))].sort() : ['']
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm theo ý: “dẫn đến”, “ví dụ”, poverty…"
          className="w-full sm:w-80"
        />
        <SegmentedControl
          size="sm"
          value={kind}
          onChange={setKind}
          options={[{ value: 'all' as const, label: 'Tất cả' }, ...ESSAY_ITEM_KINDS.map((k) => ({ value: k, label: KIND_META[k].plural }))]}
          className="flex-wrap"
        />
      </div>
      <p className="text-xs text-slate-500">{list.length} cụm · cụm xuất hiện trong nhiều bài được xếp trước — đó là những cụm đáng học nhất.</p>
      {groups.map((g) => (
        <div key={g} className="space-y-2">
          {grouped ? <h3 className="text-xs font-bold tracking-wide text-brand-700 uppercase dark:text-brand-400">{g}</h3> : null}
          {list
            .filter((p) => !grouped || (p.function || 'other') === g)
            .map((p) => {
              const first = p.occurrences[0]
              const cardId = essayCardId(first.essayId, first.itemId)
              const inReview = Boolean(review.cards?.[cardId])
              return (
                <Card key={`${p.kind}:${p.key}`} className="flex items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <strong className="text-slate-900 dark:text-white">{p.key}</strong>
                      <Badge tone={KIND_TONE[p.kind]}>{KIND_META[p.kind].label}</Badge>
                      {p.occurrences.length > 1 ? <Badge tone="brand">{p.occurrences.length} bài</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{p.meaning_vi}</p>
                    <Markdown inline className="mt-1 block text-sm text-slate-500 dark:text-slate-400">
                      {first.sentence}
                    </Markdown>
                    <Link
                      to={`/practice/essays/${first.essayId}?item=${first.itemId}`}
                      className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {first.title}
                    </Link>
                  </div>
                  {review.offline ? null : inReview ? (
                    <Badge tone="sky">In review</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={adding === cardId}
                      onClick={async () => {
                        setAdding(cardId)
                        await review.add([cardId]).finally(() => setAdding(''))
                      }}
                    >
                      <Plus className="size-4" />
                    </Button>
                  )}
                </Card>
              )
            })}
        </div>
      ))}
    </div>
  )
}

export default function EssayLibraryPage() {
  const review = useReviewCards()
  const isAdmin = useCurrentUser()?.role === 'admin'
  const [tab, setTab] = useQueryParam('tab')
  const current = tab === 'phrases' ? 'phrases' : 'essays'
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Writing"
        title="Model essays"
        description="Học từ vựng, collocation và cách viết từ bài mẫu: đọc có highlight → nhớ lại → viết lại đoạn → dùng vào đề mới. Cụm đã học được ôn trong Review."
        actions={
          isAdmin ? (
            <ButtonLink to="/admin/essays" variant="ghost" size="sm">
              <Plus className="size-4" /> Add essay
            </ButtonLink>
          ) : undefined
        }
      />
      <SegmentedControl
        value={current}
        onChange={(v) => setTab(v === 'essays' ? '' : v)}
        options={[
          { value: 'essays', label: 'Bài mẫu', icon: <BookOpenText className="size-4" /> },
          { value: 'phrases', label: 'Kho cụm từ', icon: <Library className="size-4" /> },
        ]}
        className="mb-5"
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        {current === 'essays' ? <Essays review={review} /> : <PhraseBankView review={review} />}
      </Suspense>
    </div>
  )
}
