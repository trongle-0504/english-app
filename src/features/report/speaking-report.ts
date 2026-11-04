import type { SpeakingAnswer, SpeakingResult } from '../../types/speaking.ts'
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

/** The parts of each question the learner can export. */
export const SPEAKING_SECTIONS: SectionOption[] = [
  { key: 'question', label: 'Câu hỏi', defaultOn: true },
  { key: 'idea', label: 'Ý của bạn (AI trình bày lại)', defaultOn: true },
  { key: 'think', label: 'Think in English', defaultOn: true },
  { key: 'answer', label: 'Câu trả lời mẫu (giữ màu cụm, kèm chú giải)', defaultOn: true },
  { key: 'sentences', label: 'Bảng tách câu theo chức năng NeuralSymbolic', defaultOn: false },
  { key: 'picks', label: 'Cụm thư viện: nghĩa, cách dùng, ví dụ', defaultOn: true },
  { key: 'extras', label: 'Cụm mới', defaultOn: true },
  { key: 'wording', label: 'Collocation đã tra (chỉ cụm có trong Longman / OZDIC), kèm nghĩa', defaultOn: true },
  { key: 'structures', label: 'Cấu trúc đã dùng', defaultOn: false },
]

export interface ReportOptions {
  sections: Set<string>
  /** Show the grey "natural" phrases in the model answer. */
  showNatural: boolean
}

/**
 * The question: its first line in bold, a Part 2 cue card's prompts ("You should say:" …) as bullets. A line that only
 * repeats the topic ("PERSON") is left out.
 */
function questionText(question: string, topic: string): Block[] {
  const lines = question
    .split('\n')
    .map((l) => l.trim().replace(/^[-•*]\s*/, ''))
    .filter((l) => l && l.toLowerCase() !== topic.trim().toLowerCase())
  const blocks: Block[] = []
  let bullets = false
  for (const [i, line] of lines.entries()) {
    if (!i) blocks.push({ type: 'paragraph', runs: [{ text: line, bold: true }] })
    else if (bullets) {
      const last = blocks.at(-1)
      if (last?.type === 'list') last.items.push(plain(line))
      else blocks.push({ type: 'list', items: [plain(line)] })
    } else {
      blocks.push({ type: 'paragraph', runs: plain(line) })
      bullets = /you should say/i.test(line)
    }
  }
  return blocks
}

function questionBlocks(a: SpeakingAnswer, n: number, total: number, topic: string, o: ReportOptions): Block[] {
  const on = (key: string) => o.sections.has(key)
  const blocks: Block[] = [{ type: 'heading', level: 2, text: total > 1 ? `Câu ${n}` : on('question') ? 'Câu hỏi' : 'Câu trả lời' }]
  if (on('question')) blocks.push(...questionText(a.question, topic))

  if (on('idea') && a.idea?.trim()) blocks.push({ type: 'heading', level: 3, text: 'Ý của bạn' }, ...ideaBlocks(a.idea, a.ideaFormatted))
  if (on('think') && a.meaning?.trim()) blocks.push({ type: 'heading', level: 3, text: 'Think in English' }, ...outlineBlocks(a.meaning))
  const sentences = a.sentences?.length ? a.sentences : [{ tool: 'answer' as const, segments: a.answer }]
  if (on('answer') && sentences.some((s) => s.segments.length)) {
    blocks.push({ type: 'heading', level: 3, text: a.userEdited ? 'Câu trả lời (bản bạn sửa)' : 'Câu trả lời mẫu' }, ...answerBlocks(sentences, o.showNatural))
  }
  if (on('sentences') && a.sentences?.length) blocks.push({ type: 'heading', level: 3, text: 'Tách câu theo chức năng' }, sentenceTable(a.sentences, o.showNatural))
  if (on('picks') && a.picks.length) {
    blocks.push(
      { type: 'heading', level: 3, text: 'Cụm thư viện' },
      {
        type: 'table',
        columns: ['Cụm', 'Nghĩa', 'Cách dùng', 'Ví dụ'],
        widths: [22, 22, 26, 30],
        rows: a.picks.map((p) => [[{ text: p.term, bold: true }], plain(p.meaning_vi), plain(p.how), [{ text: p.example, italic: true }]]),
      },
    )
  }
  if (on('extras') && a.extras.length) {
    blocks.push(
      { type: 'heading', level: 3, text: 'Cụm mới' },
      {
        type: 'table',
        columns: ['Cụm', 'Nghĩa', 'Ví dụ', 'Từ điển'],
        widths: [22, 24, 34, 20],
        rows: a.extras.map((e) => [[{ text: e.phrase, bold: true }], plain(e.meaning_vi), [{ text: e.example, italic: true }], plain(statusOf(e))]),
      },
    )
  }
  const collocations = on('wording') ? collocationTable(a.wording ?? []) : null
  if (collocations) blocks.push({ type: 'heading', level: 3, text: 'Collocation đã tra (Longman / OZDIC)' }, collocations)
  if (on('structures') && a.structures?.length) {
    blocks.push(
      { type: 'heading', level: 3, text: 'Cấu trúc đã dùng' },
      {
        type: 'table',
        columns: ['Mẫu', 'Trong bài', 'Chức năng'],
        widths: [40, 40, 20],
        rows: a.structures.map((s) => [plain(s.pattern), [{ text: s.text, italic: true }], plain(TOOL_LABEL[s.tool] ?? s.tool)]),
      },
    )
  }
  return blocks
}

/** A Speaking result as a report: the chosen questions (`answers`: their indexes), with the chosen parts. */
export function speakingReport(result: SpeakingResult, answers: number[], options: ReportOptions): ReportDoc {
  const chosen = answers.filter((i) => result.answers[i])
  return finish({
    title: `IELTS Speaking Part ${result.part}: ${result.topic}`,
    meta: [`Ngày: ${dateOf(result.createdAt)}`, `${chosen.length} câu hỏi`],
    blocks: chosen.flatMap((i) => questionBlocks(result.answers[i], i + 1, result.answers.length, result.topic, options)),
    fileName: fileNameOf('speaking', `part${result.part}`, result.topic, chosen.length === 1 && result.answers.length > 1 ? `cau${chosen[0] + 1}` : ''),
  })
}

/**
 * Questions gathered from several results of one topic (the history page's topic group: one result per run), as one
 * report numbered 1…n in the order given. The title takes the topic and part of the first.
 */
export function speakingCollectionReport(entries: { result: SpeakingResult; index: number }[], options: ReportOptions): ReportDoc {
  const chosen = entries.filter((e) => e.result.answers[e.index])
  const first = chosen[0]?.result
  const days = [...new Set(chosen.map((e) => e.result.createdAt.slice(0, 10)))].sort()
  const runs = new Set(chosen.map((e) => e.result.id)).size
  return finish({
    title: first ? `IELTS Speaking Part ${first.part}: ${first.topic}` : 'IELTS Speaking',
    meta: [
      `Ngày: ${days.length > 1 ? `${dateOf(days[0])} – ${dateOf(days.at(-1)!)}` : dateOf(days[0] ?? '')}`,
      `${chosen.length} câu hỏi`,
      ...(runs > 1 ? [`gom từ ${runs} lần gợi ý`] : []),
    ],
    blocks: chosen.flatMap((e, i) => questionBlocks(e.result.answers[e.index], i + 1, chosen.length, e.result.topic, options)),
    fileName: fileNameOf('speaking', `part${first?.part ?? ''}`, first?.topic ?? '', 'tong-hop'),
  })
}
