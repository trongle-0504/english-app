import { diffWords } from 'diff'
import {
  AlignLeft,
  BookOpen,
  Check,
  Copy,
  Edit3,
  ExternalLink,
  Languages,
  Library,
  Lightbulb,
  List,
  ListChecks,
  MessageSquareQuote,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Badge, Button, Card } from '@/components/ui'
import { ExportReport } from '@/features/report/ExportReport'
import { cn } from '@/lib/cn'
import type { AnswerSentence, LinearTool } from '@/types/speaking'
import type { WritingFix, WritingModelEssay, WritingReviewResult, WritingSuggestedPhrase } from '@/types/writingReview'
import {
  DolHints,
  ExtraRow,
  IdeaPanel,
  LibraryAddButtons,
  MARK,
  NATURAL_HINT,
  NaturalToggle,
  naturalCount,
  PickRow,
  Section,
  Segments,
  Structures,
  TOOL,
  ThinkInEnglish,
  Wording,
  copyFormatted,
} from '../speaking-ideas/SuggestionResult'
import { phraseGroups } from '../phrase-groups'
import { PhraseWorkProvider, RealUsePanel } from '../PhraseReview'
import { useAddToReview } from '../speaking-ideas/useAddToReview'
import { writingReviewApi } from './api'

const ozdicUrl = (word: string) => `https://ozdic.com/word/${encodeURIComponent(word.toLowerCase())}`

const EVIDENCE: Record<WritingFix['evidence'], { label: string; tone: 'emerald' | 'sky' | 'amber'; title: string }> = {
  longman: { label: 'Longman: collocation', tone: 'emerald', title: 'The fix is listed in the Longman collocations box (ldoceonline.com).' },
  collocation: { label: 'OZDIC: collocation', tone: 'emerald', title: 'The fix is listed in the Oxford Collocations Dictionary data on OZDIC.' },
  meaning: { label: 'Từ điển: nghĩa', tone: 'sky', title: 'The new word’s dictionary definition matches what the writer means (shown below).' },
  word: { label: 'Có trong từ điển', tone: 'sky', title: 'Spelling / word form: the new word has an entry in Longman or OZDIC.' },
  grammar: { label: 'Không cần tra từ điển', tone: 'sky', title: 'Spelling or grammar: no word partner changes, so no dictionary check is needed.' },
  model: { label: 'AI đề xuất', tone: 'amber', title: 'Not confirmed by OZDIC — the model’s suggestion only.' },
}
const TYPE: Record<WritingFix['type'], string> = {
  spelling: 'Chính tả',
  grammar: 'Ngữ pháp',
  'word form': 'Dạng từ',
  collocation: 'Collocation',
  'word choice': 'Dùng từ sai nghĩa',
  naturalness: 'Chưa tự nhiên',
  confusable: 'Từ dễ nhầm',
  'verb pattern': 'Cấu trúc động từ',
}
const isImprovement = (f: WritingFix) => f.severity === 'improve'

/* ───────────── The essay with changes in place ───────────── */

function Change({ fix }: { fix: WritingFix }) {
  return (
    <span title={fix.explanation} className="cursor-help">
      <del className="text-slate-400 decoration-rose-400 decoration-2 dark:text-slate-500">{fix.original}</del>{' '}
      <ins
        className={cn('font-medium no-underline', isImprovement(fix) ? 'text-violet-600 dark:text-violet-400' : 'text-brand-600 dark:text-brand-400')}
      >
        {fix.replacement}
      </ins>
    </span>
  )
}

/** Word diff, for sentences whose fixes cannot be placed one by one (older reviews rewrote whole sentences). */
function Diff({ from, to }: { from: string; to: string }) {
  return (
    <>
      {diffWords(from, to).map((part, i) =>
        part.added ? (
          <ins key={i} className="font-medium text-brand-600 no-underline dark:text-brand-400">
            {part.value}
          </ins>
        ) : part.removed ? (
          <del key={i} className="text-slate-400 decoration-rose-400 decoration-2">
            {part.value}
          </del>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </>
  )
}

/** One sentence with its fixes marked where they are; falls back to a word diff when a fix cannot be found. */
function MarkedSentence({ sentence, corrected, fixes }: { sentence: string; corrected: string; fixes: WritingFix[] }) {
  const lower = sentence.toLowerCase()
  const placed: { at: number; fix: WritingFix }[] = []
  for (const fix of fixes) {
    const last = placed.at(-1)
    const at = lower.indexOf(fix.original.toLowerCase(), last ? last.at + last.fix.original.length : 0)
    if (at < 0) return <Diff from={sentence} to={corrected} />
    placed.push({ at, fix })
  }
  const parts: ReactNode[] = []
  let cursor = 0
  placed.forEach(({ at, fix }, i) => {
    parts.push(sentence.slice(cursor, at), <Change key={i} fix={fix} />)
    cursor = at + fix.original.length
  })
  parts.push(sentence.slice(cursor))
  return <>{parts}</>
}

/** Sentences grouped back into the writer's paragraphs. */
function paragraphs<T>(items: T[], starts: number[] = []): T[][] {
  const out: T[][] = [[]]
  items.forEach((item, i) => {
    if (i && starts.includes(i)) out.push([])
    out.at(-1)!.push(item)
  })
  return out
}

function MarkedEssay({ result }: { result: WritingReviewResult }) {
  const fixesOf = (i: number) => result.fixes.filter((f) => f.sentenceIndex === i)
  const indexed = result.sentences.map((s, i) => ({ s, i }))
  return (
    <div className="space-y-4 text-[15px] leading-8 text-slate-800 dark:text-slate-100">
      {paragraphs(indexed, result.paragraphStarts).map((para, p) => (
        <p key={p}>
          {para.map(({ s, i }) => (
            <span key={i}>
              <MarkedSentence sentence={s} corrected={result.correctedSentences[i] ?? s} fixes={fixesOf(i)} />{' '}
            </span>
          ))}
        </p>
      ))}
    </div>
  )
}

/* ───────────── Tab: detailed fixes ───────────── */

function SourceLinks({ fix }: { fix: WritingFix }) {
  const links = fix.sources ?? (fix.word ? [{ name: 'OZDIC' as const, url: ozdicUrl(fix.word) }] : [])
  if (!links.length) return null
  return (
    <span className="flex flex-wrap gap-3">
      {links.map((s) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
        >
          {s.name}: {fix.word} <ExternalLink className="size-3" />
        </a>
      ))}
    </span>
  )
}

function FixCard({ fix, n }: { fix: WritingFix; n: number }) {
  const evidence = EVIDENCE[fix.evidence]
  return (
    <li className="flex gap-3 border-b border-slate-100 py-3 last:border-b-0 dark:border-slate-800">
      <span
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
          isImprovement(fix)
            ? 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'
            : 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300',
        )}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="text-[15px]">
            <del className="text-slate-400 decoration-rose-400 decoration-2">{fix.original}</del>
            <span className="mx-2 text-slate-400">→</span>
            <span className={cn('font-semibold', isImprovement(fix) ? 'text-violet-700 dark:text-violet-300' : 'text-brand-700 dark:text-brand-300')}>
              {fix.replacement}
            </span>
          </p>
          <Badge tone="slate">{TYPE[fix.type]}</Badge>
          <Badge tone={evidence.tone} title={evidence.title}>
            {fix.evidence === 'model' ? <TriangleAlert className="size-3" /> : <ShieldCheck className="size-3" />}
            {evidence.label}
          </Badge>
        </div>
        {fix.explanation ? <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{fix.explanation}</p> : null}
        {fix.dictionary.length ? (
          <ul className="mt-1.5 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            {fix.dictionary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <div className="mt-1.5">
          <SourceLinks fix={fix} />
        </div>
      </div>
    </li>
  )
}

function DetailTab({ result }: { result: WritingReviewResult }) {
  const errors = result.fixes.filter((f) => !isImprovement(f))
  const improvements = result.fixes.filter(isImprovement)
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-1 font-bold text-slate-900 dark:text-white">Lỗi của bạn ({errors.length})</h3>
        {errors.length ? (
          <ol>
            {errors.map((fix, i) => (
              <FixCard key={fix.id} fix={fix} n={i + 1} />
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-500">Không tìm thấy lỗi nào. 🎉</p>
        )}
      </section>
      {improvements.length ? (
        <section>
          <h3 className="mb-1 flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
            <Sparkles className="size-4 text-violet-500" /> Nâng cấp cho mượt ({improvements.length})
          </h3>
          <p className="text-xs text-slate-500">Không sai, nhưng đã đổi sang cách nói tự nhiên, chính xác hơn.</p>
          <ol>
            {improvements.map((fix, i) => (
              <FixCard key={fix.id} fix={fix} n={i + 1} />
            ))}
          </ol>
        </section>
      ) : null}
      {result.upgrades.length ? (
        <section>
          <h3 className="mb-1 font-bold text-slate-900 dark:text-white">Gợi ý nâng cấp (không sửa vào bài)</h3>
          <ul className="space-y-2 text-sm">
            {result.upgrades.map((u, i) => (
              <li key={i}>
                {u.original} → <strong className="text-violet-700 dark:text-violet-300">{u.replacement}</strong> — {u.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {result.warnings.length ? (
        <section className="rounded-xl bg-amber-50/60 px-4 py-3 dark:bg-amber-950/20">
          <h3 className="mb-1 font-bold text-amber-800 dark:text-amber-300">Cần xem lại — chưa sửa vào bài ({result.warnings.length})</h3>
          <ul className="space-y-2 text-sm">
            {result.warnings.map((w, i) => (
              <li key={i}>
                <span className="font-semibold text-amber-700 dark:text-amber-300">{w.phrase}</span>
                {w.suggestion ? <span className="text-slate-500"> → {w.suggestion}</span> : null}
                <p className="text-slate-600 dark:text-slate-300">{w.explanation}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/* ───────────── Tab: the upgraded essay ───────────── */

const TOOL_CONFIG: Record<
  LinearTool,
  {
    label: string
    bracketColor: string
    badgeBg: string
    badgeText: string
    hoverBg: string
    hoverRing: string
  }
> = {
  lead_in: {
    label: 'Lead-in',
    bracketColor: 'text-slate-400 dark:text-slate-500',
    badgeBg: 'bg-slate-700 dark:bg-slate-600',
    badgeText: 'text-white',
    hoverBg: 'bg-slate-100/90 dark:bg-slate-800/80',
    hoverRing: 'ring-1 ring-slate-300 dark:ring-slate-600',
  },
  introduction: {
    label: 'Introduction',
    bracketColor: 'text-sky-500 dark:text-sky-400',
    badgeBg: 'bg-sky-600 dark:bg-sky-500',
    badgeText: 'text-white',
    hoverBg: 'bg-sky-50/90 dark:bg-sky-950/50',
    hoverRing: 'ring-1 ring-sky-300 dark:ring-sky-700',
  },
  answer: {
    label: 'Answer',
    bracketColor: 'text-rose-500 dark:text-rose-400',
    badgeBg: 'bg-rose-600 dark:bg-rose-500',
    badgeText: 'text-white',
    hoverBg: 'bg-rose-50/90 dark:bg-rose-950/50',
    hoverRing: 'ring-1 ring-rose-300 dark:ring-rose-700',
  },
  description: {
    label: 'Description',
    bracketColor: 'text-amber-500 dark:text-amber-400',
    badgeBg: 'bg-amber-600 dark:bg-amber-500',
    badgeText: 'text-white',
    hoverBg: 'bg-amber-50/90 dark:bg-amber-950/50',
    hoverRing: 'ring-1 ring-amber-300 dark:ring-amber-700',
  },
  cause: {
    label: 'Cause',
    bracketColor: 'text-orange-500 dark:text-orange-400',
    badgeBg: 'bg-orange-600 dark:bg-orange-500',
    badgeText: 'text-white',
    hoverBg: 'bg-orange-50/90 dark:bg-orange-950/50',
    hoverRing: 'ring-1 ring-orange-300 dark:ring-orange-700',
  },
  effect: {
    label: 'Effect',
    bracketColor: 'text-teal-600 dark:text-teal-400',
    badgeBg: 'bg-teal-600 dark:bg-teal-500',
    badgeText: 'text-white',
    hoverBg: 'bg-teal-50/90 dark:bg-teal-950/50',
    hoverRing: 'ring-1 ring-teal-300 dark:ring-teal-700',
  },
  example: {
    label: 'Example',
    bracketColor: 'text-indigo-500 dark:text-indigo-400',
    badgeBg: 'bg-indigo-600 dark:bg-indigo-500',
    badgeText: 'text-white',
    hoverBg: 'bg-indigo-50/90 dark:bg-indigo-950/50',
    hoverRing: 'ring-1 ring-indigo-300 dark:ring-indigo-700',
  },
  specify: {
    label: 'Specify',
    bracketColor: 'text-violet-500 dark:text-violet-400',
    badgeBg: 'bg-violet-600 dark:bg-violet-500',
    badgeText: 'text-white',
    hoverBg: 'bg-violet-50/90 dark:bg-violet-950/50',
    hoverRing: 'ring-1 ring-violet-300 dark:ring-violet-700',
  },
  conclusion: {
    label: 'Conclusion',
    bracketColor: 'text-purple-600 dark:text-purple-400',
    badgeBg: 'bg-purple-600 dark:bg-purple-500',
    badgeText: 'text-white',
    hoverBg: 'bg-purple-50/90 dark:bg-purple-950/50',
    hoverRing: 'ring-1 ring-purple-300 dark:ring-purple-700',
  },
}

interface ParagraphSentence {
  index: number
  sentence: AnswerSentence
}

function groupSentencesByParagraphs(
  sentences: AnswerSentence[],
  userEdited?: string,
): ParagraphSentence[][] {
  if (userEdited && userEdited.includes('\n')) {
    const rawParas = userEdited
      .split(/\n\s*\n+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean)
    if (rawParas.length > 1) {
      const result: ParagraphSentence[][] = rawParas.map(() => [])
      let paraIdx = 0
      sentences.forEach((s, idx) => {
        const text = s.segments
          .map((g) => g.text)
          .join('')
          .trim()
          .toLowerCase()
        const snippet = text.slice(0, Math.min(30, text.length))
        for (let p = paraIdx; p < rawParas.length; p++) {
          if (rawParas[p].includes(snippet)) {
            paraIdx = p
            break
          }
        }
        result[paraIdx].push({ index: idx, sentence: s })
      })
      const nonEmpty = result.filter((p) => p.length > 0)
      if (nonEmpty.length > 1) return nonEmpty
    }
  }

  // Auto-detect standard IELTS 4-paragraph structure
  const paragraphs: ParagraphSentence[][] = []
  let current: ParagraphSentence[] = []

  sentences.forEach((s, i) => {
    const text = s.segments
      .map((g) => g.text)
      .join('')
      .trim()
    const isFirst = i === 0

    const isConclusion =
      s.tool === 'conclusion' ||
      /^(in conclusion|to conclude|to sum up|overall|in summary)\b/i.test(text)
    const isBodyTransition =
      /^(on the one hand|on the other hand|firstly|first and foremost|to begin with|in addition|furthermore|moreover|turning to|nevertheless|however|conversely|in contrast|secondly)\b/i.test(
        text,
      )
    const isNewBody = i > 1 && (s.tool === 'lead_in' || isBodyTransition)

    if (!isFirst && (isConclusion || isNewBody)) {
      if (current.length) paragraphs.push(current)
      current = [{ index: i, sentence: s }]
    } else {
      current.push({ index: i, sentence: s })
    }
  })

  if (current.length) paragraphs.push(current)
  return paragraphs
}

function WritingModelAnswer({
  modelEssay,
  reviewId,
  onUpdateResult,
}: {
  modelEssay: WritingModelEssay
  reviewId: string
  onUpdateResult?: (res: WritingReviewResult) => void
}) {
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [viewMode, setViewMode] = useState<'paragraph' | 'list'>('paragraph')
  // Grey "natural" phrases are hidden until asked for: the paragraph stays readable.
  const [showNatural, setShowNatural] = useState(false)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const plain = modelEssay.sentences.map((s) => s.segments.map((seg) => seg.text).join('')).join(' ')
  const isCustomized = Boolean(modelEssay.userEdited || modelEssay.originalAnswer)

  const paragraphs = useMemo(
    () => groupSentencesByParagraphs(modelEssay.sentences, modelEssay.userEdited),
    [modelEssay.sentences, modelEssay.userEdited],
  )

  const formattedParagraphText = useMemo(() => {
    return paragraphs
      .map((p) => p.map((item) => item.sentence.segments.map((seg) => seg.text).join('')).join(' '))
      .join('\n\n')
  }, [paragraphs])

  useEffect(() => {
    setIsEditing(false)
    setDraft(modelEssay.userEdited || formattedParagraphText)
    setSaveError('')
  }, [modelEssay.userEdited, formattedParagraphText])

  const copy = () => {
    const allSegments = modelEssay.sentences.flatMap((s) => s.segments)
    void copyFormatted(allSegments).then(() => {
      navigator.clipboard.writeText(formattedParagraphText).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const handleStartEdit = () => {
    setDraft(modelEssay.userEdited || formattedParagraphText)
    setSaveError('')
    setIsEditing(true)
  }

  const handleAnalyze = async () => {
    if (!draft.trim()) {
      setSaveError('Vui lòng nhập nội dung bài sửa của bạn.')
      return
    }
    setAnalyzing(true)
    setSaveError('')
    try {
      const { result } = await writingReviewApi.analyzeEdit(reviewId, draft)
      onUpdateResult?.(result)
      setIsEditing(false)
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleResetToAI = async () => {
    if (!window.confirm('Khôi phục bài sửa về bản mẫu gốc của AI?')) return
    setAnalyzing(true)
    setSaveError('')
    try {
      const { result } = await writingReviewApi.resetEdit(reviewId)
      onUpdateResult?.(result)
      setIsEditing(false)
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setAnalyzing(false)
    }
  }

  const tools = modelEssay.sentences.map((x) => x.tool)
  const count = plain.split(/\s+/).filter(Boolean).length
  const minTarget = count >= 160 ? 250 : 80
  const maxTarget = count >= 160 ? 320 : 150
  const inRange = count >= minTarget && count <= maxTarget

  const wordCount = plain.trim() ? plain.trim().split(/\s+/).filter(Boolean).length : 0

  return (
    <div className="space-y-4">
      <Section
        icon={isCustomized ? UserCheck : MessageSquareQuote}
        tone={isCustomized ? 'emerald' : 'brand'}
        title={isCustomized ? 'Bài theo ý của bạn (đã định dạng)' : 'Bài nâng cấp theo ý bạn (AI viết mới)'}
        hint={
          isCustomized
            ? `${wordCount} từ · Đã bóc tách cấu trúc Linearthinking & tra từ điển cho bài của bạn`
            : `${wordCount} từ · Viết lại mới hoàn toàn theo ý tiếng Việt bằng phương pháp Linearthinking (chuẩn 270–320 từ)`
        }
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setViewMode('paragraph')}
                title="Xem theo từng đoạn văn chuẩn IELTS"
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                  viewMode === 'paragraph'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                )}
              >
                <AlignLeft className="size-3.5" /> Đoạn văn
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                title="Xem danh sách tách từng dòng"
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                  viewMode === 'list'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                )}
              >
                <List className="size-3.5" /> Tách câu
              </button>
            </div>

            {isCustomized && !isEditing ? (
              <Button size="sm" variant="ghost" onClick={() => void handleResetToAI()} disabled={analyzing} className="text-slate-400 hover:text-rose-600">
                <RotateCcw className="size-3.5" /> Bản gốc AI
              </Button>
            ) : null}
            {!isEditing ? (
              <Button size="sm" variant={isCustomized ? 'outline' : 'primary'} onClick={handleStartEdit} disabled={analyzing}>
                <Edit3 className="size-4" /> {isCustomized ? 'Sửa bài của bạn' : 'Tùy chỉnh theo ý bạn'}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        }
      >
        {modelEssay.meaning ? (
          <ThinkInEnglish className="mb-4" meaning={modelEssay.meaning} title="AI diễn lại dàn ý bằng tiếng Anh trước khi viết." />
        ) : null}

        <div className="mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-2">
          {tools.map((tool, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i ? <span className="text-slate-300 dark:text-slate-600">→</span> : null}
              <Badge tone={TOOL[tool]?.tone ?? 'slate'}>{TOOL[tool]?.label ?? tool}</Badge>
            </span>
          ))}
          <span
            className={cn(
              'ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums',
              inRange
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
            )}
            title={`Chuẩn IELTS Writing: ${minTarget}–${maxTarget} từ`}
          >
            {count} từ · chuẩn {minTarget}–{maxTarget}
          </span>
        </div>

        {viewMode === 'paragraph' ? (
          <div className="space-y-4 sm:space-y-5 rounded-2xl border border-slate-200/90 bg-white p-4.5 pt-5 sm:p-6 sm:pt-7 shadow-xs dark:border-slate-800 dark:bg-slate-900/90">
            {paragraphs.map((paragraph, pIdx) => (
              <p
                key={pIdx}
                className="relative text-[14.5px] sm:text-[15px] leading-[1.95] text-slate-800 dark:text-slate-100"
              >
                {paragraph.map(({ index, sentence }) => {
                  const isHovered = hoveredIndex === index
                  const config = TOOL_CONFIG[sentence.tool] ?? TOOL_CONFIG.description

                  return (
                    <span
                      key={index}
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      onClick={() => setHoveredIndex(hoveredIndex === index ? null : index)}
                      className={cn(
                        'relative inline rounded-[4px] px-1 py-0.5 transition-colors duration-150 cursor-pointer',
                        isHovered
                          ? `${config.hoverBg} ${config.hoverRing}`
                          : 'hover:bg-slate-100/60 dark:hover:bg-slate-800/40',
                      )}
                    >
                      {/* Floating Tool Badge above opening bracket when hovered */}
                      {isHovered && (
                        <span
                          className={cn(
                            'pointer-events-none absolute -top-5 left-0 z-30 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold shadow-md whitespace-nowrap tracking-wide animate-in fade-in zoom-in-95 duration-100',
                            config.badgeBg,
                            config.badgeText,
                          )}
                        >
                          {config.label}
                        </span>
                      )}

                      {/* Opening Bracket [ with tool-specific color */}
                      <span
                        className={cn(
                          'inline-flex items-center font-mono font-bold text-xs mr-0.5 select-none transition-transform',
                          config.bracketColor,
                          isHovered && 'scale-110',
                        )}
                        title={`Câu ${index + 1}: ${config.label}`}
                      >
                        [
                      </span>

                      {/* Sentence Segments */}
                      <Segments segments={sentence.segments} hideNatural={!showNatural} />
                      <span className="select-none"> </span>
                    </span>
                  )
                })}
              </p>
            ))}
          </div>
        ) : (
          <ol className="divide-y divide-slate-100 rounded-xl bg-slate-50/80 px-4 dark:divide-slate-800 dark:bg-slate-800/40">
            {modelEssay.sentences.map((sentence, i) => (
              <li key={i} className="flex items-baseline gap-3 py-3">
                <Badge tone={TOOL[sentence.tool]?.tone ?? 'slate'} className="w-[6.5rem] shrink-0 justify-center">
                  {TOOL[sentence.tool]?.label ?? sentence.tool}
                </Badge>
                <span className="text-[14.5px] sm:text-[15px] leading-7 text-slate-900 dark:text-slate-100">
                  <Segments segments={sentence.segments} hideNatural={!showNatural} />
                </span>
              </li>
            ))}
          </ol>
        )}

        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
          💡 Rê chuột (hoặc chạm) vào câu bất kỳ để xem chức năng Linearthinking (Lead-in, Introduction, Effect...).
        </p>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className={MARK.structure}>cấu trúc Linearthinking</span>
          <span className={MARK.library}>cụm thư viện</span>
          <span className={MARK.extra}>cụm mới</span>
          <span className={MARK.unverified} title="Longman / OZDIC không liệt kê, và AI thấy có thể chưa tự nhiên (rê chuột vào cụm để xem lý do).">
            chưa xác nhận
          </span>
          <span className={MARK.natural} title={NATURAL_HINT}>
            tự nhiên, từ điển chưa liệt kê
          </span>
          <span className={MARK.checked} title="Cụm AI tự viết hoặc bài sửa của bạn, đã có trong Longman / OZDIC.">
            đã tra từ điển
          </span>
          <span className="ml-auto">
            <NaturalToggle shown={showNatural} count={naturalCount(modelEssay.sentences)} onToggle={() => setShowNatural((v) => !v)} />
          </span>
        </div>
      </Section>

      {/* User Editing Section */}
      {isEditing ? (
        <section className="rounded-2xl border-2 border-brand-500/80 bg-white p-4 shadow-sm dark:border-brand-500/60 dark:bg-slate-900 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
                <Edit3 className="size-4" />
              </span>
              <h3 className="font-bold text-slate-900 dark:text-white">Chỉnh sửa bài viết theo ý bạn</h3>
            </div>
            <span className="text-xs text-slate-500 tabular-nums">
              {draft.split(/\s+/).filter(Boolean).length} từ
            </span>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Hệ thống sẽ giữ <strong>nguyên văn 100%</strong> các câu chữ của bạn, tự động bóc tách cấu trúc Linearthinking, tô màu các cụm collocation và đối chiếu từ điển Longman / OZDIC.
          </p>
          <textarea
            rows={6}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={analyzing}
            className="w-full rounded-xl border border-slate-300 bg-slate-50/50 p-3.5 text-[15px] leading-relaxed text-slate-900 shadow-inner focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/15 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:bg-slate-900"
            placeholder="Nhập hoặc sửa lại bài viết theo ý bạn..."
          />
          {saveError ? <p className="mt-2 text-xs text-rose-600">{saveError}</p> : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void handleAnalyze()} loading={analyzing}>
                <Sparkles className="size-4" /> Phân tích &amp; Định dạng lại
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} disabled={analyzing}>
                Huỷ
              </Button>
            </div>
            {isCustomized ? (
              <Button size="sm" variant="ghost" onClick={() => void handleResetToAI()} disabled={analyzing} className="text-slate-400 hover:text-rose-600">
                <RotateCcw className="size-3.5" /> Khôi phục về bản gốc AI
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function UpgradedTab({
  result,
  onUpdateResult,
}: {
  result: WritingReviewResult
  onUpdateResult?: (res: WritingReviewResult) => void
}) {
  const { added, add: addToReview } = useAddToReview()

  if (result.modelEssay) {
    // The phrase lists (after an edit: only the phrases still in the essay), the same the review cards of your recent work use.
    const {
      isCustomized,
      picks: activePicks,
      extras: activeExtras,
      wording: displayWording,
      unusedPicks,
      unusedExtras,
    } = phraseGroups({ ...result.modelEssay, picks: result.modelEssay.picks || [], extras: result.modelEssay.extras || [] })

    return (
      <div className="space-y-6">
        <WritingModelAnswer modelEssay={result.modelEssay} reviewId={result.id} onUpdateResult={onUpdateResult} />

        {result.modelEssay.structures?.length ? (
          <Structures structures={result.modelEssay.structures} />
        ) : null}

        {displayWording.length ? (
          <Wording
            wording={displayWording}
            answer={{
              answer: result.modelEssay.sentences.flatMap((s) => s.segments),
              sentences: result.modelEssay.sentences,
            } as any}
            isCustomized={isCustomized}
          />
        ) : null}

        {activePicks.length ? (
          <Section
            icon={Library}
            tone="brand"
            title={isCustomized ? 'Cụm từ thư viện dùng trong bài' : 'Cụm từ trong thư viện'}
            count={activePicks.length}
            hint={isCustomized ? 'Các cụm từ thư viện bạn đã dùng trong bài sửa' : 'AI chọn cho bài này — chỗ dùng và câu ví dụ'}
          >
            <ul className="grid gap-3 md:grid-cols-2">
              {activePicks.map((pick) => (
                <PickRow
                  key={pick.cardId}
                  pick={pick}
                  added={added.has(pick.cardId)}
                  onAdd={() => addToReview(pick.cardId)}
                />
              ))}
            </ul>
          </Section>
        ) : null}

        {activeExtras.length ? (
          <Section
            icon={Sparkles}
            tone="violet"
            title={isCustomized ? 'Cụm ngoài thư viện dùng trong bài' : 'Cụm ngoài thư viện'}
            count={activeExtras.length}
            hint={isCustomized ? 'Các cụm từ hay ngoài thư viện bạn đã dùng trong bài sửa' : 'Gợi ý thêm để học, đã tra Longman / OZDIC'}
          >
            <ul className="grid gap-3 md:grid-cols-2">
              {activeExtras.map((extra, i) => (
                <ExtraRow key={i} extra={extra} />
              ))}
            </ul>
          </Section>
        ) : null}

        {isCustomized && (unusedPicks.length > 0 || unusedExtras.length > 0) ? (
          <details className="group rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 p-4 transition">
            <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 select-none flex items-center justify-between">
              <span>Gợi ý AI ban đầu chưa dùng trong bài sửa ({unusedPicks.length + unusedExtras.length})</span>
              <span className="text-[11px] text-slate-400 group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="mt-3 space-y-4 pt-3 border-t border-slate-200/60 dark:border-slate-800/60">
              {unusedPicks.length ? (
                <div>
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Thư viện ({unusedPicks.length})</p>
                  <ul className="grid gap-2.5 md:grid-cols-2">
                    {unusedPicks.map((pick) => (
                      <PickRow
                        key={pick.cardId}
                        pick={pick}
                        added={added.has(pick.cardId)}
                        onAdd={() => addToReview(pick.cardId)}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
              {unusedExtras.length ? (
                <div>
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Ngoài thư viện ({unusedExtras.length})</p>
                  <ul className="grid gap-2.5 md:grid-cols-2">
                    {unusedExtras.map((extra, i) => (
                      <ExtraRow key={i} extra={extra} />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    )
  }

  // Fallback for older reviews without modelEssay
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => void copyFormatted([{ text: result.corrected }])}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Copy className="size-3.5" /> Copy
        </button>
      </div>
      <div className="space-y-4 text-[15px] leading-8 text-slate-800 dark:text-slate-100">
        {result.corrected.split(/\n{2,}/).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
    </div>
  )
}

/* ───────────── Tab: vocabulary ───────────── */

/** The words and combinations the fixes brought in, with the dictionary line that confirms each one. */
function VocabularyTab({ result }: { result: WritingReviewResult }) {
  const seen = new Set<string>()
  const items = result.fixes.filter((f) => {
    // Word knowledge only: grammar and spelling fixes are not vocabulary to learn.
    if (f.evidence === 'grammar' || f.evidence === 'model' || f.type === 'grammar' || f.type === 'spelling') return false
    const key = f.replacement.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (!items.length) return <p className="text-sm text-slate-500">Bài này không có từ vựng mới nào được thay vào.</p>
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((fix) => (
        <li key={fix.id} className="space-y-2 rounded-xl border border-slate-200/80 p-3.5 dark:border-slate-800">
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">{fix.replacement}</p>
            <p className="text-xs text-slate-500">
              thay cho <span className="line-through">{fix.original}</span> · {TYPE[fix.type]}
            </p>
          </div>
          {fix.dictionary[0] ? <p className="text-xs text-slate-600 dark:text-slate-300">{fix.dictionary[0]}</p> : null}
          <div className="pt-0.5">
            <SourceLinks fix={fix} />
          </div>
          <div className="border-t border-slate-100 pt-1 dark:border-slate-800/80">
            <LibraryAddButtons
              phrase={fix.replacement}
              meaning_vi={fix.explanation || fix.replacement}
              example={fix.dictionary[0] || fix.replacement}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ───────────── Tab: suggested phrases ───────────── */

function SuggestedPhrasesTab({ phrases }: { phrases?: WritingSuggestedPhrase[] }) {
  if (!phrases || !phrases.length) {
    return <p className="text-sm text-slate-500">Chưa có cụm từ gợi ý nào cho bài viết này.</p>
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Các cụm collocations đắt giá được AI truy vấn từ kho tham khảo chủ đề (Topic Collocations) phù hợp với ý bài viết của bạn. Bạn có thể bấm thêm vào Vocabulary hoặc Notes để lưu học.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {phrases.map((item) => (
          <li key={item.cardId || item.term} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-2">
              <span className="font-bold text-slate-900 dark:text-white">{item.term}</span>
              <Badge tone="slate">Kho tham khảo</Badge>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">{item.meaning_vi}</p>
            {item.example ? (
              <p className="border-l-2 border-brand-300 pl-2.5 text-xs italic text-slate-600 dark:border-brand-700 dark:text-slate-400">
                {item.example}
              </p>
            ) : null}
            <div className="border-t border-slate-100 pt-1 dark:border-slate-800/80">
              <LibraryAddButtons phrase={item.term} meaning_vi={item.meaning_vi} example={item.example || item.term} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ───────────── The result ───────────── */

type Tab = 'detail' | 'upgraded' | 'suggested' | 'vocab'
const TABS: { value: Tab; label: string; icon: ReactNode }[] = [
  { value: 'detail', label: 'Sửa bài chi tiết', icon: <ListChecks className="size-4" /> },
  { value: 'upgraded', label: 'Bài nâng cấp', icon: <Sparkles className="size-4" /> },
  { value: 'suggested', label: 'Cụm từ gợi ý', icon: <Lightbulb className="size-4" /> },
  { value: 'vocab', label: 'Từ vựng bài sửa', icon: <BookOpen className="size-4" /> },
]

export function ReviewResult({
  result: initialResult,
  onResultChange,
}: {
  result: WritingReviewResult
  onResultChange?: (res: WritingReviewResult) => void
}) {
  const [tab, setTab] = useState<Tab>('detail')
  const [result, setResult] = useState<WritingReviewResult>(initialResult)

  useEffect(() => {
    setResult(initialResult)
  }, [initialResult])

  const handleUpdate = (updated: WritingReviewResult) => {
    setResult(updated)
    onResultChange?.(updated)
  }

  // One panel whose content follows the tab bar under it (nothing else below the bar).
  return (
    <PhraseWorkProvider work={{ kind: 'writing', id: result.id, title: `Writing · ${result.text.replace(/\s+/g, ' ').trim().slice(0, 60)}` }}>
    <div className="animate-fade-in">
      <Card className="p-4 sm:p-7">
        <div className="mb-4 flex justify-end">
          <ExportReport kind="writing" result={result} />
        </div>
        {result.vietnameseText ? (
          <IdeaPanel
            className="mb-6"
            title="Ý tưởng tiếng Việt gốc"
            icon={Languages}
            text={result.vietnameseText}
            formatted={result.vietnameseFormatted}
            source={{ source: 'writing', id: result.id }}
          />
        ) : null}
        <div className="mb-6 empty:hidden">
          <RealUsePanel refPrefix={`writing:${result.id}:`} stamp={`${result.id}|${result.modelEssay?.userEdited ?? ''}`} />
        </div>

        {tab === 'detail' ? (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Bài làm đã chấm</h2>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <del className="text-slate-400 decoration-rose-400 decoration-2">chữ cũ</del>
                <span className="font-medium text-brand-600 dark:text-brand-400">sửa lỗi</span>
                <span className="font-medium text-violet-600 dark:text-violet-400">nâng cấp</span>
                <span>· rê chuột để xem lý do</span>
              </p>
            </div>
            <MarkedEssay result={result} />
            <div className="mt-8 border-t border-slate-100 pt-6 dark:border-slate-800">
              <DetailTab result={result} />
            </div>
          </>
        ) : tab === 'upgraded' ? (
          <>
            <h2 className="mb-2 text-lg font-bold text-slate-900 dark:text-white">Bài nâng cấp</h2>
            <UpgradedTab result={result} onUpdateResult={handleUpdate} />
          </>
        ) : tab === 'suggested' ? (
          <>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">Cụm từ gợi ý từ kho chủ đề</h2>
            <SuggestedPhrasesTab phrases={result.suggestedPhrases} />
            {result.dolHints?.length ? (
              <div className="mt-6">
                <DolHints hints={result.dolHints} />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">Từ vựng trong bài sửa</h2>
            <VocabularyTab result={result} />
          </>
        )}
      </Card>

      <div className="sticky bottom-4 z-10 mt-5 flex justify-center">
        <div
          role="tablist"
          aria-label="Review sections"
          className="inline-flex flex-wrap rounded-2xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
        >
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => {
                setTab(t.value)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                tab === t.value
                  ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
    </PhraseWorkProvider>
  )
}
