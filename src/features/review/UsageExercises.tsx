// The two exercises of the upper usage-ladder stages (see ladder.ts):
// - CollocateExercise ("Dùng đúng cụm"): fill in the partner word of a collocation — checked locally.
// - ProduceRound ("Viết lại câu" + "Tự dùng"): write one sentence per target — rewrite a given sentence with it, or
//   answer an IELTS question with it; the whole round is checked in ONE Gemini call.
import { Check, Lightbulb, PenLine, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { ReviewCard } from '@/types/content'
import type { ProduceResult, ProduceVerdict } from '@/types/review'
import { DiffText } from '../practice/components/DiffText'
import { compareSentence } from '../practice/lib/compare'
import { reviewApi } from './api'
import { LadderToggle } from './LadderToggle'
import { produceRating } from './ladder'
import { hintOf, isPartnerCorrect, type CollocateAnswer, type CollocateTask, type WritingTask } from './usageTasks'

type Rating = 1 | 2 | 3 | 4

/* ───────────── Dùng đúng cụm ───────────── */

export function CollocateExercise({ task, onSubmit }: { task: CollocateTask; onSubmit: (answer: CollocateAnswer) => void }) {
  const [typed, setTyped] = useState('')
  const [hinted, setHinted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  const answer = task.answers[0]
  const submit = () => onSubmit({ typed, correct: isPartnerCorrect(typed, task.answers), hinted })

  return (
    <form
      className="flex w-full flex-col items-center gap-5 text-center"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <p className="text-sm font-semibold text-slate-500">Điền từ đi kèm cho đúng cụm (collocation)</p>
      {task.meaning ? <p className="max-w-2xl text-lg text-slate-800 dark:text-slate-100">{task.meaning}</p> : null}
      <p className="max-w-2xl text-xl leading-[2.4] text-slate-900 dark:text-white">
        {task.before}
        <input
          ref={inputRef}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={hinted ? hintOf(answer) : '…'}
          aria-label="Missing word"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          style={{ width: `${Math.max(6, answer.length + 3)}ch` }}
          className="mx-1 inline-block h-10 rounded-lg border-b-2 border-brand-400 bg-brand-50/60 px-2 text-center text-lg focus:bg-white focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:bg-brand-950/40 dark:focus:bg-slate-900"
        />
        {task.after}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="submit" size="lg">
          Check
        </Button>
        <Button type="button" variant="outline" onClick={() => setHinted(true)} disabled={hinted} title="Hiện chữ cái đầu (tối đa chấm Hard)">
          <Lightbulb className="size-4" /> Gợi ý
        </Button>
      </div>
      <button
        type="button"
        onClick={() => onSubmit({ typed: '', correct: false, hinted })}
        className="-my-2 px-2 py-2 text-xs font-semibold text-slate-400 hover:text-slate-600"
      >
        I don't know — show answer
      </button>
    </form>
  )
}

/** The checked sentence with the right partner highlighted, shown above the card's answer. */
export function CollocateResult({ task, answer }: { task: CollocateTask; answer: CollocateAnswer }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl px-4 py-3 text-sm',
        answer.correct
          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
          : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
      )}
    >
      {answer.correct ? <Check className="mt-0.5 size-4 shrink-0" /> : <X className="mt-0.5 size-4 shrink-0" />}
      <div className="space-y-1">
        <p>
          {task.before}
          <strong className="font-bold underline decoration-2 underline-offset-4">{task.answers[0]}</strong>
          {task.after}
        </p>
        <p className="text-xs opacity-80">
          Cụm: <strong>{task.phrase}</strong>
          {!answer.correct && answer.typed ? <> · bạn gõ “{answer.typed}”</> : null}
          {answer.hinted ? ' · đã dùng gợi ý' : null}
        </p>
      </div>
    </div>
  )
}

/* ───────────── Viết lại câu + Tự dùng ───────────── */

export interface ProduceRoundItem {
  id: string
  card: ReviewCard
  task: WritingTask
}

export interface ProduceGrade {
  id: string
  /** The review mode the sentence practised: "paraphrase" or "produce". */
  mode: WritingTask['kind']
  rating: Rating
  verdict: ProduceVerdict
  durationMs: number
}

const VERDICT_LABEL: Record<ProduceVerdict, string> = {
  ok: 'Đúng',
  missing: 'Chưa dùng từ',
  wrong_meaning: 'Sai nghĩa',
  wrong_collocation: 'Sai cụm từ',
  wrong_form: 'Sai dạng từ',
  changed_meaning: 'Đổi nghĩa câu gốc',
}

const GRADE_CHIPS: { rating: Rating; label: string; tone: string }[] = [
  { rating: 1, label: 'Again', tone: 'text-rose-700 dark:text-rose-300' },
  { rating: 2, label: 'Hard', tone: 'text-amber-700 dark:text-amber-300' },
  { rating: 3, label: 'Good', tone: 'text-emerald-700 dark:text-emerald-300' },
  { rating: 4, label: 'Easy', tone: 'text-sky-700 dark:text-sky-300' },
]

/** Time spent on one sentence: from the first to the last keystroke, plus a little for reading the question. */
const READING_MS = 10_000
interface Draft {
  text: string
  hinted: boolean
  firstAt: number
  lastAt: number
}

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] leading-relaxed focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-900'

function TargetHeader({ item, index }: { item: ProduceRoundItem; index: number }) {
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-bold text-slate-400">{index + 1}.</span>
        <span className="text-lg font-bold text-slate-900 dark:text-white">{item.task.target}</span>
        {item.task.meaning ? <span className="text-sm text-slate-500 dark:text-slate-400">{item.task.meaning}</span> : null}
        <LadderToggle id={item.id} className="ml-auto" />
      </p>
      {item.task.kind === 'paraphrase' ? (
        <div className="text-sm text-slate-600 dark:text-slate-300">
          <span className="mr-1.5 rounded-md bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
            Viết lại câu
          </span>
          giữ nguyên nghĩa, dùng <strong className="text-slate-900 dark:text-white">{item.task.target}</strong>:
          <p className="mt-1.5 rounded-lg border-l-4 border-sky-300 bg-slate-50 px-3 py-2 text-[15px] text-slate-800 dark:border-sky-700 dark:bg-slate-800/50 dark:text-slate-100">
            {item.task.source}
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <span className="mr-1.5 rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
            {item.task.topic}
          </span>
          {item.task.question}
        </p>
      )}
    </div>
  )
}

/** What the check was based on: the card's dictionary data (sent as REF) or only the model's own knowledge. */
function Basis({ backed, hasRef }: { backed: boolean; hasRef: boolean }) {
  if (backed) return <p className="text-xs text-emerald-700 dark:text-emerald-400">✓ Đã đối chiếu với dữ liệu từ điển của thẻ (Longman/OZDIC).</p>
  return (
    <p className="text-xs text-amber-700 dark:text-amber-400">
      {hasRef ? 'Dữ liệu từ điển của thẻ không nói về cách dùng này' : 'Thẻ không có dữ liệu từ điển'} — AI chấm theo kiến thức riêng; nếu thấy chưa
      đúng, hãy đổi mức nhớ.
    </p>
  )
}

/** Retype the corrected sentence; the diff shows what is still different. */
function Rewrite({ fixed }: { fixed: string }) {
  const [text, setText] = useState('')
  const [checked, setChecked] = useState<string | null>(null)
  const result = checked === null ? null : compareSentence(checked, fixed)
  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setChecked(text)
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Viết lại câu cho đúng…"
          aria-label="Rewrite the sentence"
          className={cn(fieldClass, 'h-10 py-0')}
        />
        <Button type="submit" variant="outline" disabled={!text.trim()}>
          Kiểm tra
        </Button>
      </form>
      {result ? (
        <div className="text-sm">
          {result.correct ? <span className="font-semibold text-emerald-600">Chính xác!</span> : <DiffText parts={result.parts} />}
        </div>
      ) : null}
    </div>
  )
}

function ResultView({
  item,
  index,
  sentence,
  result,
  rating,
  practice,
  onRate,
}: {
  item: ProduceRoundItem
  index: number
  sentence: string
  result: ProduceResult
  rating: Rating
  practice: boolean
  onRate: (r: Rating) => void
}) {
  const ok = result.verdict === 'ok'
  const chips = practice ? [GRADE_CHIPS[0], { ...GRADE_CHIPS[2], label: 'Got it' }] : GRADE_CHIPS
  return (
    <div className="space-y-3 border-b border-slate-100 px-5 py-5 last:border-b-0 sm:px-7 dark:border-slate-800">
      <TargetHeader item={item} index={index} />
      <div
        className={cn(
          'flex items-start gap-2 rounded-xl px-4 py-3 text-[15px]',
          ok
            ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100'
            : 'bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100',
        )}
      >
        {ok ? <Check className="mt-1 size-4 shrink-0" /> : <X className="mt-1 size-4 shrink-0" />}
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-bold tracking-wide uppercase opacity-80">
            {VERDICT_LABEL[result.verdict]}
            {ok && !result.natural ? ' · chưa tự nhiên' : null}
          </p>
          <div>
            {sentence ? (
              result.fixed ? (
                <DiffText parts={compareSentence(sentence, result.fixed).parts} />
              ) : (
                sentence
              )
            ) : (
              <em className="opacity-70">(bỏ qua)</em>
            )}
          </div>
        </div>
      </div>
      {result.why ? <p className="text-sm text-slate-700 dark:text-slate-200">{result.why}</p> : null}
      {sentence && result.verdict !== 'missing' ? <Basis backed={result.refBacked} hasRef={Boolean(item.task.ref)} /> : null}
      {item.task.model ? (
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <Sparkles className="mr-1 inline size-3.5 text-amber-500" />
          <span className="font-semibold">Câu mẫu:</span> {item.task.model}
        </p>
      ) : result.better ? (
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <Sparkles className="mr-1 inline size-3.5 text-amber-500" />
          <span className="font-semibold">Câu tự nhiên hơn:</span> {result.better}
        </p>
      ) : null}
      {item.task.example ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          <span className="font-semibold">Ví dụ trong từ điển:</span> <em>{item.task.example}</em>
        </p>
      ) : null}
      {result.other ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold">Lỗi khác (không tính điểm):</span> {result.other}
        </p>
      ) : null}
      {result.fixed ? <Rewrite fixed={result.fixed} /> : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-xs font-semibold text-slate-500">Mức nhớ:</span>
        {chips.map((g) => (
          <button
            key={g.rating}
            type="button"
            aria-pressed={rating === g.rating}
            onClick={() => onRate(g.rating)}
            className={cn(
              'rounded-lg border px-3 py-1 text-sm font-semibold transition-colors',
              g.tone,
              rating === g.rating
                ? 'border-current bg-white ring-2 ring-current/30 dark:bg-slate-900'
                : 'border-slate-200 opacity-70 hover:opacity-100 dark:border-slate-700',
            )}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function roundTitle(items: ProduceRoundItem[]): string {
  const kinds = new Set(items.map((it) => it.task.kind))
  if (kinds.size > 1) return 'Viết câu — viết lại câu cho sẵn hoặc tự viết câu IELTS, dùng đúng từ/cụm'
  return kinds.has('paraphrase') ? 'Viết lại câu — giữ nguyên nghĩa, dùng từ/cụm chỉ định' : 'Tự dùng — viết 1 câu IELTS cho mỗi từ/cụm, đúng chủ đề'
}

/**
 * One round of written sentences ("Viết lại câu" / "Tự dùng"): write all sentences, check them together (one Gemini call), read the
 * feedback, confirm the suggested grades, continue. An empty sentence counts as "missing" and is not sent.
 */
export function ProduceRound({
  items,
  practice,
  saving,
  onStart,
  onDone,
  onChecked,
}: {
  items: ProduceRoundItem[]
  practice: boolean
  saving: boolean
  /** First keystroke: the session must not stop for the time limit in the middle of a round. */
  onStart: () => void
  onDone: (grades: ProduceGrade[]) => void
  /** Tokens of the Gemini check, once the sentences are checked. */
  onChecked?: (tokens: number) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [results, setResults] = useState<Record<string, ProduceResult> | null>(null)
  const [ratings, setRatings] = useState<Record<string, Rating>>({})
  const [tokens, setTokens] = useState(0)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => firstRef.current?.focus(), [])

  const draftOf = (id: string): Draft => drafts[id] ?? { text: '', hinted: false, firstAt: 0, lastAt: 0 }
  const msOf = (d: Draft) => (d.firstAt ? d.lastAt - d.firstAt + READING_MS : 0)
  const edit = (id: string, patch: Partial<Draft>) => {
    if (!Object.keys(drafts).length) onStart()
    setDrafts((all) => ({ ...all, [id]: { ...draftOf(id), ...patch } }))
  }
  const type = (id: string, text: string) => {
    const now = Date.now()
    const d = draftOf(id)
    edit(id, { text, firstAt: d.firstAt || now, lastAt: now })
  }

  const check = async () => {
    setError(null)
    const written = items.filter((it) => draftOf(it.id).text.trim())
    const short = written.find((it) => draftOf(it.id).text.trim().split(/\s+/).length < 4)
    if (short) return setError(`Hãy viết một câu đầy đủ cho “${short.task.target}” (ít nhất 4 từ), hoặc để trống để bỏ qua.`)
    const missing: ProduceResult = {
      id: '',
      verdict: 'missing',
      natural: true,
      fixed: '',
      why: 'Bạn chưa viết câu.',
      better: '',
      other: '',
      refBacked: false,
    }
    const next: Record<string, ProduceResult> = Object.fromEntries(items.map((it) => [it.id, { ...missing, id: it.id }]))
    if (written.length) {
      setChecking(true)
      try {
        const res = await reviewApi.produce(
          written.map((it) => ({
            id: it.id,
            target: it.task.target,
            meaning: it.task.meaning,
            topic: it.task.topic,
            question: it.task.question,
            source: it.task.source,
            ref: it.task.ref,
            sentence: draftOf(it.id).text,
          })),
        )
        for (const r of res.results) next[r.id] = r
        setTokens(res.usage.total)
        onChecked?.(res.usage.total)
      } catch (e) {
        setChecking(false)
        return setError((e as Error).message)
      }
      setChecking(false)
    }
    setResults(next)
    setRatings(
      Object.fromEntries(
        items.map((it) => {
          const d = draftOf(it.id)
          const r = produceRating(next[it.id], msOf(d), d.hinted)
          // Practice only has Again / Got it.
          return [it.id, practice ? (r === 1 ? 1 : 3) : r]
        }),
      ),
    )
  }

  const finish = () => {
    if (!results) return
    onDone(
      items.map((it) => ({
        id: it.id,
        mode: it.task.kind,
        rating: ratings[it.id] ?? 3,
        verdict: results[it.id].verdict,
        durationMs: msOf(draftOf(it.id)) || READING_MS,
      })),
    )
  }

  // Ctrl+Enter checks; Enter (outside a text field) continues once the feedback is shown.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!results && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        void check()
      } else if (results && e.key === 'Enter' && !(e.target as HTMLElement).closest('input, textarea')) {
        e.preventDefault()
        finish()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-600 sm:px-7 dark:border-slate-800 dark:text-slate-300">
          <PenLine className="size-4 text-brand-600" />
          {roundTitle(items)}
        </div>
        {results
          ? items.map((it, i) => (
              <ResultView
                key={it.id}
                item={it}
                index={i}
                sentence={draftOf(it.id).text.trim()}
                result={results[it.id]}
                rating={ratings[it.id] ?? 3}
                practice={practice}
                onRate={(r) => setRatings((all) => ({ ...all, [it.id]: r }))}
              />
            ))
          : items.map((it, i) => {
              const d = draftOf(it.id)
              return (
                <div key={it.id} className="space-y-2.5 border-b border-slate-100 px-5 py-5 last:border-b-0 sm:px-7 dark:border-slate-800">
                  <TargetHeader item={it} index={i} />
                  <textarea
                    ref={i === 0 ? firstRef : undefined}
                    value={d.text}
                    onChange={(e) => type(it.id, e.target.value)}
                    rows={2}
                    placeholder={
                      it.task.kind === 'paraphrase' ? `Viết lại câu trên với “${it.task.target}”…` : `Một câu có dùng “${it.task.target}”…`
                    }
                    aria-label={`Sentence with ${it.task.target}`}
                    spellCheck={false}
                    className={cn(fieldClass, 'resize-y')}
                  />
                  {it.task.example ? (
                    d.hinted ? (
                      <p className="text-sm text-slate-500 italic dark:text-slate-400">Ví dụ: {it.task.example}</p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => edit(it.id, { hinted: true })}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600"
                      >
                        <Lightbulb className="size-3.5" /> Xem ví dụ (tối đa chấm Hard)
                      </button>
                    )
                  ) : null}
                </div>
              )
            })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-400">
          {results
            ? `Gợi ý mức nhớ đã được chọn sẵn — đổi nếu bạn thấy chưa đúng.${tokens ? ` · Gemini ${tokens.toLocaleString()} tokens` : ''}`
            : 'Chỉ chấm cách dùng từ/cụm mục tiêu; lỗi khác chỉ được ghi chú. Để trống câu nếu bạn không nghĩ ra.'}
        </p>
        {results ? (
          <Button onClick={finish} loading={saving}>
            Lưu & tiếp tục
          </Button>
        ) : (
          <Button onClick={() => void check()} loading={checking}>
            Kiểm tra {items.length > 1 ? `${items.length} câu` : 'câu'} <span className="text-xs opacity-70">Ctrl+Enter</span>
          </Button>
        )}
      </div>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </div>
  )
}
