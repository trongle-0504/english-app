import type { WritingReviewResult } from '../../types/writingReview.ts'
import {
  answerBlocks,
  collocationTable,
  dateOf,
  fileNameOf,
  finish,
  ideaBlocks,
  outlineBlocks,
  plain,
  sentenceTable,
  statusOf,
  TOOL_LABEL,
  type Block,
  type ReportDoc,
  type SectionOption,
} from './model.ts'
import type { ReportOptions } from './speaking-report.ts'

/** The parts of a Writing review the learner can export. */
export const WRITING_SECTIONS: SectionOption[] = [
  { key: 'idea', label: 'Ý tưởng tiếng Việt (AI trình bày lại)', defaultOn: true },
  { key: 'essay', label: 'Bài làm của bạn', defaultOn: true },
  { key: 'fixes', label: 'Các lỗi đã sửa (cũ → mới, lý do)', defaultOn: true },
  { key: 'corrected', label: 'Bài đã sửa', defaultOn: false },
  { key: 'think', label: 'Think in English', defaultOn: false },
  { key: 'answer', label: 'Bài nâng cấp (giữ màu cụm, kèm chú giải)', defaultOn: true },
  { key: 'sentences', label: 'Bảng tách câu theo chức năng Linearthinking', defaultOn: false },
  { key: 'picks', label: 'Cụm thư viện: nghĩa, cách dùng, ví dụ', defaultOn: true },
  { key: 'extras', label: 'Cụm mới', defaultOn: true },
  { key: 'wording', label: 'Collocation đã tra (chỉ cụm có trong Longman / OZDIC), kèm nghĩa', defaultOn: true },
  { key: 'structures', label: 'Cấu trúc đã dùng', defaultOn: false },
]

const TYPE_LABEL: Record<string, string> = {
  spelling: 'Chính tả',
  grammar: 'Ngữ pháp',
  'word form': 'Dạng từ',
  collocation: 'Collocation',
  'word choice': 'Chọn từ',
  naturalness: 'Tự nhiên',
  confusable: 'Từ dễ nhầm',
  'verb pattern': 'Cấu trúc động từ',
}

/** Text as paragraphs: one per non-empty line. */
const paragraphs = (text: string): Block[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l): Block => ({ type: 'paragraph', runs: plain(l) }))

/** A Writing review as a report, with the chosen parts. */
export function writingReport(result: WritingReviewResult, options: ReportOptions): ReportDoc {
  const on = (key: string) => options.sections.has(key)
  const essay = result.modelEssay
  const blocks: Block[] = []

  if (on('idea') && result.vietnameseText?.trim()) {
    blocks.push({ type: 'heading', level: 2, text: 'Ý tưởng tiếng Việt' }, ...ideaBlocks(result.vietnameseText, result.vietnameseFormatted))
  }
  if (on('essay')) blocks.push({ type: 'heading', level: 2, text: 'Bài làm của bạn' }, ...paragraphs(result.text))
  if (on('fixes') && result.fixes.length) {
    blocks.push(
      { type: 'heading', level: 2, text: `Các lỗi đã sửa (${result.fixes.length})` },
      {
        type: 'table',
        columns: ['#', 'Cũ', 'Mới', 'Loại', 'Giải thích'],
        widths: [5, 22, 22, 14, 37],
        rows: result.fixes.map((f, i) => [
          plain(String(i + 1)),
          [{ text: f.original, strike: true }],
          [{ text: f.replacement, bold: true }],
          plain(TYPE_LABEL[f.type] ?? f.type),
          plain(f.explanation),
        ]),
      },
    )
  }
  if (on('corrected')) {
    const corrected = result.corrected?.trim() || result.correctedSentences.join(' ')
    if (corrected) blocks.push({ type: 'heading', level: 2, text: 'Bài đã sửa' }, ...paragraphs(corrected))
  }

  if (essay) {
    if (on('think') && essay.meaning?.trim()) blocks.push({ type: 'heading', level: 2, text: 'Think in English' }, ...outlineBlocks(essay.meaning))
    if (on('answer') && essay.sentences.length) {
      blocks.push({ type: 'heading', level: 2, text: essay.userEdited ? 'Bài nâng cấp (bản bạn sửa)' : 'Bài nâng cấp' }, ...answerBlocks(essay.sentences, options.showNatural))
    }
    if (on('sentences') && essay.sentences.length) blocks.push({ type: 'heading', level: 2, text: 'Tách câu theo chức năng' }, sentenceTable(essay.sentences, options.showNatural))
    if (on('picks') && essay.picks.length) {
      blocks.push(
        { type: 'heading', level: 2, text: 'Cụm thư viện' },
        {
          type: 'table',
          columns: ['Cụm', 'Nghĩa', 'Cách dùng', 'Ví dụ'],
          widths: [22, 22, 26, 30],
          rows: essay.picks.map((p) => [[{ text: p.term, bold: true }], plain(p.meaning_vi), plain(p.how), [{ text: p.example, italic: true }]]),
        },
      )
    }
    if (on('extras') && essay.extras.length) {
      blocks.push(
        { type: 'heading', level: 2, text: 'Cụm mới' },
        {
          type: 'table',
          columns: ['Cụm', 'Nghĩa', 'Ví dụ', 'Từ điển'],
          widths: [22, 24, 34, 20],
          rows: essay.extras.map((e) => [[{ text: e.phrase, bold: true }], plain(e.meaning_vi), [{ text: e.example, italic: true }], plain(statusOf(e))]),
        },
      )
    }
    const collocations = on('wording') ? collocationTable(essay.wording) : null
    if (collocations) blocks.push({ type: 'heading', level: 2, text: 'Collocation đã tra (Longman / OZDIC)' }, collocations)
    if (on('structures') && essay.structures.length) {
      blocks.push(
        { type: 'heading', level: 2, text: 'Cấu trúc đã dùng' },
        {
          type: 'table',
          columns: ['Mẫu', 'Trong bài', 'Chức năng'],
          widths: [40, 40, 20],
          rows: essay.structures.map((s) => [plain(s.pattern), [{ text: s.text, italic: true }], plain(TOOL_LABEL[s.tool] ?? s.tool)]),
        },
      )
    }
  }

  return finish({
    title: 'IELTS Writing Task 2: báo cáo bài viết',
    meta: [`Ngày: ${dateOf(result.createdAt)}`, `${result.text.split(/\s+/).filter(Boolean).length} từ`, `${result.fixes.length} lỗi đã sửa`],
    blocks,
    fileName: fileNameOf('writing', dateOf(result.createdAt), result.id),
  })
}
