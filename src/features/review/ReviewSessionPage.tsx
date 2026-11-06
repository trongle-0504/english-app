import * as Popover from '@radix-ui/react-popover'
import { ArrowLeft, Check, CircleHelp, Coffee, EyeOff, Headphones, Keyboard, PartyPopper, Plus, Repeat, RotateCcw, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { Button, ButtonLink, Card, EmptyState, Kbd, Progress } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useData } from '@/lib/data'
import { speak } from '@/lib/speech'
import { useLocalStorage } from '@/lib/storage'
import type { ReviewCard, ReviewIndex } from '@/types/content'
import type { BasicReviewMode, ReviewMode, StoredCard, UsageStage } from '@/types/review'
import { DiffText } from '../practice/components/DiffText'
import { compareSentence } from '../practice/lib/compare'
import { RichText } from '../words/RichText'
import { AnswerView, blankTerm, SourceTag, TermHeading } from './CardView'
import { CardStatus } from './CardStatus'
import { DictationExercise, DictationResult } from './Dictation'
import { effectiveStage, ladderStage, modeFor } from './ladder'
import { LadderToggle } from './LadderToggle'
import { FixExercise, FixResult, RealUses } from './PracticeCards'
import { intersect, recentDaysParam, useRecentScope } from './recent-scope'
import { parseSources, sourceScope, sourcesLabel } from './sources'
import { isRecallCorrect } from './recall'
import { buildQueue, LEARN_AHEAD_MS, pickMode, practiceQueue } from './queue'
import { previewIntervals } from './schedule'
import { SessionTimer, useStudyTime } from './SessionTimer'
import { TIME_LIMIT_KEY } from './StartSessionButton'
import { gradeCard, undoLastReview, useReviewStore } from './store'
import { CollocateExercise, CollocateResult, ProduceRound, type ProduceGrade, type ProduceRoundItem } from './UsageExercises'
import {
  abilitiesOf,
  cardCollocateTasks,
  collocateRating,
  dictationRating,
  dictationText,
  recentTopics,
  rememberTopics,
  writingTask,
  type CollocateTask,
  type WritingTask,
} from './usageTasks'

type Rating = 1 | 2 | 3 | 4

const GRADES: { rating: Rating; label: string; hint: string; className: string }[] = [
  {
    rating: 1,
    label: 'Again',
    hint: 'Quên / nhớ sai',
    className: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
  },
  {
    rating: 2,
    label: 'Hard',
    hint: 'Nhớ nhưng chật vật',
    className: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  },
  {
    rating: 3,
    label: 'Good',
    hint: 'Nhớ được',
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  {
    rating: 4,
    label: 'Easy',
    hint: 'Nhớ ngay, quá dễ',
    className: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  },
]

/** Practice sessions only ask whether you knew the card. */
const PRACTICE_GRADES = [GRADES[0], { ...GRADES[2], label: 'Got it', hint: 'Nhớ được' }]

/** When to press each grade (the "Chọn mức nào?" popover). */
const GRADE_GUIDE: { label: string; tone: string; when: string; effect: string }[] = [
  {
    label: 'Again',
    tone: 'text-rose-700 dark:text-rose-300',
    when: 'Không nhớ ra, nhớ sai, hoặc phải xem đáp án mới biết.',
    effect: 'Thẻ quay lại sau vài phút để học lại; độ bền trí nhớ giảm.',
  },
  {
    label: 'Hard',
    tone: 'text-amber-700 dark:text-amber-300',
    when: 'Nhớ ĐÚNG nhưng phải nghĩ rất lâu, còn lưỡng lự hoặc chỉ nhớ gần đủ.',
    effect: 'Vẫn tính là nhớ, nhưng khoảng cách chỉ tăng ít.',
  },
  {
    label: 'Good',
    tone: 'text-emerald-700 dark:text-emerald-300',
    when: 'Nhớ đúng sau một chút suy nghĩ bình thường. Đây là lựa chọn phổ biến nhất.',
    effect: 'Khoảng cách tăng bình thường theo thuật toán.',
  },
  {
    label: 'Easy',
    tone: 'text-sky-700 dark:text-sky-300',
    when: 'Trả lời ngay lập tức, không chút do dự — thẻ này quá dễ với bạn.',
    effect: 'Khoảng cách tăng mạnh (thẻ mới bỏ qua các bước ngắn).',
  },
]

function GradeGuide() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400"
        >
          <CircleHelp className="size-3.5" /> Chọn mức nào?
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={{ top: 76, right: 12, bottom: 12, left: 12 }}
          className="animate-scale-in z-50 max-h-[var(--radix-popover-content-available-height)] w-[30rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <p className="mb-3 font-semibold text-slate-900 dark:text-white">Chấm theo mức độ bạn nhớ TRƯỚC khi xem đáp án</p>
          <ul className="space-y-2.5">
            {GRADE_GUIDE.map((g) => (
              <li key={g.label} className="grid grid-cols-[3.5rem_1fr] gap-2">
                <span className={cn('font-bold', g.tone)}>{g.label}</span>
                <span className="text-[13px] leading-snug text-slate-600 dark:text-slate-300">
                  {g.when} <span className="text-slate-400">{g.effect}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 mb-1.5 font-semibold text-slate-900 dark:text-white">Mẹo</p>
          <ul className="list-disc space-y-1 pl-5 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
            <li>
              Quên hoặc sai thì luôn chọn <strong>Again</strong> — đừng chọn Hard để “nương tay”, thẻ sẽ bị hẹn quá xa và dễ quên hẳn.
            </li>
            <li>
              Phân vân giữa Hard và Good → chọn <strong>Good</strong>.
            </li>
            <li>
              Dùng <strong>Easy</strong> ít thôi; chọn Easy quá dễ dãi khiến thẻ rất lâu mới quay lại.
            </li>
            <li>Ở chế độ gõ đáp án, app tự khoanh sẵn mức gợi ý theo câu trả lời của bạn.</li>
            <li>
              Lỡ chấm nhầm? Nhấn <Kbd>Z</Kbd> để hoàn tác.
            </li>
          </ul>
          <Popover.Arrow className="fill-white dark:fill-slate-900" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

interface Answer {
  typed: string
  correct: boolean
  /** Collocation exercise: the first-letter hint was used. */
  hinted?: boolean
  /** Dictation: words missing, extra or wrong. */
  errors?: number
}

/** Writing rounds ("Viết lại câu" + "Tự dùng"): sentences checked together, and how far ahead to look for them. */
const ROUND_SIZE = 3
const ROUND_LOOKAHEAD = 15
/** The exercise chosen for the card on screen, fixed until the next card (grading must not re-pick it). */
interface Exercise {
  slot: string
  mode: ReviewMode
  collocate: CollocateTask | null
  /** Dictation: the sentence read aloud. */
  dictation: string | null
  /** Writing stages: this card plus the next cards at a writing stage, answered and checked together. */
  round: ProduceRoundItem[] | null
}

const isWriting = (mode: ReviewMode | UsageStage): mode is WritingTask['kind'] => mode === 'paraphrase' || mode === 'produce'

/**
 * The meaning shown when typing the word: one meaning per line ("1. …", "2. …"), the short gloss before " - " a little
 * stronger than its explanation. Normal weight and size, so several meanings stay readable.
 */
function MeaningPrompt({ text }: { text: string }) {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
  const item = (line: string) => {
    const body = line.replace(/^\d+[.)]\s*/, '')
    const cut = body.indexOf(' - ')
    return cut > 0 ? (
      <>
        <span className="font-semibold text-slate-900 dark:text-white">
          <RichText text={body.slice(0, cut)} />
        </span>
        <span className="text-slate-600 dark:text-slate-300">
          {' – '}
          <RichText text={body.slice(cut + 3)} />
        </span>
      </>
    ) : (
      <span className="text-slate-800 dark:text-slate-100">
        <RichText text={body} />
      </span>
    )
  }
  if (lines.length <= 1) return <p className="max-w-2xl text-lg leading-relaxed text-balance">{item(lines[0] ?? text)}</p>
  return (
    <ol className="w-full max-w-2xl space-y-2 text-left text-[15px] leading-relaxed">
      {lines.map((line, i) => (
        <li key={i} className="flex gap-2.5 rounded-xl bg-slate-50 px-3.5 py-2.5 dark:bg-slate-800/50">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
            {i + 1}
          </span>
          <span>{item(line)}</span>
        </li>
      ))}
    </ol>
  )
}

/** Recall: see the meaning, type the English. */
function TypedAnswer({ card, onSubmit }: { card: ReviewCard; onSubmit: (answer: Answer) => void }) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  const clue = card.examples[0] ? blankTerm(card.examples[0].en, card.term) : null

  return (
    <div className="flex w-full flex-col items-center gap-5 text-center">
      <p className="text-sm font-semibold text-slate-500">Type the English {card.source === 'note' ? 'phrase' : 'word or phrase'}</p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {card.part_of_speech.map((pos) => (
          <span
            key={pos}
            className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300"
          >
            {pos}
          </span>
        ))}
      </div>
      <MeaningPrompt text={card.meaning_vi || card.meaning_en || '—'} />
      {clue ? <p className="max-w-2xl text-sm text-slate-500 italic dark:text-slate-400">“{clue.replace(/\*\*/g, '')}”</p> : null}
      <form
        className="flex w-full max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit({ typed, correct: isRecallCorrect(typed, card.term) })
        }}
      >
        <input
          ref={inputRef}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Your answer…"
          aria-label="Your answer"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-lg focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        />
        <Button type="submit" size="lg" className="shrink-0">
          Check
        </Button>
      </form>
      <button
        type="button"
        onClick={() => onSubmit({ typed: '', correct: false })}
        className="-my-2 px-2 py-2 text-xs font-semibold text-slate-400 hover:text-slate-600"
      >
        I don't know — show answer
      </button>
    </div>
  )
}

function ReviewSession() {
  const index = useData<ReviewIndex>('review/index.json')
  const review = useReviewStore()
  const [params] = useSearchParams()
  const deckId = params.get('deck')
  // ?practice=1: go through studied cards again without touching the schedule. ?extraNew=N: learn N more new cards today.
  const practice = params.get('practice') === '1'
  const extraNew = Math.max(0, Math.min(200, Number(params.get('extraNew')) || 0))
  const srcParam = params.get('src')
  // ?recent=N: only the phrases of your Speaking / Writing of the last N days; ?newMax=M new cards among them.
  const recentDays = recentDaysParam(params.get('recent'))
  const newMax = Math.max(0, Math.min(200, Number(params.get('newMax')) || 20))
  const recent = useRecentScope(recentDays)
  // ?ids=a,b: only these cards (e.g. the ones you forget most).
  const idsParam = params.get('ids')
  const listed = useMemo(() => (idsParam ? new Set(idsParam.split(',').filter(Boolean)) : undefined), [idsParam])
  const home = recentDays ? '/review?tab=recent' : '/review'
  const sources = useMemo(() => parseSources(srcParam), [srcParam])

  const cardsById = useMemo(() => new Map(index.cards.map((c) => [c.id, c])), [index])
  const known = useMemo(() => new Set(cardsById.keys()), [cardsById])
  const deck = deckId ? index.decks.find((d) => d.id === deckId) : undefined

  // The queue is fixed when the session starts; learning cards are re-inserted as they come due.
  const [queue, setQueue] = useState<string[] | null>(null)
  useEffect(() => {
    if (queue || review.status !== 'ready' || !review.settings || recent.ids === null) return
    // A deck and/or the chosen sources (?src=) limit the session.
    const fromSources = sourceScope(cardsById, sources)
    const deckIds = deck ? new Set(deck.cardIds) : undefined
    const only = intersect(
      intersect(deckIds && fromSources ? new Set([...deckIds].filter((id) => fromSources.has(id))) : (deckIds ?? fromSources), recent.ids),
      listed,
    )
    setQueue(
      practice
        ? practiceQueue(review.cards, known, only)
        : buildQueue(review.cards, review.settings, review.today, known, { only, extraNew, ...(recentDays ? { newLimit: newMax } : {}) }).order,
    )
  }, [queue, review, known, deck, practice, extraNew, cardsById, sources, recent.ids, recentDays, newMax, listed])

  const [position, setPosition] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ id: string; rating: Rating }[]>([])
  const startedAt = useRef(Date.now())
  const [sessionStart] = useState(() => Date.now())

  const currentId = queue?.[position]
  const card = currentId ? cardsById.get(currentId) : undefined
  const stored = currentId ? review.cards[currentId] : undefined
  const basicModes = review.settings?.modes ?? ['recognize']
  const ladder = review.settings?.ladder ?? false

  // One exercise per card on screen, picked when the card arrives (stored while rendering, not on every render): with
  // the usage ladder the card's stage decides it, otherwise one of the modes switched on in Settings.
  const slot = currentId ? `${currentId}@${position}` : ''
  const [exercise, setExercise] = useState<Exercise>({ slot: '', mode: 'recognize', collocate: null, dictation: null, round: null })
  if (card && currentId && queue && exercise.slot !== slot) {
    // A mistake card (Sổ lỗi) is always practised by correcting your sentence.
    const picked: ReviewMode = card.mistake
      ? 'fix'
      : ladder
        ? modeFor(ladderStage(stored), abilitiesOf(card), basicModes, pickMode)
        : pickMode<BasicReviewMode>(basicModes)
    let round: ProduceRoundItem[] | null = null
    if (isWriting(picked)) {
      // The next cards at a writing stage join this one, so the whole round costs one Gemini call.
      const writingKind = (id: string) => {
        const c = cardsById.get(id)
        const stage = c ? effectiveStage(ladderStage(review.cards[id]), abilitiesOf(c)) : null
        return stage && isWriting(stage) ? stage : null
      }
      const ids = [...new Set([currentId, ...queue.slice(position + 1, position + 1 + ROUND_LOOKAHEAD).filter((id) => writingKind(id))])].slice(
        0,
        ROUND_SIZE,
      )
      const recent = recentTopics()
      round = ids.map((id) => {
        const c = cardsById.get(id) as ReviewCard
        const task = writingTask(c, id === currentId ? picked : writingKind(id), recent, pickMode)
        if (task.topic) recent.unshift(task.topic)
        return { id, card: c, task }
      })
    }
    setExercise({
      slot,
      mode: picked,
      collocate: picked === 'collocate' ? pickMode(cardCollocateTasks(card).slice(0, 3)) : null,
      dictation: picked === 'listen' ? dictationText(card) : null,
      round,
    })
  }
  const mode = exercise.slot === slot ? exercise.mode : 'recognize'
  // A writing round has been started (typing or feedback on screen).
  const [roundOpen, setRoundOpen] = useState(false)
  const savedInRound = useRef(new Map<string, StoredCard>())

  // New card on screen: reset the answer state, start the timer, and read the dictation sentence aloud.
  useEffect(() => {
    setRevealed(false)
    setAnswer(null)
    setRoundOpen(false)
    savedInRound.current = new Map()
    startedAt.current = Date.now()
    if (mode === 'listen' && exercise.dictation) speak(exercise.dictation)
  }, [card, mode, position, exercise.dictation])

  // Optional time limit (10–25 min): when it runs out the session stops after the card being answered.
  const [limitMin, setLimitMin] = useLocalStorage<number>(TIME_LIMIT_KEY, 0)
  const [extraMin, setExtraMin] = useState(0)
  const budgetMs = limitMin > 0 ? (limitMin + extraMin) * 60_000 : 0
  const elapsed = useStudyTime({ idle: !card, holding: revealed || answer !== null || busy || roundOpen, budgetMs })
  const timeUp = limitMin > 0 && elapsed >= budgetMs

  const intervals = useMemo(() => (stored && review.settings ? previewIntervals(stored.fsrs, review.settings) : null), [stored, review.settings])

  /**
   * Moves past the graded cards (one card, or a whole "Tự dùng" round pulled together from further down the queue).
   * A card still in (re)learning and due soon — in practice: any forgotten card — comes back later in this session.
   */
  const advance = useCallback(
    (graded: { id: string; rating: Rating; next?: StoredCard }[]) => {
      if (!queue) return
      const rest = queue.slice(position)
      for (const g of graded) rest.splice(rest.indexOf(g.id), 1)
      for (const g of graded) {
        const soon = practice
          ? g.rating === 1
          : Boolean(g.next && g.next.fsrs.state !== 2 && Date.parse(g.next.fsrs.due) - Date.now() < LEARN_AHEAD_MS)
        if (soon) rest.splice(Math.min(rest.length, g.rating === 1 ? 3 : 6), 0, g.id)
      }
      setDone((d) => [...d, ...graded.map(({ id, rating }) => ({ id, rating }))])
      setQueue([...queue.slice(0, position), ...graded.map((g) => g.id), ...rest])
      setPosition(position + graded.length)
    },
    [queue, position, practice],
  )

  const grade = useCallback(
    async (rating: Rating) => {
      if (!currentId || !queue || busy) return
      // Practice: nothing is saved.
      if (practice) return advance([{ id: currentId, rating }])
      setBusy(true)
      setError(null)
      try {
        advance([{ id: currentId, rating, next: await gradeCard(currentId, rating, mode, Date.now() - startedAt.current) }])
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [currentId, queue, busy, mode, practice, advance],
  )

  /** Saves a finished "Tự dùng" round; after an error, a retry skips the sentences already saved. */
  const finishRound = useCallback(
    async (grades: ProduceGrade[]) => {
      if (busy) return
      rememberTopics(exercise.round?.map((r) => r.task.topic) ?? [])
      if (practice) return advance(grades)
      setBusy(true)
      setError(null)
      try {
        const saved = savedInRound.current
        for (const g of grades) if (!saved.has(g.id)) saved.set(g.id, await gradeCard(g.id, g.rating, g.mode, g.durationMs, g.verdict))
        advance(grades.map((g) => ({ ...g, next: saved.get(g.id) })))
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [busy, exercise.round, practice, advance],
  )

  const undo = useCallback(async () => {
    if (!done.length || busy || !queue) return
    if (practice) {
      setDone((d) => d.slice(0, -1))
      setPosition((p) => Math.max(0, p - 1))
      return
    }
    setBusy(true)
    try {
      const id = await undoLastReview()
      setDone((d) => d.slice(0, -1))
      // Put the card back on screen, dropping any re-queued copy of it.
      const rest = queue.slice(position).filter((q) => q !== id)
      setQueue([...queue.slice(0, position), id, ...rest])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [done, busy, queue, position, practice])

  const showAnswer = revealed || answer !== null
  // Flip back to the front (typed modes return to the answer box).
  const hideAnswer = useCallback(() => {
    setRevealed(false)
    setAnswer(null)
  }, [])
  const graded: Rating | null = !answer
    ? null
    : mode === 'collocate'
      ? collocateRating({ hinted: false, ...answer })
      : mode === 'listen' && exercise.dictation
        ? dictationRating(answer.errors ?? Infinity, exercise.dictation)
        : answer.correct
          ? 3
          : 1
  // Practice only has Again / Got it: a Hard answer still counts as remembered.
  const suggested: Rating | null = practice && graded === 2 ? 3 : graded

  // Time is up: stop between cards (never while an answer is on screen or a grade is being saved).
  const stopped = timeUp && Boolean(card) && !showAnswer && !busy && !roundOpen

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stopped || (e.target as HTMLElement).closest('input, textarea, select')) return
      if (showAnswer && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault()
        hideAnswer()
      } else if ((e.key === 'z' || e.key === 'Z') && !e.metaKey) {
        e.preventDefault()
        void undo()
      } else if (!showAnswer && (e.key === ' ' || e.key === 'Enter') && mode === 'recognize') {
        e.preventDefault()
        setRevealed(true)
      } else if (showAnswer && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        void grade(Number(e.key) as Rating)
      } else if (showAnswer && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        void grade(suggested ?? 3)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showAnswer, mode, grade, undo, suggested, hideAnswer, stopped])

  if (review.status === 'offline') {
    return (
      <div className="pt-10">
        <EmptyState title="Reviews need the local server" description="Start the app with npm run dev (or npm start) so progress can be saved." />
      </div>
    )
  }
  if (!queue) return <div className="pt-24 text-center text-sm text-slate-400">Preparing your session…</div>

  const remaining = queue.length - position
  const total = queue.length

  if (stopped) {
    const again = done.filter((d) => d.rating === 1).length
    return (
      <div className="animate-fade-in mx-auto max-w-lg pt-16 text-center">
        <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300">
          <Coffee className="size-8" />
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white">Hết giờ — nghỉ một chút nhé!</h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
          {done.length} thẻ trong {Math.round(elapsed / 60000)} phút · {done.length - again} nhớ, {again} quên. Còn {remaining} thẻ trong phiên —
          chúng vẫn đến hạn, lần học sau sẽ tiếp tục.
        </p>
        <p className="mt-1 text-xs text-slate-400">Học ngắn và đều (10–25 phút) giúp tập trung tốt hơn và nhớ lâu hơn một phiên dài.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <ButtonLink to={home}>Back to dashboard</ButtonLink>
          <Button variant="outline" onClick={() => setExtraMin((m) => m + 5)}>
            <Plus className="size-4" /> Học thêm 5 phút
          </Button>
          {done.length && !practice ? (
            <Button variant="outline" onClick={() => void undo()} disabled={busy}>
              <Undo2 className="size-4" /> Undo last
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  if (!card) {
    const again = done.filter((d) => d.rating === 1).length
    const minutes = Math.max(1, Math.round((Date.now() - sessionStart) / 60000))
    return (
      <div className="animate-fade-in mx-auto max-w-lg pt-16 text-center">
        <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300">
          <PartyPopper className="size-8" />
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white">
          {done.length ? (practice ? 'Practice complete' : 'Session complete') : 'Nothing to review'}
        </h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
          {done.length
            ? `${done.length} cards in ${minutes} min · ${done.length - again} remembered, ${again} again.${practice ? ' Your schedule was not changed.' : ''}`
            : practice
              ? 'Study some cards first — practice goes through cards you have already learned.'
              : recentDays
                ? `Không còn thẻ nào của bài ${recentDays} ngày gần đây đến hạn. Tạo thẻ cho cụm còn thiếu ở tab Bài gần đây, hoặc quay lại sau.`
                : 'No cards are due right now. Add lessons to your reviews, or come back later.'}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <ButtonLink to={home}>Back to dashboard</ButtonLink>
          <ButtonLink
            to={`/review/session?practice=1${deckId ? `&deck=${encodeURIComponent(deckId)}` : ''}${recentDays ? `&recent=${recentDays}` : ''}`}
            variant="outline"
          >
            <Repeat className="size-4" /> Practice again
          </ButtonLink>
          {done.length && !practice ? (
            <Button variant="outline" onClick={() => void undo()} disabled={busy}>
              <Undo2 className="size-4" /> Undo last
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl pt-6">
      <title>NeSy</title>
      {/* Wraps on a phone: the badges stay one line each and the timer group moves to its own right-aligned row. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 [&>span]:whitespace-nowrap">
        <Link to={home} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white">
          <ArrowLeft className="size-4" /> {deck ? deck.name : 'Review'}
        </Link>
        {practice ? (
          <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
            Practice · schedule not changed
          </span>
        ) : null}
        {sources.length ? (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {sourcesLabel(sources)}
          </span>
        ) : null}
        {recentDays ? (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            Bài gần đây · {recentDays} ngày
          </span>
        ) : null}
        {listed ? (
          <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            Thẻ hay quên · {listed.size}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-3 text-sm">
          <SessionTimer limitMin={limitMin} onLimit={setLimitMin} elapsed={elapsed} budgetMs={budgetMs} />
          <span className="font-semibold whitespace-nowrap text-slate-600 tabular-nums dark:text-slate-300">{remaining} left</span>
          <Button variant="ghost" size="sm" onClick={() => void undo()} disabled={!done.length || busy} title="Undo (Z)">
            <Undo2 className="size-4" /> Undo
          </Button>
        </div>
      </div>
      <Progress value={total ? (position / total) * 100 : 0} className="mb-6" />

      {isWriting(mode) && exercise.round ? (
        <ProduceRound
          key={slot}
          items={exercise.round}
          practice={practice}
          saving={busy}
          onStart={() => setRoundOpen(true)}
          onDone={(g) => void finishRound(g)}
        />
      ) : (
        <>
          <Card key={`${currentId}-${position}`} className="animate-slide-up overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
              <SourceTag card={card} />
              <span className="inline-flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                {ladder && currentId && !card.mistake ? <LadderToggle id={currentId} className="text-[13px]" /> : null}
                {mode === 'recall' ? (
                  <Keyboard className="size-4 text-slate-400" />
                ) : mode === 'listen' ? (
                  <Headphones className="size-4 text-slate-400" />
                ) : null}
                <CardStatus
                  stage={ladder && !card.mistake ? effectiveStage(ladderStage(stored), abilitiesOf(card)) : null}
                  ladderOff={stored?.ladder === false && !card.mistake}
                  state={stored?.fsrs.state}
                />
              </span>
            </div>

            {showAnswer ? null : (
              <div className="flex min-h-[18rem] flex-col items-center justify-center gap-6 px-5 py-8 sm:px-10">
                {mode === 'recognize' ? <TermHeading card={card} /> : null}
                {mode === 'collocate' && exercise.collocate && !answer ? <CollocateExercise task={exercise.collocate} onSubmit={setAnswer} /> : null}
                {mode === 'recall' && !answer ? <TypedAnswer card={card} onSubmit={setAnswer} /> : null}
                {mode === 'fix' && card.mistake && !answer ? <FixExercise mistake={card.mistake} onSubmit={setAnswer} /> : null}
                {mode === 'listen' && exercise.dictation && !answer ? <DictationExercise text={exercise.dictation} onSubmit={setAnswer} /> : null}
                {mode === 'recognize' ? (
                  <Button size="lg" onClick={() => setRevealed(true)} className="min-w-48">
                    Show answer <Kbd className="ml-1 border-white/30 bg-white/10 text-white">Space</Kbd>
                  </Button>
                ) : null}
              </div>
            )}

            {showAnswer ? (
              <div className="space-y-5 px-5 py-6 sm:px-8">
                {answer && mode === 'collocate' && exercise.collocate ? (
                  <CollocateResult task={exercise.collocate} answer={{ hinted: false, ...answer }} />
                ) : null}
                {answer && mode === 'listen' && exercise.dictation ? (
                  <DictationResult text={exercise.dictation} answer={{ errors: Infinity, ...answer }} />
                ) : null}
                {answer && mode === 'recall' ? (
                  <div
                    className={cn(
                      'flex items-start gap-2 rounded-xl px-4 py-3 text-sm',
                      answer.correct
                        ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
                    )}
                  >
                    {answer.correct ? <Check className="mt-0.5 size-4 shrink-0" /> : <X className="mt-0.5 size-4 shrink-0" />}
                    <div>
                      {answer.correct ? (
                        'Correct!'
                      ) : answer.typed ? (
                        <DiffText parts={compareSentence(answer.typed, card.term).parts} />
                      ) : (
                        'Answer shown.'
                      )}
                    </div>
                  </div>
                ) : null}
                {mode === 'fix' && card.mistake ? (
                  <FixResult mistake={card.mistake} answer={answer ?? { typed: '', correct: false }} href={card.href} />
                ) : (
                  <>
                    <AnswerView card={card} />
                    <RealUses uses={stored?.uses} className="border-t border-slate-100 pt-4 dark:border-slate-800" />
                  </>
                )}
              </div>
            ) : null}
          </Card>

          {showAnswer ? (
            <div className="animate-slide-up sticky bottom-3 mt-4 rounded-2xl bg-slate-50/90 p-2 backdrop-blur dark:bg-slate-950/90">
              <div className="mb-2 flex items-center justify-between gap-3 px-1">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Bạn nhớ thẻ này thế nào? Chọn một mức để sang thẻ tiếp theo.
                  {practice ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                      <Repeat className="size-3.5" /> Chế độ luyện tập: Again = gặp lại sau vài thẻ · không ảnh hưởng lịch ôn
                    </span>
                  ) : (
                    <GradeGuide />
                  )}
                </p>
                <Button variant="ghost" size="sm" onClick={hideAnswer} title="Flip the card back (H)">
                  <EyeOff className="size-3.5" /> Hide answer
                </Button>
              </div>
              <div className={cn('grid gap-2', practice ? 'grid-cols-2' : 'grid-cols-4')}>
                {(practice ? PRACTICE_GRADES : GRADES).map((g) => (
                  <button
                    key={g.rating}
                    type="button"
                    disabled={busy}
                    onClick={() => void grade(g.rating)}
                    className={cn(
                      'flex flex-col items-center rounded-xl border px-2 py-2.5 font-semibold transition-colors disabled:opacity-50',
                      g.className,
                      suggested === g.rating && 'ring-2 ring-current ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-950',
                    )}
                  >
                    <span className="text-sm">{g.label}</span>
                    <span className="hidden text-[11px] leading-tight font-medium sm:block">{g.hint}</span>
                    <span className="mt-0.5 text-[11px] font-medium opacity-70">
                      {practice ? null : `${intervals?.[g.rating]} · `}
                      <kbd className="font-sans">{g.rating}</kbd>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
      {error ? (
        <p className="mt-3 flex items-center justify-center gap-2 text-sm text-rose-600">
          {error}
          <button type="button" onClick={() => setError(null)} className="underline">
            <RotateCcw className="inline size-3.5" /> dismiss
          </button>
        </p>
      ) : null}
      <p className={cn('mt-4 hidden text-center text-xs text-slate-400', !isWriting(mode) && 'sm:block')}>
        <Kbd>Space</Kbd> show / {suggested ? 'suggested' : 'Good'} · <Kbd>1</Kbd>–<Kbd>4</Kbd> grade · <Kbd>H</Kbd> hide answer · <Kbd>Z</Kbd> undo
      </p>
      <span className="sr-only" aria-live="polite">
        {showAnswer ? `Answer: ${card.term}` : ''}
      </span>
    </div>
  )
}

/** Remount per query (?practice / ?deck / ?extraNew) so each link starts a fresh session. */
export default function ReviewSessionPage() {
  const { search } = useLocation()
  return <ReviewSession key={search} />
}
