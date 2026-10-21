import { Eye, History, Lightbulb, Plus, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Button, Card, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useLocalStorage } from '@/lib/storage'
import { itemCardId, type EssayDoc, type EssayFeedback, type EssayItem } from '@/types/essays'
import { splitSentences } from '../practice/lib/sentences'
import { essaysApi, type ReviewCards } from './api'
import { FeedbackView, TargetChips } from './Feedback'
import { KIND_META } from './lib'

const textareaClass =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[15px] leading-relaxed focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-900'

/** One item per phrase (the first use), for choosing targets. */
function uniqueItems(essay: EssayDoc, kinds: EssayItem['kind'][]) {
  return essay.items.filter((i) => kinds.includes(i.kind) && itemCardId(essay, i).endsWith(`:${i.id}`))
}

function useCheck() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState<{ result: EssayFeedback; text: string; targets: EssayItem[] } | null>(null)
  const run = async (targets: EssayItem[], text: string, request: () => Promise<EssayFeedback>) => {
    setPending(true)
    setError('')
    try {
      const result = await request()
      setFeedback({ result, text, targets })
      return result
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending(false)
    }
  }
  return { pending, error, feedback, run, clear: () => setFeedback(null) }
}

/** Missed targets → Review, one click. */
function AddMissed({ essay, review, feedback, targets }: { essay: EssayDoc; review: ReviewCards; feedback: EssayFeedback; targets: EssayItem[] }) {
  const [added, setAdded] = useState<number | null>(null)
  const ids = [...new Set(feedback.targets.filter((t) => t.status !== 'correct').map((t) => targets.find((i) => i.id === t.itemId)).filter(Boolean).map((i) => itemCardId(essay, i!)))]
  if (!ids.length || review.offline) return null
  return (
    <Button variant="outline" size="sm" disabled={added !== null} onClick={async () => setAdded(await review.add(ids))}>
      <Plus className="size-4" /> {added === null ? `Đưa ${ids.length} cụm chưa dùng được vào Review` : `Đã thêm ${added} thẻ mới`}
    </Button>
  )
}

export function RebuildTab({ essay, review }: { essay: EssayDoc; review: ReviewCards }) {
  const bodies = essay.paragraphs.map((p, i) => ({ p, i })).filter(({ p }) => p.outline.length)
  const [index, setIndex] = useState(String(bodies[Math.min(1, bodies.length - 1)]?.i ?? 0))
  const paragraph = essay.paragraphs[Number(index)]
  const [drafts, setDrafts] = useLocalStorage<Record<string, string>>('essays:rebuild-drafts', {})
  const [showOriginal, setShowOriginal] = useState(false)
  const check = useCheck()
  const draftKey = `${essay.id}:${index}`
  const text = drafts[draftKey] ?? ''
  const targets = useMemo(
    () =>
      uniqueItems(essay, ['collocation', 'vocabulary', 'frame', 'paraphrase'])
        .filter((i) => paragraph?.sentences.includes(i.sentence))
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 6),
    [essay, paragraph],
  )
  if (!paragraph) return null
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <SegmentedControl
        value={index}
        onChange={(v) => {
          setIndex(v)
          check.clear()
          setShowOriginal(false)
        }}
        options={bodies.map(({ p, i }) => ({ value: String(i), label: p.role.split('—')[0].trim() }))}
        className="flex-wrap"
      />
      <Card className="space-y-4 p-4 sm:p-6">
        <div>
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{paragraph.role} — dàn ý</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[15px] text-slate-800 dark:text-slate-100">
            {paragraph.outline.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">Cố dùng các cụm này</p>
          <TargetChips targets={targets} text={text} />
        </div>
        <textarea
          rows={7}
          value={text}
          onChange={(e) => setDrafts({ ...drafts, [draftKey]: e.target.value })}
          placeholder="Viết lại đoạn văn từ dàn ý, bằng lời của bạn…"
          className={textareaClass}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            loading={check.pending}
            disabled={text.trim().split(/\s+/).length < 12}
            onClick={() =>
              void check.run(targets, text, () => essaysApi.rebuild({ essayId: essay.id, paragraph: Number(index), targets: targets.map((t) => t.id), text }))
            }
          >
            <Sparkles className="size-4" /> AI nhận xét
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowOriginal(!showOriginal)}>
            <Eye className="size-4" /> {showOriginal ? 'Ẩn đoạn gốc' : 'Xem đoạn gốc'}
          </Button>
          <span className="text-xs text-slate-400">{text.trim() ? text.trim().split(/\s+/).length : 0} từ</span>
        </div>
        {check.error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{check.error}</p> : null}
        {showOriginal ? (
          <p className="rounded-xl bg-slate-50 p-3 text-[15px] leading-relaxed text-slate-700 dark:bg-slate-800/50 dark:text-slate-200">
            {paragraph.sentences.map((s) => essay.sentences[s].text).join(' ')}
          </p>
        ) : null}
      </Card>
      {check.feedback ? (
        <>
          <FeedbackView feedback={check.feedback.result} targets={check.feedback.targets} text={check.feedback.text} />
          <AddMissed essay={essay} review={review} feedback={check.feedback.result} targets={check.feedback.targets} />
        </>
      ) : null}
    </div>
  )
}

interface Attempt {
  at: string
  task: string
  score: number
  text: string
}

export function TransferTab({ essay, review }: { essay: EssayDoc; review: ReviewCards }) {
  const candidates = useMemo(() => uniqueItems(essay, ['collocation', 'frame', 'vocabulary', 'paraphrase']), [essay])
  const defaults = useMemo(() => {
    const rank = (i: EssayItem) => (review.status(itemCardId(essay, i)) === 'known' ? 0 : 10) + i.importance * 2 + (i.kind === 'frame' || i.kind === 'collocation' ? 1 : 0)
    // Varied targets: at most 2 of a kind, from different paragraphs/sentences where possible.
    const picked: EssayItem[] = []
    const paragraphOf = (i: EssayItem) => essay.paragraphs.findIndex((p) => p.sentences.includes(i.sentence))
    for (const pass of [0, 1]) {
      for (const item of [...candidates].sort((a, b) => rank(b) - rank(a))) {
        if (picked.length >= 5 || picked.includes(item)) continue
        if (picked.filter((p) => p.kind === item.kind).length >= 2) continue
        if (pass === 0 && picked.some((p) => p.sentence === item.sentence || paragraphOf(p) === paragraphOf(item))) continue
        picked.push(item)
      }
    }
    return picked.map((i) => i.id)
  }, [candidates, essay, review])
  const [taskIndex, setTaskIndex] = useState('0')
  const [custom, setCustom] = useState('')
  const [chosen, setChosen] = useState<string[] | null>(null)
  const [texts, setTexts] = useLocalStorage<Record<string, string>>('essays:transfer-drafts', {})
  const [attempts, setAttempts] = useLocalStorage<Record<string, Attempt[]>>('essays:transfer-attempts', {})
  const [picking, setPicking] = useState(false)
  const check = useCheck()

  const ids = chosen ?? defaults
  const targets = ids.map((id) => candidates.find((c) => c.id === id)).filter((i): i is EssayItem => Boolean(i))
  const task = taskIndex === 'custom' ? custom.trim() : (essay.tasks[Number(taskIndex)]?.prompt ?? '')
  const draftKey = `${essay.id}:${taskIndex}`
  const text = texts[draftKey] ?? ''
  const sentences = text.trim() ? splitSentences(text).length : 0
  const history = attempts[essay.id] ?? []

  const toggle = (id: string) => setChosen(ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 6 ? ids : [...ids, id])

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Card className="space-y-3 p-4 sm:p-6">
        <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Đề mới cùng chủ đề</p>
        <div className="space-y-2">
          {essay.tasks.map((t, i) => (
            <label
              key={i}
              className={cn(
                'flex cursor-pointer gap-3 rounded-xl border p-3 text-[15px] transition-colors',
                taskIndex === String(i) ? 'border-brand-400 bg-brand-50/60 dark:border-brand-700 dark:bg-brand-950/30' : 'border-slate-200 dark:border-slate-700',
              )}
            >
              <input type="radio" className="mt-1" checked={taskIndex === String(i)} onChange={() => setTaskIndex(String(i))} />
              <span>
                <span className="text-slate-800 dark:text-slate-100">{t.prompt}</span>
                {t.hint_vi ? <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400"><Lightbulb className="mr-1 inline size-3.5 align-[-2px] text-amber-500" />{t.hint_vi}</span> : null}
              </span>
            </label>
          ))}
          <label className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-3', taskIndex === 'custom' ? 'border-brand-400' : 'border-slate-200 dark:border-slate-700')}>
            <input type="radio" checked={taskIndex === 'custom'} onChange={() => setTaskIndex('custom')} />
            <input
              value={custom}
              onChange={(e) => (setCustom(e.target.value), setTaskIndex('custom'))}
              placeholder="Hoặc dán đề của bạn…"
              className="w-full bg-transparent text-[15px] outline-none"
            />
          </label>
        </div>
      </Card>

      <Card className="space-y-4 p-4 sm:p-6">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Cụm mục tiêu ({targets.length})</p>
            <button type="button" onClick={() => setPicking(!picking)} className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
              {picking ? 'Xong' : 'Đổi cụm'}
            </button>
          </div>
          <TargetChips targets={targets} text={text} onRemove={picking ? toggle : undefined} />
          {picking ? (
            <div className="mt-3 flex flex-wrap gap-1.5 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              {candidates
                .filter((c) => !ids.includes(c.id))
                .map((c) => (
                  <button key={c.id} type="button" onClick={() => toggle(c.id)} title={c.meaning_vi} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-brand-600 dark:bg-slate-900 dark:text-slate-300">
                    <span className={cn('size-2 rounded-full', KIND_META[c.kind].swatch)} />+ {c.frame ?? c.key}
                  </button>
                ))}
            </div>
          ) : null}
        </div>
        <textarea
          rows={6}
          value={text}
          onChange={(e) => setTexts({ ...texts, [draftKey]: e.target.value })}
          placeholder="Viết một đoạn ngắn 3–4 câu trả lời đề trên, dùng tự nhiên các cụm mục tiêu…"
          className={textareaClass}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            loading={check.pending}
            disabled={!task || !targets.length || text.trim().split(/\s+/).length < 12}
            onClick={async () => {
              const result = await check.run(targets, text, () => essaysApi.transfer({ essayId: essay.id, task, targets: targets.map((t) => t.id), text }))
              if (result) setAttempts({ ...attempts, [essay.id]: [{ at: new Date().toISOString(), task, score: result.score, text }, ...history].slice(0, 10) })
            }}
          >
            <Sparkles className="size-4" /> AI chấm
          </Button>
          <span className={cn('text-xs tabular-nums', sentences > 5 ? 'text-amber-600' : 'text-slate-400')}>
            {sentences} câu {sentences > 5 ? '· nên giữ 3–4 câu' : ''}
          </span>
        </div>
        {check.error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{check.error}</p> : null}
      </Card>

      {check.feedback ? (
        <>
          <FeedbackView feedback={check.feedback.result} targets={check.feedback.targets} text={check.feedback.text} />
          <AddMissed essay={essay} review={review} feedback={check.feedback.result} targets={check.feedback.targets} />
        </>
      ) : null}

      {history.length ? (
        <Card className="p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
            <History className="size-4" /> Các lần viết trước
          </p>
          <ul className="space-y-2 text-sm">
            {history.map((a, i) => (
              <li key={i} className="flex gap-3">
                <Badge tone={a.score >= 8 ? 'emerald' : a.score >= 5 ? 'brand' : 'amber'}>{a.score}/10</Badge>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-slate-700 dark:text-slate-200">{a.text}</span>
                  <span className="text-[11px] text-slate-400">{new Date(a.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}
