import { BookMarked, Check, CheckCheck, ExternalLink, Lightbulb, Loader2, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Markdown } from '@/components/Markdown'
import { SpeakButton } from '@/components/SpeakButton'
import { Badge, Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { itemCardId, type Essay, type EssayDoc, type EssayItem } from '@/types/essays'
import { refreshSiteData } from '../admin/api'
import { essayAdminApi, essaysApi, type DictionaryBox, type ReviewCards } from './api'
import { KIND_META, KIND_TONE } from './lib'

const STATUS_LABEL = { new: 'Chưa học', learning: 'Đang ôn', known: 'Đã thuộc' } as const

function Dictionary({ item }: { item: EssayItem }) {
  const [box, setBox] = useState<DictionaryBox | null>(null)
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading')
  useEffect(() => {
    if (!item.headword) return
    let active = true
    essaysApi.dictionary(item.headword, item.key).then(
      (b) => active && (setBox(b), setState('done')),
      () => active && setState('error'),
    )
    return () => {
      active = false
    }
  }, [item.headword, item.key])
  if (!item.headword) return null
  if (state === 'loading')
    return (
      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="size-3.5 animate-spin" /> Đang tra từ điển “{item.headword}”…
      </p>
    )
  if (state === 'error' || !box) return null
  // The dictionary line that IS the item ("reduce poverty" = "reduce poverty", or "reduce" in OZDIC's VERB + POVERTY
  // list) is highlighted — not a longer combination that merely shares a word ("be reduced to poverty").
  const head = item.headword ?? ''
  const isHead = (w: string) => Boolean(head) && w.startsWith(head.slice(0, Math.max(3, head.length - 1)))
  const FILLER = new Set(['a', 'an', 'the', 'sb', 'sth', 'somebody', 'something', 'someone', 'be'])
  const tokens = (text: string) => text.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z'-]+/).filter((w) => w && !FILLER.has(w) && !isHead(w))
  const own = tokens(item.key)
  const matches = (text: string) =>
    own.length > 0 &&
    (box.source === 'ozdic'
      ? text.split(/,\s*/).some((entry) => tokens(entry).join(' ') === own.join(' '))
      : text.split('/').some((variant) => {
          const t = tokens(variant)
          return t.length === own.length && own.every((w, i) => t[i] === w)
        }))
  if (!box.source)
    return (
      <p className="text-xs text-slate-400">
        {box.unavailable ? `Không tra được từ điển lúc này (mạng hoặc giới hạn truy cập) — thử lại sau.` : `Từ điển (Longman/OZDIC) chưa có collocation cho “${item.headword}”.`}
      </p>
    )
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
        <BookMarked className="size-3.5" /> {box.source === 'longman' ? 'Longman' : 'OZDIC'} · {box.word}
        {box.listed ? <Badge tone="emerald">có trong từ điển</Badge> : null}
        <a href={box.url} target="_blank" rel="noreferrer" className="ml-auto text-brand-600 hover:underline dark:text-brand-400" aria-label="Open dictionary">
          <ExternalLink className="size-3.5" />
        </a>
      </p>
      {box.definitions.length ? <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{box.definitions[0]}</p> : null}
      <div className="mt-2 max-h-72 space-y-3 overflow-y-auto pr-1">
        {box.groups.map((group, g) => (
          <div key={g}>
            <p className="mb-1 inline-block rounded-md bg-violet-600 px-2 py-0.5 text-[10.5px] font-bold tracking-wide text-white dark:bg-violet-500">{group.heading}</p>
            <ul className="space-y-1.5">
              {group.items.map((c, n) => (
                <li key={n} className={cn('rounded-md px-1.5 py-0.5 text-xs', matches(c.phrase) && 'bg-amber-100 dark:bg-amber-900/40')}>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{c.phrase}</span>
                  {c.gloss ? <span className="text-slate-500 dark:text-slate-400"> (= {c.gloss})</span> : null}
                  {c.example ? <span className="block pl-3 text-slate-500 dark:text-slate-400">{c.example}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ItemPanel({
  essay,
  item,
  review,
  onClose,
  onEssayChange,
}: {
  essay: EssayDoc
  item: EssayItem
  review: ReviewCards
  onClose: () => void
  onEssayChange: (essay: Essay) => void
}) {
  const [busy, setBusy] = useState<'' | 'known' | 'delete'>('')
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const act = async (what: 'known' | 'delete') => {
    setBusy(what)
    setError('')
    try {
      if (what === 'known') await review.markKnown([itemCardId(essay, item)])
      else {
        const { essay: next } = await essayAdminApi.deleteItem(essay.id, item.id)
        // A removed phrase leaves Review too (other uses of the same phrase keep their card).
        const shared = essay.items.some((i) => i.id !== item.id && itemCardId(essay, i) === itemCardId(essay, item))
        if (!shared && review.cards?.[itemCardId(essay, item)]) await review.remove([itemCardId(essay, item)])
        refreshSiteData('essays/index.json', 'essays/phrases.json', 'review')
        onClose()
        onEssayChange(next)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }
  const sentence = essay.sentences[item.sentence]
  const cardId = itemCardId(essay, item)
  const status = review.status(cardId)
  const [adding, setAdding] = useState(false)
  const bold = sentence ? `${sentence.text.slice(0, item.start)}**${sentence.text.slice(item.start, item.end)}**${sentence.text.slice(item.end)}` : ''
  const related = essay.related[item.id] ?? []
  return (
    <div className="space-y-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={KIND_TONE[item.kind]}>{KIND_META[item.kind].label}</Badge>
            {item.function ? <Badge tone="slate">{item.function}</Badge> : null}
            {item.importance === 3 ? <Badge tone="brand">IELTS ★</Badge> : null}
          </div>
          <h3 className="mt-2 text-lg leading-snug font-bold text-slate-900 dark:text-white">{item.frame ?? item.key}</h3>
          {item.frame || item.key.toLowerCase() !== item.text.toLowerCase() ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Trong bài: <em>{item.text}</em>
            </p>
          ) : null}
        </div>
        <SpeakButton text={item.frame ? item.text : item.key} />
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      {item.source ? (
        <p className="rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">
          Paraphrase của đề: “{item.source}” → “{item.text}”
        </p>
      ) : null}
      <p className="text-[15px] text-slate-800 dark:text-slate-100">{item.meaning_vi}</p>
      {item.note_vi ? <p className="text-sm text-slate-500 dark:text-slate-400"><Lightbulb className="mr-1 inline size-3.5 align-[-2px] text-amber-500" />{item.note_vi}</p> : null}

      {sentence ? (
        <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
          <Markdown inline className="text-slate-800 dark:text-slate-100">
            {bold}
          </Markdown>
          {sentence.vi ? <p className="mt-1 text-slate-500 dark:text-slate-400">{sentence.vi}</p> : null}
        </div>
      ) : null}

      {item.kind === 'collocation' || item.kind === 'vocabulary' ? <Dictionary key={item.id} item={item} /> : null}

      {related.length ? (
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">Trong bài khác ({related.length})</p>
          <ul className="space-y-1.5 text-sm">
            {related.map((r, i) => (
              <li key={i}>
                <Link to={`/practice/essays/${r.essayId}`} className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
                  {r.title}
                </Link>
                <Markdown inline className="block text-slate-600 dark:text-slate-300">
                  {r.sentence}
                </Markdown>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        {review.offline ? (
          <span className="text-xs text-slate-400">Ôn tập cần server của app.</span>
        ) : status === 'new' && !review.cards?.[cardId] ? (
          <Button
            size="sm"
            loading={adding}
            onClick={async () => {
              setAdding(true)
              await review.add([cardId]).finally(() => setAdding(false))
            }}
          >
            <Plus className="size-4" /> Add to review
          </Button>
        ) : (
          <Badge tone={status === 'known' ? 'emerald' : 'sky'}>
            <Check className="size-3" /> {STATUS_LABEL[status]}
          </Badge>
        )}
        {!review.offline && status !== 'known' ? (
          <Button size="sm" variant="ghost" loading={busy === 'known'} disabled={Boolean(busy)} onClick={() => void act('known')} title="Đánh dấu đã thuộc: không ôn nữa, không tô màu trong bài">
            <CheckCheck className="size-4" /> Đã thuộc
          </Button>
        ) : null}
        {confirm ? (
          <span className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="danger" loading={busy === 'delete'} onClick={() => void act('delete')}>
              Xoá
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Huỷ
            </Button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
            title="Xoá cụm này khỏi bài"
            aria-label="Remove from essay"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  )
}
