import { WRITING_TASK1_CRITERIA, type WritingReviewResult, type WritingTask } from '../../types/writingReview.ts'
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
  { key: 'sentences', label: 'Bảng tách câu theo chức năng NeuralSymbolic', defaultOn: false },
  { key: 'picks', label: 'Cụm thư viện: nghĩa, cách dùng, ví dụ', defaultOn: true },
  { key: 'extras', label: 'Cụm mới', defaultOn: true },
  { key: 'wording', label: 'Collocation đã tra (chỉ cụm có trong Longman / OZDIC), kèm nghĩa', defaultOn: true },
  { key: 'structures', label: 'Cấu trúc đã dùng', defaultOn: false },
]

/** The parts of a Writing Task 1 review the learner can export. */
export const WRITING_TASK1_SECTIONS: SectionOption[] = [
  { key: 'prompt', label: 'Đề bài', defaultOn: true },
  { key: 'idea', label: 'Ý tưởng tiếng Việt (AI trình bày lại)', defaultOn: true },
  { key: 'essay', label: 'Bài làm của bạn', defaultOn: true },
  { key: 'score', label: 'Band ước lượng (TA / CC / LR / GRA)', defaultOn: true },
  { key: 'task1', label: 'Overview, đặc điểm chính, số liệu sai, ý tưởng so với biểu đồ', defaultOn: true },
  { key: 'fixes', label: 'Các lỗi đã sửa (cũ → mới, lý do)', defaultOn: true },
  { key: 'corrected', label: 'Bài đã sửa', defaultOn: false },
  { key: 'compare', label: 'So với bài mẫu (từng điểm, thử viết lại)', defaultOn: true },
  { key: 'vocab', label: 'Từ vựng đáng học từ bài mẫu', defaultOn: true },
]

/** The export sections of a review's task (no task = Task 2). */
export const writingSectionsFor = (task?: WritingTask) => (task === 1 ? WRITING_TASK1_SECTIONS : WRITING_SECTIONS)

const OVERVIEW_LABEL = { clear: 'Overview rõ', unclear: 'Overview chưa rõ', missing: 'Thiếu overview' } as const
const AREA_LABEL: Record<string, string> = {
  intro: 'Mở bài',
  overview: 'Overview',
  grouping: 'Cách nhóm số liệu',
  comparison: 'Câu so sánh',
  data: 'Số liệu',
  language: 'Từ ngữ',
}

const bullets = (items: string[]): Block[] => (items.length ? [{ type: 'list', items: items.map((i) => plain(i)) }] : [])

/** The Task 1 parts of a report: band, chart checks, comparison with the model essay, its vocabulary. */
function task1Blocks(result: WritingReviewResult, on: (key: string) => boolean): { score: Block[]; task1: Block[]; compare: Block[]; vocab: Block[] } {
  const score: Block[] = []
  if (on('score') && result.score) {
    const s = result.score
    score.push(
      { type: 'heading', level: 2, text: `Band ước lượng: ${s.overall.toFixed(1)}` },
      {
        type: 'table',
        columns: ['Tiêu chí', 'Band', 'Để lên band tiếp theo'],
        widths: [28, 10, 62],
        rows: WRITING_TASK1_CRITERIA.map((c) => [plain(`${c.label} (${c.short})`), [{ text: String(s.criteria[c.id].band), bold: true }], plain(s.criteria[c.id].summary)]),
      },
    )
  } else if (on('score') && result.scoreSkipped === 'short') {
    score.push({ type: 'heading', level: 2, text: 'Band ước lượng' }, { type: 'paragraph', runs: plain('Bài dưới 150 từ nên không ước lượng band.') })
  }

  const task1: Block[] = []
  const t = result.task1
  if (on('task1') && t) {
    task1.push({ type: 'heading', level: 2, text: 'Overview và đặc điểm chính' })
    if (t.noChart) task1.push({ type: 'paragraph', runs: plain('Chấm khi đề chưa có hình biểu đồ: Task Achievement theo nội dung đề, số liệu không được kiểm tra.'), small: true })
    task1.push({ type: 'paragraph', runs: [{ text: `${OVERVIEW_LABEL[t.overview.status]}: `, bold: true }, ...plain(t.overview.note)] })
    if (t.keyFeatures.covered.length) task1.push({ type: 'paragraph', runs: [{ text: 'Đã nêu', bold: true }] }, ...bullets(t.keyFeatures.covered))
    if (t.keyFeatures.missed.length) task1.push({ type: 'paragraph', runs: [{ text: 'Còn thiếu', bold: true }] }, ...bullets(t.keyFeatures.missed))
    if (t.dataErrors.length) {
      task1.push(
        { type: 'heading', level: 2, text: 'Số liệu sai so với biểu đồ' },
        {
          type: 'table',
          columns: ['Câu', 'Trong bài', 'Bạn viết', 'Biểu đồ'],
          widths: [8, 32, 30, 30],
          rows: t.dataErrors.map((e) => [plain(String(e.sentence + 1)), [{ text: e.quote, italic: true }], plain(e.wrote), plain(e.correct)]),
        },
      )
    }
    if (t.ideaCheck) {
      task1.push({ type: 'heading', level: 2, text: 'Ý tưởng tiếng Việt so với biểu đồ' })
      if (t.ideaCheck.summary) task1.push({ type: 'paragraph', runs: plain(t.ideaCheck.summary) })
      if (t.ideaCheck.matched.length) task1.push({ type: 'paragraph', runs: [{ text: 'Đúng với biểu đồ', bold: true }] }, ...bullets(t.ideaCheck.matched))
      if (t.ideaCheck.wrong.length) task1.push({ type: 'paragraph', runs: [{ text: 'Sai so với biểu đồ', bold: true }] }, ...bullets(t.ideaCheck.wrong))
      if (t.ideaCheck.missing.length) task1.push({ type: 'paragraph', runs: [{ text: 'Còn thiếu', bold: true }] }, ...bullets(t.ideaCheck.missing))
    }
  }

  const compare: Block[] = []
  const lesson = result.task1Model
  if (on('compare') && lesson?.comparison?.points.length) {
    compare.push({ type: 'heading', level: 2, text: 'So với bài mẫu' })
    if (lesson.comparison.summary) compare.push({ type: 'paragraph', runs: plain(lesson.comparison.summary) })
    compare.push({
      type: 'table',
      columns: ['Phần', 'Bài của bạn', 'Bài mẫu', 'Vì sao', 'Thử viết lại'],
      widths: [12, 20, 22, 22, 24],
      rows: lesson.comparison.points.map((p) => [
        plain(AREA_LABEL[p.area] ?? p.area),
        [{ text: p.yours || '—', italic: true }],
        [{ text: p.model, italic: true }],
        plain(p.why),
        [{ text: p.try, bold: true }],
      ]),
    })
  }

  const vocab: Block[] = []
  if (on('vocab') && lesson?.vocab.length) {
    vocab.push(
      { type: 'heading', level: 2, text: 'Từ vựng đáng học từ bài mẫu' },
      {
        type: 'table',
        columns: ['Cụm', 'Nghĩa', 'Ví dụ', 'Từ điển'],
        widths: [22, 22, 36, 20],
        rows: lesson.vocab.map((v) => [
          [{ text: v.phrase, bold: true }],
          plain(v.meaning_vi),
          [{ text: v.example, italic: true }],
          plain(`${v.verified ? 'Longman / OZDIC' : 'chưa xác nhận'}${v.used ? ' · bạn đã dùng' : ''}`),
        ]),
      },
    )
  }
  return { score, task1, compare, vocab }
}

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
  const isTask1 = result.task === 1
  const t1 = isTask1 ? task1Blocks(result, on) : null

  if (isTask1 && on('prompt') && result.prompt?.trim()) blocks.push({ type: 'heading', level: 2, text: 'Đề bài' }, ...paragraphs(result.prompt))
  if (on('idea') && result.vietnameseText?.trim()) {
    blocks.push({ type: 'heading', level: 2, text: 'Ý tưởng tiếng Việt' }, ...ideaBlocks(result.vietnameseText, result.vietnameseFormatted))
  }
  if (on('essay')) blocks.push({ type: 'heading', level: 2, text: 'Bài làm của bạn' }, ...paragraphs(result.text))
  if (t1) blocks.push(...t1.score, ...t1.task1)
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

  if (t1) blocks.push(...t1.compare, ...t1.vocab)

  if (essay && !isTask1) {
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
    title: isTask1 ? 'IELTS Writing Task 1: báo cáo bài viết' : 'IELTS Writing Task 2: báo cáo bài viết',
    meta: [`Ngày: ${dateOf(result.createdAt)}`, `${result.text.split(/\s+/).filter(Boolean).length} từ`, `${result.fixes.length} lỗi đã sửa`],
    blocks,
    fileName: fileNameOf('writing', dateOf(result.createdAt), result.id),
  })
}
