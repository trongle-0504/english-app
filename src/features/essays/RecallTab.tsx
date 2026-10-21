import { ArrowLeft, ArrowRight, Check, Eye, Plus, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Button, Card, Progress, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useLocalStorage } from '@/lib/storage'
import { itemCardId, type EssayDoc, type EssayItem, type EssayItemKind } from '@/types/essays'
import { DiffText, DiffLegend } from '../practice/components/DiffText'
import { compareSentence } from '../practice/lib/compare'
import type { ReviewCards } from './api'
import { KIND_META, mentions, sameAnswer } from './lib'

type Mode = 'word' | 'phrase' | 'translate'

interface Blank {
  item: EssayItem
  /** Range inside the sentence that is hidden. */
  start: number
  end: number
  answer: string
}

/** "1 word" hides the partner word, not the headword ("reduce ___", "strong community ___" → the missing word). */
function blankFor(item: EssayItem, mode: Mode): Blank {
  if (mode === 'phrase') return { item, start: item.start, end: item.end, answer: item.text }
  const words = [...item.text.matchAll(/[\p{L}\p{N}'’-]+/gu)]
  const head = item.headword?.toLowerCase() ?? ''
  const stem = head.slice(0, Math.max(3, head.length - 2))
  const pick = words.length > 1 ? (words.find((w) => !(stem && w[0].toLowerCase().startsWith(stem)) && w[0].length > 2) ?? words[0]) : words[0]
  if (!pick) return { item, start: item.start, end: item.end, answer: item.text }
  const start = item.start + (pick.index ?? 0)
  return { item, start, end: start + pick[0].length, answer: pick[0] }
}

/** Non-overlapping items to blank, in reading order. */
function chooseBlanks(essay: EssayDoc, kinds: EssayItemKind[], mode: Mode): Blank[] {
  const picked: Blank[] = []
  for (const item of essay.items) {
    if (!kinds.includes(item.kind)) continue
    const blank = blankFor(item, mode)
    if (picked.some((b) => b.item.sentence === item.sentence && b.start < blank.end && blank.start < b.end)) continue
    picked.push(blank)
  }
  return picked
}

const hint = (answer: string) => answer.replace(/[\p{L}\p{N}]+/gu, (w) => w[0] + '·'.repeat(Math.max(0, w.length - 1)))

function Cloze({ essay, review, mode, kinds }: { essay: EssayDoc; review: ReviewCards; mode: Mode; kinds: EssayItemKind[] }) {
  const blanks = useMemo(() => chooseBlanks(essay, kinds, mode), [essay, kinds, mode])
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [checked, setChecked] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [best, setBest] = useLocalStorage<Record<string, number>>('essays:recall-best', {})
  const key = `${essay.id}:${mode}:${kinds.join(',')}`
  const correct = blanks.filter((b, i) => sameAnswer(answers[i] ?? '', b.answer)).length
  const wrongCards = [...new Set(blanks.filter((b, i) => !sameAnswer(answers[i] ?? '', b.answer)).map((b) => itemCardId(essay, b.item)))]
  const [added, setAdded] = useState<number | null>(null)

  const check = () => {
    setChecked(true)
    const score = blanks.length ? Math.round((correct / blanks.length) * 100) : 0
    if (score > (best[key] ?? -1)) setBest({ ...best, [key]: score })
  }
  const reset = () => {
    setAnswers({})
    setChecked(false)
    setReveal(false)
    setAdded(null)
  }

  if (!blanks.length) return <p className="text-sm text-slate-500">Chọn ít nhất một loại cụm để luyện.</p>

  return (
    <div className="space-y-4">
      <Card className="space-y-5 p-4 sm:p-7">
        {essay.paragraphs.map((paragraph, p) => (
          <p key={p} className="text-[16.5px] leading-[2.3] text-slate-800 dark:text-slate-100">
            {paragraph.sentences.map((s) => {
              const text = essay.sentences[s].text
              const here = blanks.map((b, i) => ({ b, i })).filter(({ b }) => b.item.sentence === s).sort((x, y) => x.b.start - y.b.start)
              const out: React.ReactNode[] = []
              let cursor = 0
              for (const { b, i } of here) {
                out.push(text.slice(cursor, b.start))
                const value = answers[i] ?? ''
                const ok = sameAnswer(value, b.answer)
                out.push(
                  <span key={i} className="inline-flex items-baseline gap-1">
                    <input
                      value={reveal && !ok ? b.answer : value}
                      onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && check()}
                      readOnly={reveal}
                      placeholder={mode === 'phrase' ? hint(b.answer) : `${b.answer[0]}…`}
                      title={`${KIND_META[b.item.kind].label}: ${b.item.meaning_vi}`}
                      style={{ width: `${Math.max(4, b.answer.length + 2)}ch` }}
                      className={cn(
                        'rounded-md border-b-2 bg-slate-50 px-1 text-center text-[15px] leading-7 outline-none focus:bg-brand-50 dark:bg-slate-800 dark:focus:bg-brand-950/50',
                        !checked ? 'border-slate-300 dark:border-slate-600' : ok ? 'border-emerald-500 text-emerald-700 dark:text-emerald-400' : 'border-rose-500 text-rose-600 dark:text-rose-400',
                      )}
                    />
                  </span>,
                )
                cursor = b.end
              }
              out.push(text.slice(cursor), ' ')
              return <span key={s}>{out}</span>
            })}
          </p>
        ))}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        {!checked ? (
          <Button onClick={check}>
            <Check className="size-4" /> Kiểm tra
          </Button>
        ) : (
          <>
            <Badge tone={correct === blanks.length ? 'emerald' : 'amber'}>
              {correct} / {blanks.length} đúng
            </Badge>
            <Button variant="outline" size="sm" onClick={() => setReveal(!reveal)}>
              <Eye className="size-4" /> {reveal ? 'Ẩn đáp án' : 'Xem đáp án'}
            </Button>
            {wrongCards.length && !review.offline ? (
              <Button
                variant="outline"
                size="sm"
                disabled={added !== null}
                onClick={async () => setAdded(await review.add(wrongCards))}
              >
                <Plus className="size-4" /> {added === null ? `Đưa ${wrongCards.length} cụm sai vào Review` : `Đã thêm ${added} thẻ mới`}
              </Button>
            ) : null}
          </>
        )}
        <Button variant="ghost" size="sm" onClick={reset}>
          <RotateCcw className="size-4" /> Làm lại
        </Button>
        {best[key] != null ? <span className="text-xs text-slate-500">Tốt nhất: {best[key]}%</span> : null}
      </div>
    </div>
  )
}

/** Vietnamese → English, one sentence at a time, with the sentence's phrases as hints. Graded by code. */
function TranslateBack({ essay }: { essay: EssayDoc }) {
  const sentences = useMemo(() => essay.sentences.map((s, i) => ({ ...s, index: i })).filter((s) => s.vi), [essay])
  const [n, setN] = useState(0)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [shown, setShown] = useState<Record<number, boolean>>({})
  const current = sentences[n]
  if (!current) return <p className="text-sm text-slate-500">Bài này chưa có bản dịch câu.</p>
  const items = essay.items.filter((i) => i.sentence === current.index && i.kind !== 'linking')
  const draft = drafts[current.index] ?? ''
  const done = shown[current.index]
  const diff = done ? compareSentence(draft, current.text) : null
  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Progress value={((n + 1) / sentences.length) * 100} className="flex-1" />
        <span className="text-xs text-slate-500 tabular-nums">
          {n + 1} / {sentences.length}
        </span>
      </div>
      <p className="text-[17px] leading-relaxed font-medium text-slate-800 dark:text-slate-100">{current.vi}</p>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <Badge key={item.id} tone={done ? (mentions(draft, item) ? 'emerald' : 'rose') : 'slate'} title={item.meaning_vi}>
              {done ? (mentions(draft, item) ? '✓ ' : '✗ ') : ''}
              {item.frame ?? item.key}
            </Badge>
          ))}
        </div>
      ) : null}
      <textarea
        rows={3}
        value={draft}
        onChange={(e) => setDrafts({ ...drafts, [current.index]: e.target.value })}
        placeholder="Viết lại câu tiếng Anh, cố dùng các cụm gợi ý…"
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[15px] leading-relaxed focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
      />
      {diff ? (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
          <DiffText parts={diff.parts} className="text-[15px]" />
          <DiffLegend />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Câu gốc: <span className="text-slate-700 dark:text-slate-200">{current.text}</span>
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" disabled={n === 0} onClick={() => setN(n - 1)}>
          <ArrowLeft className="size-4" /> Trước
        </Button>
        {!done ? (
          <Button size="sm" disabled={!draft.trim()} onClick={() => setShown({ ...shown, [current.index]: true })}>
            <Check className="size-4" /> So với câu gốc
          </Button>
        ) : null}
        <Button variant="outline" size="sm" disabled={n === sentences.length - 1} onClick={() => setN(n + 1)}>
          Câu tiếp <ArrowRight className="size-4" />
        </Button>
      </div>
    </Card>
  )
}

export function RecallTab({ essay, review }: { essay: EssayDoc; review: ReviewCards }) {
  const [mode, setMode] = useLocalStorage<Mode>('essays:recall-mode', 'word')
  const [kinds, setKinds] = useLocalStorage<EssayItemKind[]>('essays:recall-kinds', ['collocation', 'vocabulary'])
  const toggle = (kind: EssayItemKind) => setKinds(kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind])
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: 'word', label: 'Điền 1 từ' },
            { value: 'phrase', label: 'Điền cả cụm' },
            { value: 'translate', label: 'Dịch ngược câu' },
          ]}
        />
        {mode !== 'translate'
          ? (['collocation', 'vocabulary', 'paraphrase', 'linking', 'frame'] as EssayItemKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => toggle(kind)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
                  kinds.includes(kind) ? 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900' : 'border-transparent bg-slate-100 text-slate-400 dark:bg-slate-800/60',
                )}
              >
                <span className={cn('size-2.5 rounded-full', KIND_META[kind].swatch, !kinds.includes(kind) && 'opacity-30')} />
                {KIND_META[kind].plural}
              </button>
            ))
          : null}
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {mode === 'word'
          ? 'Mỗi ô thiếu một từ của cụm (thường là từ đi kèm) — di chuột vào ô để xem nghĩa.'
          : mode === 'phrase'
            ? 'Mỗi ô thiếu cả cụm, chỉ có chữ cái đầu của từng từ.'
            : 'Đọc câu tiếng Việt, viết lại câu tiếng Anh với các cụm gợi ý, rồi so với câu gốc.'}
      </p>
      {mode === 'translate' ? <TranslateBack essay={essay} /> : <Cloze key={`${mode}:${kinds.join(',')}`} essay={essay} review={review} mode={mode} kinds={kinds} />}
    </div>
  )
}
