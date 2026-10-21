// The report a learner exports from a Speaking result or a Writing review: one document model, built from the saved
// result by speaking-report.ts / writing-report.ts and written out by to-markdown.ts, to-docx.ts and to-html.ts (print
// → PDF). Pure data and functions: the same code runs in the browser and in scripts/check-reports.ts.
import type { AnswerSegment, AnswerSentence, CheckedWording, FormattedIdea, LinearTool } from '../../types/speaking.ts'

/** How a phrase of a model answer is marked on the page. */
export type MarkKind = NonNullable<AnswerSegment['mark']>

/** A piece of text with its look. */
export interface Run {
  text: string
  mark?: MarkKind
  bold?: boolean
  italic?: boolean
  /** Struck through (a learner's word a fix replaced). */
  strike?: boolean
  /** Grey and a little smaller (a dictionary line under a meaning). */
  muted?: boolean
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  /** `small`: a grey note. */
  | { type: 'paragraph'; runs: Run[]; small?: boolean }
  | { type: 'list'; items: Run[][] }
  /** `widths`: relative column widths. */
  | { type: 'table'; columns: string[]; rows: Run[][][]; widths?: number[] }
  /** Which marks the answer above uses, each shown in its own look. */
  | { type: 'legend'; marks: MarkKind[] }

export interface ReportDoc {
  title: string
  /** Lines under the title: date, part, number of questions. */
  meta: string[]
  blocks: Block[]
  /** Without extension. */
  fileName: string
}

/** A part of the report the learner can leave out. */
export interface SectionOption {
  key: string
  label: string
  defaultOn: boolean
}

/** How each mark looks in every format (the page's own colours). */
export const MARK_STYLE: Record<MarkKind, { label: string; color: string; bold?: boolean; italic?: boolean; underline?: 'single' | 'dotted' | 'dash' }> = {
  structure: { label: 'cấu trúc Linearthinking', color: '047857', bold: true },
  library: { label: 'cụm thư viện', color: '1D4ED8', bold: true, underline: 'single' },
  extra: { label: 'cụm mới', color: '7C3AED', bold: true, italic: true, underline: 'single' },
  unverified: { label: 'chưa xác nhận', color: 'C2410C', italic: true, underline: 'dash' },
  checked: { label: 'đã tra từ điển', color: '1E293B', underline: 'dotted' },
  natural: { label: 'tự nhiên, từ điển chưa liệt kê', color: '475569', underline: 'dash' },
}

/** Linear tools as the guide names them. */
export const TOOL_LABEL: Record<LinearTool, string> = {
  answer: 'Answer',
  description: 'Description',
  cause: 'Cause',
  effect: 'Effect',
  example: 'Example',
  specify: 'Specify',
  lead_in: 'Lead-in',
  introduction: 'Introduction',
  conclusion: 'Conclusion',
}

/* ───────────── Shared builders ───────────── */

export const plain = (text: string): Run[] => (text ? [{ text }] : [])
export const labelled = (label: string, text: string): Run[] => [{ text: `${label}: `, bold: true }, { text }]

export const dateOf = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** A safe file name: letters, digits and dashes. */
export const fileNameOf = (...parts: string[]) =>
  parts
    .join('-')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'report'

/** Segments as runs; "natural" marks become plain text unless shown. */
export function runsOf(segments: AnswerSegment[], showNatural: boolean): Run[] {
  const runs: Run[] = []
  for (const s of segments) {
    const mark = s.mark === 'natural' && !showNatural ? undefined : s.mark
    const last = runs.at(-1)
    if (last && last.mark === mark) last.text += s.text
    else runs.push({ text: s.text, ...(mark ? { mark } : {}) })
  }
  return runs.filter((r) => r.text)
}

/** The marks the runs use, in the legend's order. */
export const marksIn = (runs: Run[]): MarkKind[] => {
  const used = new Set(runs.map((r) => r.mark).filter((m): m is MarkKind => Boolean(m)))
  return (Object.keys(MARK_STYLE) as MarkKind[]).filter((m) => used.has(m))
}

const sentenceText = (s: AnswerSentence) => s.segments.map((g) => g.text).join('').trim()

/** Sentences grouped into paragraphs the way the page does: a new one at a body opener and at the conclusion. */
export function paragraphsOf(sentences: AnswerSentence[]): AnswerSentence[][] {
  const out: AnswerSentence[][] = []
  for (const [i, s] of sentences.entries()) {
    const text = sentenceText(s)
    const conclusion = s.tool === 'conclusion' || /^(in conclusion|to conclude|to sum up|overall|in summary|all in all)\b/i.test(text)
    const body =
      i > 1 &&
      (s.tool === 'lead_in' ||
        /^(on the one hand|on the other hand|firstly|first and foremost|to begin with|turning to|nevertheless|however|conversely|in contrast|secondly)\b/i.test(text))
    if (i && (conclusion || body) && out.at(-1)?.length) out.push([s])
    else if (out.length) out.at(-1)!.push(s)
    else out.push([s])
  }
  return out
}

/** A model answer: paragraphs of marked runs (sentences joined by a space), then the legend of the marks used. */
export function answerBlocks(sentences: AnswerSentence[], showNatural: boolean): Block[] {
  const paragraphs = paragraphsOf(sentences).map((p) =>
    p.flatMap((s, k) => [...(k ? [{ text: ' ' }] : []), ...runsOf(s.segments, showNatural)]),
  )
  const marks = marksIn(paragraphs.flat())
  return [...paragraphs.map((runs): Block => ({ type: 'paragraph', runs })), ...(marks.length ? [{ type: 'legend', marks } as Block] : [])]
}

/** A learner's idea: the AI's layout when there is one, else the text as typed (split at blank lines). */
export function ideaBlocks(text: string, formatted?: FormattedIdea): Block[] {
  const blocks = formatted?.blocks ?? []
  if (!blocks.length) {
    return text
      .split(/\n\s*\n/)
      .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join('\n'))
      .filter(Boolean)
      .map((p): Block => {
        const label = /^([^:.!?\n]{1,60}):\s+([\s\S]+)$/.exec(p)
        return { type: 'paragraph', runs: label ? labelled(label[1], label[2]) : plain(p) }
      })
  }
  const out: Block[] = []
  for (const b of blocks) {
    const runs = b.label ? labelled(b.label, b.text) : plain(b.text)
    if (b.kind === 'heading') out.push({ type: 'paragraph', runs: [{ text: b.text, bold: true }] })
    else if (b.kind === 'bullet') {
      const last = out.at(-1)
      if (last?.type === 'list') last.items.push(runs)
      else out.push({ type: 'list', items: [runs] })
    } else out.push({ type: 'paragraph', runs })
  }
  return out
}

/** "Intro: … → …" outline lines with the label in bold. */
export const outlineBlocks = (meaning: string): Block[] =>
  meaning
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line): Block => {
      const part = /^([^:→]{1,24}):\s*(.*)$/.exec(line)
      return { type: 'paragraph', runs: part ? labelled(part[1], part[2]) : plain(line) }
    })

/** One row per sentence: its number, Linear tool and marked text. */
export const sentenceTable = (sentences: AnswerSentence[], showNatural: boolean): Block => ({
  type: 'table',
  columns: ['#', 'Chức năng', 'Câu'],
  widths: [6, 16, 78],
  rows: sentences.map((s, i) => [plain(String(i + 1)), plain(TOOL_LABEL[s.tool] ?? s.tool), runsOf(s.segments, showNatural)]),
})

/**
 * "**word**" in saved texts (library meanings and examples, some older answers) is the app's own bold: the report
 * shows it bold instead of printing the asterisks. Applied to every run of the report.
 */
function richRuns(runs: Run[]): Run[] {
  const out: Run[] = []
  for (const r of runs) {
    if (!r.text.includes('**')) {
      out.push(r)
      continue
    }
    r.text.split(/\*\*/).forEach((piece, i) => {
      if (piece) out.push({ ...r, text: piece, ...(i % 2 ? { bold: true } : {}) })
    })
  }
  return out
}

/** The report with "**word**" turned into bold everywhere (see richRuns). */
export function finish(doc: ReportDoc): ReportDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((b): Block => {
      switch (b.type) {
        case 'paragraph':
          return { ...b, runs: richRuns(b.runs) }
        case 'list':
          return { ...b, items: b.items.map(richRuns) }
        case 'table':
          return { ...b, rows: b.rows.map((row) => row.map(richRuns)) }
        default:
          return b
      }
    }),
  }
}

/**
 * The checked collocations a dictionary lists (Longman, OZDIC, or DOL for the learner's idea), one row each: the
 * phrase, then its Vietnamese meaning above the dictionary line that confirms it. Natural-but-unlisted and unconfirmed
 * ones are left out. Null when none is listed.
 */
export function collocationTable(wording: CheckedWording[]): Block | null {
  const listed = wording.filter((w) => w.verified)
  if (!listed.length) return null
  return {
    type: 'table',
    columns: ['Cụm', 'Nghĩa · Dòng từ điển'],
    widths: [28, 72],
    rows: listed.map((w) => {
      const meaning = w.meaning_vi?.trim()
      const line = w.dictionary[0]?.trim()
      return [
        [{ text: w.text, bold: true }],
        [...(meaning ? [{ text: meaning }] : []), ...(meaning && line ? [{ text: '\n' }] : []), ...(line ? [{ text: line, muted: true }] : [])],
      ]
    }),
  }
}

/** A dictionary status in words. */
export const statusOf = (w: { verified: boolean; natural?: boolean }) => (w.verified ? 'Longman / OZDIC' : w.natural ? 'Tự nhiên (từ điển chưa liệt kê)' : 'Chưa xác nhận')
