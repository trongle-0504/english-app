// A finished suggestion: one question at a time — the model answer built with the Linearthinking method (sentence by
// sentence with its Linear tool, phrases and the guide's structures marked), the structures it uses, the library
// phrases (with where they fit, an example, and a button to add them to review), and the phrases from outside the
// library with their Longman / OZDIC proof and buttons that add them to Vocabulary or Notes. The question bar at the bottom switches between questions.
import {
  AlignLeft,
  BookOpen,
  BookPlus,
  Check,
  ChevronDown,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FilePlus2,
  Languages,
  Library,
  Lightbulb,
  List,
  Loader2,
  MessageSquareQuote,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  UserCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { formatIdea, type IdeaSource } from '../idea-api'
import { Badge, Button, type Tone } from '@/components/ui'
import { cn } from '@/lib/cn'
import { slugify } from '@/lib/text'
import { loadData, onDataInvalidated } from '@/lib/data'
import type { LookupIndex } from '@/types/content'
import { AdminApiError } from '@/features/admin/api'
import { ExportReport } from '@/features/report/ExportReport'
import {
  ANSWER_WORDS,
  SPEAKING_FUNCTIONS,
  type AnswerSegment,
  type AnswerSentence,
  type CheckedWording,
  type DolHint,
  type FormattedIdea,
  type IdeaBlock,
  type LinearTool,
  type SpeakingAnswer,
  type SpeakingCandidate,
  type SpeakingExtra,
  type SpeakingPart,
  type SpeakingPick,
  type SpeakingResult,
  type UsedStructure,
} from '@/types/speaking'
import { speakingApi } from './api'
import { useAddToReview } from './useAddToReview'
import { phraseGroups, phraseMatchesText } from '../phrase-groups'
import { PhraseReviewButton, PhraseWorkProvider, RealUsePanel } from '../PhraseReview'
import { practiceApi } from '../practice-api'
import { addToLibrary, type LibraryTarget } from '../library-add'

export const MARK: Record<NonNullable<AnswerSegment['mark']>, string> = {
  library: 'font-semibold text-brand-700 underline decoration-brand-300 decoration-2 underline-offset-4 dark:text-brand-300',
  extra: 'font-semibold text-violet-700 underline decoration-violet-300 decoration-2 underline-offset-4 dark:text-violet-300',
  unverified: 'font-semibold text-amber-700 underline decoration-amber-400 decoration-dashed decoration-2 underline-offset-4 dark:text-amber-300',
  structure: 'rounded bg-emerald-50 px-0.5 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  checked: 'cursor-help underline decoration-slate-400 decoration-dotted decoration-2 underline-offset-4',
  natural: 'cursor-help text-slate-600 underline decoration-slate-300 decoration-dashed decoration-1 underline-offset-4 dark:text-slate-300 dark:decoration-slate-600',
}

/** What the grey "natural" mark means. */
export const NATURAL_HINT = 'Longman và OZDIC không liệt kê cụm này, nhưng AI đánh giá đây là cách nói tự nhiên trong câu.'

/** Linear tools as the guide names them, with a colour each. */
export const TOOL: Record<LinearTool, { label: string; tone: Tone }> = {
  answer: { label: 'Answer', tone: 'slate' },
  description: { label: 'Description', tone: 'sky' },
  cause: { label: 'Cause', tone: 'orange' },
  effect: { label: 'Effect', tone: 'teal' },
  example: { label: 'Example', tone: 'indigo' },
  specify: { label: 'Specify', tone: 'violet' },
  lead_in: { label: 'Lead-in', tone: 'slate' },
  introduction: { label: 'Introduction', tone: 'sky' },
  conclusion: { label: 'Conclusion', tone: 'slate' },
}

export const TOOL_CONFIG: Record<
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

export interface ParagraphSentence {
  index: number
  sentence: AnswerSentence
}

export function groupSentencesByParagraphs(
  sentences: AnswerSentence[],
  userEdited?: string,
  part: SpeakingPart = 1,
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

  // Part 1 is short (3-4 sentences) -> always 1 unified paragraph
  if (part === 1) {
    return [sentences.map((s, index) => ({ index, sentence: s }))]
  }

  // Part 3 is typically 4-6 sentences -> keep in 1 paragraph unless explicit conclusion
  if (part === 3 && sentences.length <= 4) {
    return [sentences.map((s, index) => ({ index, sentence: s }))]
  }

  // Auto-detect paragraphs for Part 2 (and longer Part 3)
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
      /^(in conclusion|to conclude|to sum up|all in all|overall|in summary|looking back|to wrap up)\b/i.test(text)

    const isBodyTransition =
      /^(on the one hand|on the other hand|firstly|first and foremost|to begin with|first off|as for|when it comes to|speaking of|in addition|furthermore|moreover|what is more|another thing is|turning to|nevertheless|however|conversely|in contrast|secondly|eventually|at that time|during that period|after that|nowadays)\b/i.test(
        text,
      )

    const isNewBody = i > 1 && (s.tool === 'lead_in' || (s.tool === 'introduction' && i > 2) || isBodyTransition)

    if (!isFirst && (isConclusion || (isNewBody && current.length >= 2))) {
      if (current.length) paragraphs.push(current)
      current = [{ index: i, sentence: s }]
    } else {
      current.push({ index: i, sentence: s })
    }
  })

  if (current.length) paragraphs.push(current)
  return paragraphs
}

/** A model answer's segments, marked; `hideNatural` shows the grey "natural" phrases as plain text. */
export function Segments({ segments, hideNatural = false }: { segments: AnswerSegment[]; hideNatural?: boolean }) {
  return (
    <>
      {segments.map((s, i) =>
        s.mark && !(hideNatural && s.mark === 'natural') ? (
          <span key={i} className={MARK[s.mark]} title={s.note}>
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

/**
 * "Think in English": the learner's idea restated as an outline, one line per part, the part's label ("Intro",
 * "Body 1", "Direct answer") in bold.
 */
export function ThinkInEnglish({ meaning, title, className }: { meaning: string; title: string; className?: string }) {
  const lines = meaning
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-xl border border-sky-200 bg-sky-50/70 px-3.5 py-2.5 text-sm dark:border-sky-900/60 dark:bg-sky-950/30',
        className,
      )}
    >
      <Languages className="mt-0.5 size-4 shrink-0 text-sky-500" />
      <div className="min-w-0 flex-1" title={title}>
        <span className="font-semibold text-sky-800 dark:text-sky-300">Think in English:</span>
        <div className="mt-1 space-y-1 font-normal leading-relaxed text-slate-600 dark:text-slate-300">
          {lines.map((line, i) => {
            const part = /^([^:→]{1,24}):\s*(.*)$/.exec(line)
            return (
              <p key={i}>
                {part ? (
                  <>
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{part[1]}:</span> {part[2]}
                  </>
                ) : (
                  line
                )}
              </p>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** A line written in capitals ("MỞ BÀI: GIỚI THIỆU", "THÂN BÀI: Ý CHÍNH (…)"): a heading of the learner's outline. */
const isHeading = (line: string) => {
  const head = line.replace(/\([^)]*\)/g, '').trim()
  return /\p{L}/u.test(head) && head.length <= 80 && head === head.toLocaleUpperCase('vi')
}

/** One line of the learner's idea: a heading, a "Label: text" line with the label in bold, or plain text. */
function IdeaLine({ line }: { line: string }) {
  if (isHeading(line)) return <p className="pt-1 font-bold tracking-wide text-amber-900 dark:text-amber-200">{line}</p>
  const labelled = /^([^:.!?]{1,60}):\s*([\s\S]*)$/.exec(line)
  if (!labelled) return <p>{line}</p>
  return (
    <p>
      <span className="font-semibold text-slate-800 dark:text-slate-100">{labelled[1]}:</span> {labelled[2]}
    </p>
  )
}

/** The learner's idea as typed, split at blank lines: headings in capitals and the labels before a colon in bold. */
function IdeaAsTyped({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((p) => p.length)
  return (
    <div className="space-y-3">
      {paragraphs.map((lines, i) => (
        <div key={i} className="space-y-1">
          {lines.map((line, k) => (
            <IdeaLine key={k} line={line} />
          ))}
        </div>
      ))}
    </div>
  )
}

const Labelled = ({ block }: { block: IdeaBlock }) => (
  <>
    {block.label ? <span className="font-semibold text-slate-800 dark:text-slate-100">{block.label}:</span> : null}
    {block.label ? ' ' : ''}
    {block.text}
  </>
)

/** The idea as the AI laid it out: headings, paragraphs with bold labels, bullets grouped into lists. */
function IdeaBlocks({ blocks }: { blocks: IdeaBlock[] }) {
  const groups: (IdeaBlock | IdeaBlock[])[] = []
  for (const block of blocks) {
    const last = groups.at(-1)
    if (block.kind === 'bullet' && Array.isArray(last)) last.push(block)
    else groups.push(block.kind === 'bullet' ? [block] : block)
  }
  return (
    <div className="space-y-2.5">
      {groups.map((group, i) =>
        Array.isArray(group) ? (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-amber-500">
            {group.map((block, k) => (
              <li key={k}>
                <Labelled block={block} />
              </li>
            ))}
          </ul>
        ) : group.kind === 'heading' ? (
          <p key={i} className="pt-1 font-bold tracking-wide text-amber-900 dark:text-amber-200">
            {group.text}
          </p>
        ) : (
          <p key={i}>
            <Labelled block={group} />
          </p>
        ),
      )}
    </div>
  )
}

/**
 * A learner's idea (Speaking's "Ý của bạn", Writing Review's Vietnamese text), shared by both pages: folded to one line
 * until opened. Opened, it shows the AI's layout (spelling, punctuation, paragraphs and bold labels fixed; the ideas
 * unchanged), asked for once when an older result has none, with the text as typed one click away.
 */
export function IdeaPanel({
  title,
  icon: Icon,
  text,
  formatted: saved,
  source,
  className,
}: {
  title: string
  icon: LucideIcon
  text: string
  formatted?: FormattedIdea
  /** Where the idea is saved, to lay it out on demand. */
  source?: IdeaSource
  className?: string
}) {
  const [open, setOpen] = useState(false)
  // Laid out on demand for an older result (saved with it on the server, so the next visit has it).
  const [fetched, setFetched] = useState<FormattedIdea>()
  const formatted = saved ?? fetched
  const [loading, setLoading] = useState(false)
  const [asTyped, setAsTyped] = useState(false)
  const [asked, setAsked] = useState(false)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !formatted && source && !asked) {
      setAsked(true)
      setLoading(true)
      formatIdea(source)
        .then(setFetched)
        .catch((error: Error) => console.warn(`Could not lay out the idea: ${error.message}`))
        .finally(() => setLoading(false))
    }
  }

  const blocks = formatted?.blocks ?? []
  const preview = blocks.find((b) => b.kind !== 'heading')?.text ?? text.split('\n').find((l) => l.trim()) ?? ''
  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-sm dark:border-amber-900/60 dark:bg-amber-950/30',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
          <span className="shrink-0 font-semibold text-amber-800 dark:text-amber-300">{title}</span>
          {!open ? <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400">{preview}</span> : <span className="flex-1" />}
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            {open ? 'Thu gọn' : 'Xem'}
            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
          </span>
        </button>
        {open ? (
          <div className="mt-2 font-normal leading-relaxed text-slate-600 dark:text-slate-300">
            {loading ? (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                <Loader2 className="size-3.5 animate-spin" /> AI đang trình bày lại (chỉ sửa chính tả, dấu câu, xuống dòng)…
              </p>
            ) : null}
            {blocks.length && !asTyped ? <IdeaBlocks blocks={blocks} /> : <IdeaAsTyped text={text} />}
            {blocks.length ? (
              <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-slate-400 dark:text-slate-500">
                {asTyped ? 'Nguyên văn bạn đã nhập.' : 'AI đã trình bày lại: chỉ sửa chính tả, dấu câu, xuống dòng và tô đậm, không đổi ý.'}
                <button type="button" onClick={() => setAsTyped((v) => !v)} className="font-medium text-amber-700 hover:underline dark:text-amber-300">
                  {asTyped ? 'Xem bản trình bày' : 'Xem nguyên văn'}
                </button>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Shows or hides the grey "natural" phrases (not listed, judged natural) of a model answer: hidden by default, so the
 * paragraph is not underlined everywhere; unconfirmed and dictionary-checked phrases always show.
 */
export function NaturalToggle({ shown, count, onToggle }: { shown: boolean; count: number; onToggle: () => void }) {
  if (!count) return null
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      title={NATURAL_HINT}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      {shown ? 'Ẩn' : 'Hiện'} cụm tự nhiên ({count})
    </button>
  )
}

/** How many grey "natural" phrases the sentences hold. */
export const naturalCount = (sentences: { segments: AnswerSegment[] }[]) =>
  sentences.reduce((n, s) => n + s.segments.filter((g) => g.mark === 'natural').length, 0)

/* ───────────── Building blocks ───────────── */

export const ICON_TONE: Record<string, string> = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}

/** One part of a result: a titled card with an icon, a count and optional actions. */
export function Section({
  icon: Icon,
  tone = 'brand',
  title,
  count,
  hint,
  actions,
  children,
}: {
  icon: LucideIcon
  tone?: keyof typeof ICON_TONE
  title: string
  count?: number
  hint?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:px-5 sm:py-3.5 xl:flex-row xl:items-center xl:justify-between dark:border-slate-800">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg mt-0.5', ICON_TONE[tone])}>
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
              {title}
              {count !== undefined ? (
                <span className="rounded-full bg-slate-100 px-2 py-px text-xs font-semibold text-slate-600 tabular-nums dark:bg-slate-800 dark:text-slate-300">
                  {count}
                </span>
              ) : null}
            </h3>
            {hint ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-1.5 xl:justify-end">{actions}</div> : null}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}

/** A phrase as a small card (library items, outside phrases, idea vocabulary). */
export const ITEM =
  'space-y-1.5 rounded-xl border border-slate-200 bg-white p-3.5 transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'
export const QUOTE = 'border-l-2 border-brand-300 pl-3 text-[15px] text-slate-800 italic dark:border-brand-700 dark:text-slate-100'
export const SLOT = 'rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300'

/** "**word**" in library examples shown bold. */
const withBold = (text: string) => text.split('**').map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))

/* ───────────── Copy with formatting ───────────── */

/** How each mark looks when pasted into Word / Google Docs (inline styles: what word processors keep). */
const PASTE_STYLE: Record<NonNullable<AnswerSegment['mark']>, string> = {
  structure: 'font-weight:bold;color:#047857',
  library: 'text-decoration:underline;color:#1d4ed8',
  extra: 'font-style:italic;text-decoration:underline;color:#7c3aed',
  unverified: 'font-style:italic;color:#c2410c',
  checked: '',
  natural: '',
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The answer as HTML with each mark styled (Claude's own checked wording stays plain). */
export function answerHtml(paragraphs: ParagraphSentence[][], fallbackSegments: AnswerSegment[]): string {
  if (!paragraphs.length) {
    const body = fallbackSegments
      .map((s) => (s.mark && PASTE_STYLE[s.mark] ? `<span style="${PASTE_STYLE[s.mark]}">${escapeHtml(s.text)}</span>` : escapeHtml(s.text)))
      .join('')
    return `<p style="font-size:12pt;line-height:1.5">${body}</p>`
  }
  return paragraphs
    .map((p) => {
      const body = p
        .map((item) =>
          item.sentence.segments
            .map((s) => (s.mark && PASTE_STYLE[s.mark] ? `<span style="${PASTE_STYLE[s.mark]}">${escapeHtml(s.text)}</span>` : escapeHtml(s.text)))
            .join(''),
        )
        .join(' ')
      return `<p style="font-size:12pt;line-height:1.5;margin-bottom:12pt">${body}</p>`
    })
    .join('')
}

export { phraseMatchesText }

/** Copies the answer formatted (HTML, for Word / Docs) and as plain text (for anything else). */
export async function copyFormatted(
  segments: AnswerSegment[],
  plainTextOverride?: string,
  htmlOverride?: string,
): Promise<void> {
  const plain = plainTextOverride || segments.map((s) => s.text).join('')
  const html = htmlOverride || answerHtml([], segments)
  if (typeof ClipboardItem === 'undefined') return navigator.clipboard.writeText(plain)
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ])
  } catch {
    // Rich copy refused (older browser, permissions): plain text still works.
    await navigator.clipboard.writeText(plain)
  }
}

/** The model answer: grouped by paragraphs with Linearthinking tools, plus user custom revision if edited. */
function ModelAnswer({
  answer,
  part,
  onAnalyzeEdit,
  onResetEdit,
}: {
  answer: SpeakingAnswer
  part: SpeakingPart
  onAnalyzeEdit?: (edited: string) => Promise<void>
  onResetEdit?: () => Promise<void>
}) {
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [viewMode, setViewMode] = useState<'paragraph' | 'list'>('paragraph')
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  // Grey "natural" phrases are hidden until asked for: the paragraph stays readable.
  const [showNatural, setShowNatural] = useState(false)

  const plain = answer.answer.map((s) => s.text).join('')
  const isCustomized = Boolean(answer.userEdited || answer.originalAnswer)

  const paragraphs = useMemo(
    () => groupSentencesByParagraphs(answer.sentences ?? [], answer.userEdited, part),
    [answer.sentences, answer.userEdited, part],
  )

  const formattedParagraphText = useMemo(() => {
    if (!paragraphs.length) return plain
    return paragraphs
      .map((p) => p.map((item) => item.sentence.segments.map((seg) => seg.text).join('')).join(' '))
      .join('\n\n')
  }, [paragraphs, plain])

  useEffect(() => {
    setIsEditing(false)
    setDraft(answer.userEdited || formattedParagraphText)
    setSaveError('')
  }, [answer.userEdited, formattedParagraphText])

  const copy = () => {
    const allSegments = answer.sentences?.length
      ? answer.sentences.flatMap((s) => s.segments)
      : answer.answer
    void copyFormatted(allSegments, formattedParagraphText, answerHtml(paragraphs, allSegments)).then(() => {
      navigator.clipboard.writeText(formattedParagraphText).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const handleStartEdit = () => {
    setDraft(answer.userEdited || formattedParagraphText)
    setSaveError('')
    setIsEditing(true)
  }

  const handleAnalyze = async () => {
    if (!onAnalyzeEdit) return
    if (!draft.trim()) {
      setSaveError('Vui lòng nhập nội dung bài sửa của bạn.')
      return
    }
    setAnalyzing(true)
    setSaveError('')
    try {
      await onAnalyzeEdit(draft)
      setIsEditing(false)
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleResetToAI = async () => {
    if (!onResetEdit) return
    if (!window.confirm('Khôi phục bài sửa về bản mẫu gốc của AI?')) return
    setAnalyzing(true)
    setSaveError('')
    try {
      await onResetEdit()
      setIsEditing(false)
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setAnalyzing(false)
    }
  }

  const tools = answer.sentences?.map((x) => x.tool) ?? []
  const count = plain.split(/\s+/).filter(Boolean).length
  const range = ANSWER_WORDS[part]
  const inRange = count >= range.min && count <= range.max

  return (
    <div className="space-y-4">
      <Section
        icon={isCustomized ? UserCheck : MessageSquareQuote}
        tone={isCustomized ? 'emerald' : 'brand'}
        title={isCustomized ? 'Bài theo ý của bạn (đã định dạng)' : 'Câu trả lời mẫu (AI)'}
        hint={isCustomized ? 'Đã bóc tách cấu trúc Linearthinking & tra từ điển cho bài của bạn' : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {answer.sentences?.length ? (
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
            ) : null}

            {isCustomized && onResetEdit && !isEditing ? (
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
            title={`Chuẩn IELTS Part ${part}: ${range.min}–${range.max} từ`}
          >
            {count} từ · chuẩn {range.min}–{range.max}
          </span>
        </div>
        {answer.sentences?.length ? (
          viewMode === 'paragraph' ? (
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
              {answer.sentences.map((sentence, i) => (
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
          )
        ) : (
          <p className="rounded-xl bg-slate-50/80 px-4 py-3 text-[14.5px] sm:text-[15px] leading-7 whitespace-pre-line text-slate-900 dark:bg-slate-800/40 dark:text-slate-100">
            <Segments segments={answer.answer} hideNatural={!showNatural} />
          </p>
        )}

        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
          💡 Rê chuột (hoặc chạm) vào câu bất kỳ để xem chức năng Linearthinking ({tools.slice(0, 4).map((t) => TOOL[t]?.label ?? t).join(', ')}...).
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
          <span className={MARK.checked} title="Cụm AI tự viết hoặc bài sửa của bạn, đã có trong Longman / OZDIC (rê chuột vào cụm để xem dòng từ điển).">
            đã tra từ điển
          </span>
          <span className="ml-auto">
            <NaturalToggle
              shown={showNatural}
              count={naturalCount(answer.sentences?.length ? answer.sentences : [{ segments: answer.answer }])}
              onToggle={() => setShowNatural((v) => !v)}
            />
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
              <h3 className="font-bold text-slate-900 dark:text-white">Chỉnh sửa bài trả lời theo ý bạn</h3>
            </div>
            <span className="text-xs text-slate-500 tabular-nums">
              {draft.split(/\s+/).filter(Boolean).length} từ
            </span>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Hệ thống sẽ giữ <strong>nguyên văn 100%</strong> các câu chữ của bạn, tự động bóc tách cấu trúc Linearthinking, tô màu các cụm collocation và đối chiếu từ điển Longman / OZDIC.
          </p>
          <textarea
            rows={part === 2 ? 8 : 5}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={analyzing}
            className="w-full rounded-xl border border-slate-300 bg-slate-50/50 p-3.5 text-[15px] leading-relaxed text-slate-900 shadow-inner focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/15 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:bg-slate-900"
            placeholder="Nhập hoặc sửa lại câu trả lời theo ý bạn..."
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


function SourceLinks({ sources }: { sources: { name: string; url: string }[] }) {
  return (
    <>
      {sources.map((x) => (
        <a
          key={x.url}
          href={x.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-500 hover:text-brand-700 dark:hover:text-brand-300"
        >
          {x.name} <ExternalLink className="size-3" />
        </a>
      ))}
    </>
  )
}

/** The guide's structures and markers the answer uses, to learn as frames. */
export function Structures({ structures }: { structures: UsedStructure[] }) {
  const unique = structures.filter(
    (x, i, arr) => arr.findIndex((y) => y.pattern.trim().toLowerCase() === x.pattern.trim().toLowerCase()) === i,
  )

  return (
    <Section icon={Workflow} tone="emerald" title="Cấu trúc Linearthinking" count={unique.length} hint="Khung câu đã dùng, để học thuộc">
      <ul className="space-y-2">
        {unique.map((x, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <Badge tone={TOOL[x.tool].tone} className="w-[6.5rem] justify-center">
              {TOOL[x.tool].label}
            </Badge>
            <code className={SLOT}>{x.pattern}</code>
            {x.fromGuide === false ? (
              <Badge tone="slate" title="AI mở rộng từ cấu trúc trong guide cho hợp câu hỏi và ý tưởng.">
                mở rộng
              </Badge>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** Term, slot, learning state, where it comes from, and the review button. */
function ItemHead({
  term,
  href,
  slot,
  origin,
  learning,
  inReview,
  onAdd,
  isTopicCollocation,
}: {
  term: string
  href?: string
  slot?: string
  origin: string
  learning: boolean
  inReview: boolean
  onAdd: () => void
  isTopicCollocation?: boolean
}) {
  return (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {href ? (
            <Link to={href} className="font-bold text-slate-900 hover:text-brand-700 dark:text-white dark:hover:text-brand-300">
              {term}
            </Link>
          ) : (
            <span className="font-bold text-slate-900 dark:text-white">{term}</span>
          )}
          <p className="text-xs text-slate-400">{origin}</p>
        </div>
        {isTopicCollocation ? (
          <Badge tone="slate" title="Thuộc kho cụm từ chủ đề tham khảo (chưa thêm vào Vocabulary hoặc Notes cá nhân)">
            Kho tham khảo
          </Badge>
        ) : learning ? (
          <Badge tone="amber">Đang học</Badge>
        ) : inReview ? (
          <Badge tone="emerald">
            <Check className="size-3" /> Ôn tập
          </Badge>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            title="Thêm vào ôn tập"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-brand-700 hover:border-brand-300 hover:bg-brand-50 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-brand-950/40"
          >
            <BookPlus className="size-3.5" /> Ôn tập
          </button>
        )}
      </div>
      {slot ? <code className={cn(SLOT, 'inline-block')}>{slot}</code> : null}
    </>
  )
}

export type Target = LibraryTarget
export { addToLibrary }

let cachedLibraryIndex: LookupIndex | null = null
const libraryListeners = new Set<(idx: LookupIndex | null) => void>()

export function useLibraryLookup(): LookupIndex | null {
  const [index, setIndex] = useState<LookupIndex | null>(cachedLibraryIndex)
  useEffect(() => {
    if (!cachedLibraryIndex) {
      loadData<LookupIndex>('lookup.json')
        .then((data) => {
          cachedLibraryIndex = data
          setIndex(data)
        })
        .catch(() => {})
    } else {
      setIndex(cachedLibraryIndex)
    }
    const listener = (data: LookupIndex | null) => setIndex(data)
    libraryListeners.add(listener)
    const unsub = onDataInvalidated((prefix) => {
      if ('lookup.json'.startsWith(prefix)) {
        loadData<LookupIndex>('lookup.json')
          .then((data) => {
            cachedLibraryIndex = data
            libraryListeners.forEach((l) => l(data))
          })
          .catch(() => {})
      }
    })
    return () => {
      libraryListeners.delete(listener)
      unsub()
    }
  }, [])
  return index
}

export function findInLibrary(phrase: string, index: LookupIndex | null) {
  if (!index) return { vocab: null, note: null }
  const clean = phrase.trim().toLowerCase()
  const slug = slugify(clean)

  let vocab: { label: string; href: string } | null = null
  for (const item of index.vocabulary) {
    const itemWord = item.word.word.trim().toLowerCase()
    const itemSlug = slugify(item.word.word)
    if (itemWord === clean || itemSlug === slug || item.word.id === slug) {
      vocab = { label: `Vocabulary › ${item.word.word}`, href: item.href }
      break
    }
  }

  let note: { label: string; href: string } | null = null
  for (const n of index.notes) {
    const titleClean = n.title.trim().toLowerCase()
    const titleSlug = slugify(n.title)
    const idSlug = slugify(n.id)
    if (
      titleClean === clean ||
      titleSlug === slug ||
      idSlug === slug ||
      titleSlug.startsWith(`${slug}-`) ||
      idSlug.startsWith(`${slug}-`) ||
      titleClean.startsWith(`${clean} `) ||
      titleClean.startsWith(`${clean}+`) ||
      clean.replace(/\s+(sth|sb|something|somebody)$/i, '') === titleClean.replace(/\s+(sth|sb|something|somebody)$/i, '')
    ) {
      note = { label: `Notes › ${n.title}`, href: `/notes#${n.id}` }
      break
    }
  }

  return { vocab, note }
}

export function LibraryAddButtons({
  phrase,
  meaning_vi,
  example,
}: {
  phrase: string
  meaning_vi: string
  example: string
}) {
  const libraryIndex = useLibraryLookup()
  const existing = useMemo(() => findInLibrary(phrase, libraryIndex), [phrase, libraryIndex])
  const [busy, setBusy] = useState<Target | null>(null)
  const [localAdded, setLocalAdded] = useState<{ vocab?: { label: string; href: string }; note?: { label: string; href: string } }>({})
  const [justAdded, setJustAdded] = useState<{ label: string; href: string } | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)

  const activeVocab = localAdded.vocab ?? existing.vocab
  const activeNote = localAdded.note ?? existing.note

  const add = async (target: Target) => {
    setBusy(target)
    setMessage(null)
    setJustAdded(null)
    try {
      const payload = { phrase, meaning_vi, example }
      const done = await addToLibrary(target, payload)
      // The phrase uses its new library card from now on (its Speaking & Writing card, if any, is merged into it).
      void practiceApi.libraryAdded([{ term: payload.phrase, cardId: done.cardId }]).catch(() => {})
      setLocalAdded((prev) => ({ ...prev, [target === 'vocabulary' ? 'vocab' : 'note']: done }))
      setJustAdded(done)
    } catch (err) {
      const exists = err instanceof AdminApiError && err.status === 409
      if (exists) {
        setLocalAdded((prev) => ({
          ...prev,
          [target === 'vocabulary' ? 'vocab' : 'note']: {
            label: target === 'vocabulary' ? `Vocabulary › ${phrase}` : `Notes › ${phrase}`,
            href: target === 'vocabulary' ? '/vocabulary' : '/notes',
          },
        }))
      }
      setMessage({ tone: exists ? 'info' : 'error', text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['vocabulary', 'Vocabulary', activeVocab],
            ['note', 'Notes', activeNote],
          ] as const
        ).map(([target, label, inLib]) => {
          if (inLib) {
            return (
              <Link
                key={target}
                to={inLib.href}
                title={`Đã có trong ${inLib.label} · Bấm để xem`}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              >
                <Check className="size-3.5" /> {label}
              </Link>
            )
          }
          return (
            <button
              key={target}
              type="button"
              disabled={busy !== null}
              onClick={() => void add(target)}
              title={`Tạo mục đầy đủ trong ${label} (AI viết từ cụm, nghĩa và ví dụ này). Mục đã có thì không bị ghi đè.`}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-brand-700 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-brand-950/40"
            >
              {busy === target ? <Loader2 className="size-3.5 animate-spin" /> : <FilePlus2 className="size-3.5" />} {label}
            </button>
          )
        })}
        {busy ? <span className="text-xs text-slate-500">Đang tạo mục (khoảng 20–40 giây)…</span> : null}
      </div>
      {justAdded ? (
        <p className="flex flex-wrap items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
          <Check className="size-3.5" /> Đã thêm vào{' '}
          <Link to={justAdded.href} className="font-semibold underline">
            {justAdded.label}
          </Link>{' '}
          · bấm Library sync để dùng trong Speaking ideas.
        </p>
      ) : null}
      {message ? <p className={cn('text-xs', message.tone === 'error' ? 'text-rose-600' : 'text-slate-500')}>{message.text}</p> : null}
    </div>
  )
}

export function PickRow({ pick, added, onAdd }: { pick: SpeakingPick; added: boolean; onAdd: () => void }) {
  const isTopicColloc = Boolean(pick.isTopicCollocation || pick.cardId.startsWith('topic-'))
  return (
    <li className={ITEM}>
      <ItemHead
        term={pick.term}
        href={pick.href}
        slot={pick.slot}
        origin={pick.origin}
        learning={pick.learning}
        inReview={pick.inReview || added}
        onAdd={onAdd}
        isTopicCollocation={isTopicColloc}
      />
      <p className="text-sm text-slate-600 dark:text-slate-300">{pick.meaning_vi}</p>
      <p className="text-sm font-medium text-brand-700 dark:text-brand-300">→ {pick.how}</p>
      <p className={QUOTE}>{pick.example}</p>
      {isTopicColloc ? (
        <>
          <PhraseReviewButton
            term={pick.term}
            group="library"
            meaning_vi={pick.meaning_vi}
            example={pick.example}
            phrase={{ group: 'library', verified: true, dictionary: [], sources: [] }}
          />
          <LibraryAddButtons phrase={pick.term} meaning_vi={pick.meaning_vi} example={pick.example} />
        </>
      ) : null}
    </li>
  )
}

export function WordingRow({ w, example }: { w: CheckedWording; example?: string }) {
  const libraryIndex = useLibraryLookup()
  const existing = useMemo(() => findInLibrary(w.text, libraryIndex), [w.text, libraryIndex])
  const [busy, setBusy] = useState<Target | null>(null)
  const [localAdded, setLocalAdded] = useState<{ vocab?: { label: string; href: string }; note?: { label: string; href: string } }>({})
  const [justAdded, setJustAdded] = useState<{ label: string; href: string } | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)

  const activeVocab = localAdded.vocab ?? existing.vocab
  const activeNote = localAdded.note ?? existing.note

  const add = async (target: Target) => {
    setBusy(target)
    setMessage(null)
    setJustAdded(null)
    try {
      const payload = {
        phrase: w.text,
        meaning_vi: w.meaning_vi || (w.dictionary[0] ? w.dictionary[0] : w.text),
        example: example || w.text,
      }
      const done = await addToLibrary(target, payload)
      // The phrase uses its new library card from now on (its Speaking & Writing card, if any, is merged into it).
      void practiceApi.libraryAdded([{ term: payload.phrase, cardId: done.cardId }]).catch(() => {})
      setLocalAdded((prev) => ({ ...prev, [target === 'vocabulary' ? 'vocab' : 'note']: done }))
      setJustAdded(done)
    } catch (err) {
      const exists = err instanceof AdminApiError && err.status === 409
      if (exists) {
        setLocalAdded((prev) => ({
          ...prev,
          [target === 'vocabulary' ? 'vocab' : 'note']: {
            label: target === 'vocabulary' ? `Vocabulary › ${w.text}` : `Notes › ${w.text}`,
            href: target === 'vocabulary' ? '/vocabulary' : '/notes',
          },
        }))
      }
      setMessage({ tone: exists ? 'info' : 'error', text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className={ITEM}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-slate-900 dark:text-white">{w.text}</span>
        {w.verified ? (
          <Badge tone="emerald" title={w.dictionary.join('\n')}>
            <ShieldCheck className="size-3" /> Longman / OZDIC
          </Badge>
        ) : w.natural ? (
          <Badge tone="slate" title={NATURAL_HINT}>
            <Check className="size-3" /> Tự nhiên
          </Badge>
        ) : (
          <Badge tone="amber" title="Longman và OZDIC không liệt kê cụm này.">
            <TriangleAlert className="size-3" /> Chưa xác nhận
          </Badge>
        )}
        <SourceLinks sources={w.sources} />
      </div>
      {w.meaning_vi ? <p className="text-sm text-slate-600 dark:text-slate-300">{w.meaning_vi}</p> : null}
      {w.original ? (
        <p className="text-xs text-slate-500">
          Đã đổi từ “<span className="line-through decoration-rose-400">{w.original}</span>” (từ điển không liệt kê cách nói này).
        </p>
      ) : null}
      {w.dictionary.length ? <p className="text-xs text-slate-500">{w.dictionary[0]}</p> : null}
      {!w.verified ? (
        w.natural ? (
          <p className="text-xs text-slate-500">{NATURAL_HINT}</p>
        ) : (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Longman và OZDIC không liệt kê cụm này.{w.why ? ` Lưu ý: ${w.why}` : ''}
          </p>
        )
      ) : null}
      {example ? <p className={QUOTE}>{example}</p> : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {w.verified && !w.library ? (
          <PhraseReviewButton
            term={w.text}
            group="wording"
            meaning_vi={w.meaning_vi}
            example={example}
            phrase={{ group: 'wording', verified: true, dictionary: w.dictionary, sources: w.sources }}
          />
        ) : null}
        {(
          [
            ['vocabulary', 'Vocabulary', activeVocab],
            ['note', 'Notes', activeNote],
          ] as const
        ).map(([target, label, inLib]) => {
          if (inLib) {
            return (
              <Link
                key={target}
                to={inLib.href}
                title={`Đã có trong ${inLib.label} · Bấm để xem`}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              >
                <Check className="size-3.5" /> {label}
              </Link>
            )
          }
          return (
            <button
              key={target}
              type="button"
              disabled={busy !== null}
              onClick={() => void add(target)}
              title={`Tạo mục đầy đủ trong ${label} (AI viết từ cụm, nghĩa và ví dụ này). Mục đã có thì không bị ghi đè.`}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-brand-700 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-brand-950/40"
            >
              {busy === target ? <Loader2 className="size-3.5 animate-spin" /> : <FilePlus2 className="size-3.5" />} {label}
            </button>
          )
        })}
        {busy ? <span className="text-xs text-slate-500">Đang tạo mục (khoảng 20–40 giây)…</span> : null}
      </div>
      {justAdded ? (
        <p className="flex flex-wrap items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
          <Check className="size-3.5" /> Đã thêm vào{' '}
          <Link to={justAdded.href} className="font-semibold underline">
            {justAdded.label}
          </Link>{' '}
          · bấm Library sync để dùng trong Speaking ideas.
        </p>
      ) : null}
      {message ? <p className={cn('text-xs', message.tone === 'error' ? 'text-rose-600' : 'text-slate-500')}>{message.text}</p> : null}
    </li>
  )
}

export function Wording({
  wording,
  answer,
  isCustomized,
}: {
  wording: CheckedWording[]
  answer?: SpeakingAnswer
  isCustomized?: boolean
}) {
  const findSentenceFor = (text: string) => {
    if (!answer?.sentences) return undefined
    const clean = text.toLowerCase()
    const match = answer.sentences.find((s) =>
      s.segments
        .map((seg) => seg.text)
        .join('')
        .toLowerCase()
        .includes(clean),
    )
    return match ? match.segments.map((seg) => seg.text).join('') : undefined
  }

  return (
    <Section
      icon={ShieldCheck}
      tone="sky"
      title={isCustomized ? 'Cụm trong bài của bạn, đã tra từ điển' : 'Cụm AI tự viết, đã tra từ điển'}
      count={wording.length}
      hint="Collocation / verb pattern trong bài, đối chiếu Longman & OZDIC"
    >
      <ul className="grid gap-3 md:grid-cols-2">
        {wording.map((w, i) => (
          <WordingRow key={i} w={w} example={findSentenceFor(w.text)} />
        ))}
      </ul>
    </Section>
  )
}

/** The learner's Vietnamese terms and their English in the DOL dictionary — the wording the AI was told to prefer. */
export function DolHints({ hints }: { hints: DolHint[] }) {
  if (!hints.length) return null
  return (
    <Section icon={BookOpen} tone="sky" title="Từ điển DOL (Việt → Anh)" count={hints.length} hint="Cách nói tiếng Anh của các ý tiếng Việt, AI được dặn ưu tiên">
      <ul className="grid gap-3 md:grid-cols-2">
        {hints.map((h) => (
          <li key={h.url} className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm dark:border-slate-800">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0">
                <span className="text-slate-500 dark:text-slate-400">{h.query}</span>
                <span className="mx-1.5 text-slate-400">→</span>
                <span className="font-semibold text-slate-900 dark:text-white">{h.en}</span>
                {h.alt ? <span className="text-slate-500 dark:text-slate-400"> / {h.alt}</span> : null}
                {h.pos ? <span className="ml-1.5 text-xs text-slate-400">({h.pos})</span> : null}
              </p>
              <a
                href={h.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-slate-400 hover:text-brand-600 dark:hover:text-brand-400"
                title="Mở trang từ điển DOL"
              >
                <ExternalLink className="size-3.5" />
              </a>
            </div>
            {h.vi !== h.query ? <p className="mt-0.5 text-xs text-slate-500">Mục từ: {h.vi}</p> : null}
            {h.example?.en ? <p className="mt-1.5 text-slate-600 italic dark:text-slate-300">“{h.example.en}”</p> : null}
            {h.definitionVi ? <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{h.definitionVi}</p> : null}
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function ExtraRow({ extra }: { extra: SpeakingExtra }) {
  const libraryIndex = useLibraryLookup()
  const existing = useMemo(() => findInLibrary(extra.phrase, libraryIndex), [extra.phrase, libraryIndex])
  const [busy, setBusy] = useState<Target | null>(null)
  const [localAdded, setLocalAdded] = useState<{ vocab?: { label: string; href: string }; note?: { label: string; href: string } }>({})
  const [justAdded, setJustAdded] = useState<{ label: string; href: string } | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)

  const activeVocab = localAdded.vocab ?? existing.vocab
  const activeNote = localAdded.note ?? existing.note

  const add = async (target: Target) => {
    setBusy(target)
    setMessage(null)
    setJustAdded(null)
    try {
      const done = await addToLibrary(target, extra)
      // The phrase uses its new library card from now on (its Speaking & Writing card, if any, is merged into it).
      void practiceApi.libraryAdded([{ term: extra.phrase, cardId: done.cardId }]).catch(() => {})
      setLocalAdded((prev) => ({ ...prev, [target === 'vocabulary' ? 'vocab' : 'note']: done }))
      setJustAdded(done)
    } catch (err) {
      const exists = err instanceof AdminApiError && err.status === 409
      if (exists) {
        setLocalAdded((prev) => ({
          ...prev,
          [target === 'vocabulary' ? 'vocab' : 'note']: {
            label: target === 'vocabulary' ? `Vocabulary › ${extra.phrase}` : `Notes › ${extra.phrase}`,
            href: target === 'vocabulary' ? '/vocabulary' : '/notes',
          },
        }))
      }
      setMessage({ tone: exists ? 'info' : 'error', text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }
  return (
    <li className={ITEM}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-slate-900 dark:text-white">{extra.phrase}</span>
        {extra.verified ? (
          <Badge tone="emerald" title={extra.dictionary.join('\n')}>
            <ShieldCheck className="size-3" /> Longman / OZDIC
          </Badge>
        ) : extra.natural ? (
          <Badge tone="slate" title={NATURAL_HINT}>
            <Check className="size-3" /> Tự nhiên
          </Badge>
        ) : (
          <Badge tone="amber" title={`Longman và OZDIC không liệt kê cụm này: chỉ là đề xuất của AI.${extra.why ? ` Lưu ý: ${extra.why}` : ''}`}>
            <TriangleAlert className="size-3" /> Chưa xác nhận
          </Badge>
        )}
        <SourceLinks sources={extra.sources} />
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">{extra.meaning_vi}</p>
      {extra.original ? (
        <p className="text-xs text-slate-500">
          Thay cho “<span className="line-through decoration-rose-400">{extra.original}</span>” — từ điển không liệt kê cách nói đó.
        </p>
      ) : null}
      {extra.dictionary.length ? <p className="text-xs text-slate-500">{extra.dictionary[0]}</p> : null}
      <p className={QUOTE}>{extra.example}</p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {extra.verified || extra.natural ? (
          <PhraseReviewButton
            term={extra.phrase}
            group="extra"
            meaning_vi={extra.meaning_vi}
            example={extra.example}
            phrase={{ group: 'extra', verified: extra.verified, ...(extra.natural ? { natural: true } : {}), dictionary: extra.dictionary, sources: extra.sources }}
          />
        ) : null}
        {(
          [
            ['vocabulary', 'Vocabulary', activeVocab],
            ['note', 'Notes', activeNote],
          ] as const
        ).map(([target, label, inLib]) => {
          if (inLib) {
            return (
              <Link
                key={target}
                to={inLib.href}
                title={`Đã có trong ${inLib.label} · Bấm để xem`}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              >
                <Check className="size-3.5" /> {label}
              </Link>
            )
          }
          return (
            <button
              key={target}
              type="button"
              disabled={busy !== null}
              onClick={() => void add(target)}
              title={`Tạo mục đầy đủ trong ${label} (Gemini viết từ cụm, nghĩa và ví dụ này, AI chọn chủ đề). Mục đã có thì không bị ghi đè.`}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-brand-700 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-brand-950/40"
            >
              {busy === target ? <Loader2 className="size-3.5 animate-spin" /> : <FilePlus2 className="size-3.5" />} {label}
            </button>
          )
        })}
        {busy ? <span className="text-xs text-slate-500">Đang tạo mục (khoảng 20–40 giây)…</span> : null}
      </div>
      {justAdded ? (
        <p className="flex flex-wrap items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
          <Check className="size-3.5" /> Đã thêm vào{' '}
          <Link to={justAdded.href} className="font-semibold underline">
            {justAdded.label}
          </Link>{' '}
          · bấm Library sync để dùng trong Speaking ideas.
        </p>
      ) : null}
      {message ? <p className={cn('text-xs', message.tone === 'error' ? 'text-rose-600' : 'text-slate-500')}>{message.text}</p> : null}
    </li>
  )
}

/* ───────────── Phrases only ───────────── */

const FUNCTION_LABEL = Object.fromEntries(SPEAKING_FUNCTIONS.map((f) => [f.id, f.label])) as Record<string, string>

function CandidateRow({ c, added, onAdd }: { c: SpeakingCandidate; added: boolean; onAdd: () => void }) {
  const isTopicColloc = Boolean(c.isTopicCollocation || c.cardId.startsWith('topic-'))
  return (
    <li className={ITEM}>
      <ItemHead
        term={c.term}
        href={c.href}
        slot={c.slot}
        origin={c.origin}
        learning={c.learning}
        inReview={c.inReview || added}
        onAdd={onAdd}
        isTopicCollocation={isTopicColloc}
      />
      <p className="text-sm text-slate-600 dark:text-slate-300">{c.meaning_vi}</p>
      {c.example ? <p className={QUOTE}>{withBold(c.example)}</p> : null}
      <p className="flex flex-wrap gap-1 pt-0.5">
        {c.functions.map((f) => (
          <span key={f} className="rounded-md bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {FUNCTION_LABEL[f] ?? f}
          </span>
        ))}
      </p>
      {isTopicColloc ? (
        <LibraryAddButtons phrase={c.term} meaning_vi={c.meaning_vi} example={c.example || c.term} />
      ) : null}
    </li>
  )
}

/** The library items found for one question, best match first, filterable by what the answer needs to do. */
function PhrasesView({ answer, added, onAdd }: { answer: SpeakingAnswer; added: Set<string>; onAdd: (id: string) => void }) {
  const [filter, setFilter] = useState('all')
  const candidates = answer.candidates ?? []
  const analysis = answer.analysis
  const shown = filter === 'all' ? candidates : candidates.filter((c) => c.functions.some((f) => f === filter))
  const chip = (value: string, label: string, count: number) => (
    <button
      key={value}
      type="button"
      onClick={() => setFilter(value)}
      className={cn(
        'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
        filter === value
          ? 'bg-brand-600 text-white dark:bg-brand-500'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
      )}
    >
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  )
  const chips = (label: string, values: string[], tone: string) =>
    values.length ? (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-32 shrink-0 text-xs font-semibold text-slate-500">{label}</span>
        {values.map((v) => (
          <span key={v} className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', tone)}>
            {v}
          </span>
        ))}
      </div>
    ) : null
  return (
    <>
      {analysis ? (
        <Section icon={Target} tone="slate" title="Phân tích câu hỏi" hint="AI đọc câu hỏi và ý của bạn">
          <div className="space-y-2">
            {chips(
              'Câu hỏi cần',
              analysis.functions.map((f) => FUNCTION_LABEL[f] ?? f),
              'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300',
            )}
            {chips('Chủ đề', analysis.topics, 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200')}
            {chips('Từ khoá ý của bạn', analysis.ideaKeywords ?? [], 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300')}
            {analysis.keywords.length ? (
              <div className="flex gap-1.5">
                <span className="w-32 shrink-0 text-xs font-semibold text-slate-500">Từ khoá chủ đề</span>
                <span className="text-xs text-slate-500">{analysis.keywords.join(', ')}</span>
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}
      {answer.ideaPhrases?.length ? (
        <Section
          icon={Lightbulb}
          tone="amber"
          title="Từ vựng cho ý của bạn"
          count={answer.ideaPhrases.length}
          hint="AI đề xuất, tra Longman / OZDIC"
        >
          <ul className="grid gap-3 md:grid-cols-2">
            {answer.ideaPhrases.map((extra) => (
              <ExtraRow key={extra.phrase} extra={extra} />
            ))}
          </ul>
        </Section>
      ) : null}
      {answer.dol?.length ? <DolHints hints={answer.dol} /> : null}
      <Section icon={Library} title="Cụm từ trong thư viện" count={candidates.length} hint="Xếp theo độ khớp với câu hỏi và ý của bạn">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {chip('all', 'Tất cả', candidates.length)}
          {(analysis?.functions ?? []).map((f) => chip(f, FUNCTION_LABEL[f] ?? f, candidates.filter((c) => c.functions.some((x) => x === f)).length))}
        </div>
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((c) => (
            <CandidateRow key={c.cardId} c={c} added={added.has(c.cardId)} onAdd={() => onAdd(c.cardId)} />
          ))}
        </ul>
      </Section>
    </>
  )
}

export function QuestionPanel({
  answer,
  part,
  number,
  added,
  onAdd,
  onAnalyzeEdit,
  onResetEdit,
  resultId,
  answerIndex = 0,
}: {
  answer: SpeakingAnswer
  part: SpeakingPart
  /** The saved result and this answer's place in it (to lay out the idea on demand). */
  resultId?: string
  answerIndex?: number
  /** The question's number in its topic (shown as a badge). */
  number?: number
  added: Set<string>
  onAdd: (id: string) => void
  onAnalyzeEdit?: (edited: string) => Promise<void>
  onResetEdit?: () => Promise<void>
}) {
  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex items-start gap-3">
          {number ? (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-base font-bold text-white shadow-sm shadow-brand-600/30 dark:bg-brand-500">
              {number}
            </span>
          ) : null}
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-[0.16em] text-brand-600 uppercase dark:text-brand-400">Part {part}</p>
            <h2 className="text-xl font-bold whitespace-pre-line text-slate-900 sm:text-2xl dark:text-white">{answer.question}</h2>
          </div>
        </div>
        {answer.idea ? (
          <IdeaPanel
            title="Ý của bạn"
            icon={Lightbulb}
            text={answer.idea}
            formatted={answer.ideaFormatted}
            source={resultId ? { source: 'speaking', id: resultId, answerIndex } : undefined}
          />
        ) : null}
        {answer.meaning ? (
          <ThinkInEnglish meaning={answer.meaning} title="AI diễn lại ý bằng tiếng Anh trước khi viết theo dạng dàn ý." />
        ) : null}
        {resultId ? <RealUsePanel refPrefix={`speaking:${resultId}:${answerIndex}`} stamp={answer.userEdited} /> : null}
      </header>
      {answer.candidates ? (
        <PhrasesView key={answer.question} answer={answer} added={added} onAdd={onAdd} />
      ) : (
        <AnswerView
          answer={answer}
          part={part}
          added={added}
          onAdd={onAdd}
          onAnalyzeEdit={onAnalyzeEdit}
          onResetEdit={onResetEdit}
        />
      )}
    </div>
  )
}

/** "Model answer": the answer and its analysis, then the phrases. */
function AnswerView({
  answer,
  part,
  added,
  onAdd,
  onAnalyzeEdit,
  onResetEdit,
}: {
  answer: SpeakingAnswer
  part: SpeakingPart
  added: Set<string>
  onAdd: (id: string) => void
  onAnalyzeEdit?: (edited: string) => Promise<void>
  onResetEdit?: () => Promise<void>
}) {
  // The phrase lists (after an edit: only the phrases still in the text), the same the review cards of your recent work use.
  const { isCustomized, picks: activePicks, extras: activeExtras, wording: displayWording, unusedPicks, unusedExtras } = useMemo(
    () => phraseGroups(answer),
    [answer],
  )

  return (
    <>
      <ModelAnswer answer={answer} part={part} onAnalyzeEdit={onAnalyzeEdit} onResetEdit={onResetEdit} />
      {answer.structures?.length ? <Structures structures={answer.structures} /> : null}
      {displayWording.length ? <Wording wording={displayWording} answer={answer} isCustomized={isCustomized} /> : null}
      {activePicks.length ? (
        <Section
          icon={Library}
          title={isCustomized ? 'Cụm từ thư viện dùng trong bài' : 'Cụm từ trong thư viện'}
          count={activePicks.length}
          hint={isCustomized ? 'Các cụm từ thư viện bạn đã dùng trong bài sửa' : 'AI chọn cho câu này — chỗ dùng và câu ví dụ'}
        >
          <ul className="grid gap-3 md:grid-cols-2">
            {activePicks.map((pick) => (
              <PickRow key={pick.cardId} pick={pick} added={added.has(pick.cardId)} onAdd={() => onAdd(pick.cardId)} />
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
            {activeExtras.map((extra) => (
              <ExtraRow key={extra.phrase} extra={extra} />
            ))}
          </ul>
        </Section>
      ) : null}
      {answer.dol?.length ? <DolHints hints={answer.dol} /> : null}
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
                    <PickRow key={pick.cardId} pick={pick} added={added.has(pick.cardId)} onAdd={() => onAdd(pick.cardId)} />
                  ))}
                </ul>
              </div>
            ) : null}
            {unusedExtras.length ? (
              <div>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Ngoài thư viện ({unusedExtras.length})</p>
                <ul className="grid gap-2.5 md:grid-cols-2">
                  {unusedExtras.map((extra) => (
                    <ExtraRow key={extra.phrase} extra={extra} />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </>
  )
}

export function SuggestionResult({
  result,
  onResultUpdate,
}: {
  result: SpeakingResult
  onResultUpdate?: (updated: SpeakingResult) => void
}) {
  const [index, setIndex] = useState(0)
  const { added, add, error } = useAddToReview()
  const answer = result.answers[Math.min(index, result.answers.length - 1)]
  const go = (i: number) => {
    setIndex(i)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleAnalyzeEdit = async (edited: string) => {
    const qIndex = Math.min(index, result.answers.length - 1)
    const { result: updated } = await speakingApi.analyzeEdit(result.id, qIndex, edited, result.part)
    if (onResultUpdate) onResultUpdate(updated)
  }

  const handleResetEdit = async () => {
    const qIndex = Math.min(index, result.answers.length - 1)
    const { result: updated } = await speakingApi.resetEdit(result.id, qIndex)
    if (onResultUpdate) onResultUpdate(updated)
  }

  return (
    <PhraseWorkProvider work={{ kind: 'speaking', id: result.id, title: `Speaking Part ${result.part} · ${result.topic.trim()}` }}>
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <span className="font-bold text-slate-900 dark:text-white">{result.topic}</span>
        <Badge tone="brand">Part {result.part}</Badge>
        <Badge tone={result.mode === 'phrases' ? 'amber' : 'violet'}>{result.mode === 'phrases' ? 'Phrases only' : 'Model answer'}</Badge>
        <Badge tone={result.engine === 'antigravity' ? 'emerald' : 'indigo'}>
          {result.engine === 'antigravity' ? (result.usage?.model ? `Antigravity · ${result.usage.model}` : 'Antigravity') : 'Claude'}
        </Badge>
        <span className="text-slate-500">
          {result.answers.length} câu hỏi ·{' '}
          {result.mode === 'phrases' ? `${result.candidates} cụm khớp trong thư viện` : `Chọn từ ${result.candidates} cụm trong thư viện`}
        </span>
        <ExportReport kind="speaking" result={result} current={Math.min(index, result.answers.length - 1)} className="ml-auto" />
      </div>
      {answer ? (
        <QuestionPanel
          answer={answer}
          part={result.part}
          number={result.answers.length > 1 ? index + 1 : undefined}
          added={added}
          onAdd={add}
          onAnalyzeEdit={handleAnalyzeEdit}
          onResetEdit={handleResetEdit}
          resultId={result.id}
          answerIndex={index}
        />
      ) : null}
      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
      {result.answers.length > 1 ? (
        <div className="sticky bottom-4 z-10 mt-5 flex justify-center">
          <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <span className="px-2 text-xs font-semibold text-slate-500">Câu hỏi</span>
            <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => go(index - 1)}>
              ←
            </Button>
            {result.answers.map((a, i) => (
              <button
                key={i}
                type="button"
                title={a.question}
                onClick={() => go(i)}
                className={cn(
                  'size-9 rounded-xl text-sm font-semibold tabular-nums transition-colors',
                  i === index
                    ? 'bg-brand-600 text-white dark:bg-brand-500'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                {i + 1}
              </button>
            ))}
            <Button size="sm" variant="ghost" disabled={index === result.answers.length - 1} onClick={() => go(index + 1)}>
              →
            </Button>
          </div>
        </div>
      ) : null}
    </PhraseWorkProvider>
  )
}
