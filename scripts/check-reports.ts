// Exports every saved Speaking result and Writing review as a report (all parts on) in Markdown, Word and PDF, and
// looks for format errors: words like "undefined" / "[object Object]", unbalanced Markdown emphasis, table rows with the
// wrong number of cells, a Word file that is not well-formed or loses text, a PDF with a letter its font lacks (a box)
// or that loses text. Writes the files to
// the folder given (default: reports-check/ in the system temp folder) so they can be opened. Usage:
//   node scripts/check-reports.ts [out folder]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { readPdf } from './pdf-text.ts'
import { Packer } from 'docx'
import xmljs from 'xml-js'
import type { SpeakingResult } from '../src/types/speaking.ts'
import type { WritingReviewResult } from '../src/types/writingReview.ts'
import type { ReportDoc } from '../src/features/report/model.ts'
import { SPEAKING_SECTIONS, speakingCollectionReport, speakingReport } from '../src/features/report/speaking-report.ts'
import { WRITING_SECTIONS, writingReport } from '../src/features/report/writing-report.ts'
import { toMarkdown } from '../src/features/report/to-markdown.ts'
import { reportPdf } from '../server/report-pdf.ts'
import { docxDocument } from '../src/features/report/to-docx.ts'

const root = path.join(import.meta.dirname, '..')
const out = process.argv[2] ?? path.join(os.tmpdir(), 'reports-check')
mkdirSync(out, { recursive: true })

const BAD = /\bundefined\b|\[object Object\]|\bNaN\b|\bnull\b/
const problems: string[] = []
const note = (file: string, what: string) => problems.push(`${file}: ${what}`)

/** All the text a report holds, in order (what every format must show). */
const textOf = (doc: ReportDoc) =>
  [
    doc.title,
    ...doc.blocks.flatMap((b) =>
      b.type === 'heading'
        ? [b.text]
        : b.type === 'paragraph'
          ? [b.runs.map((r) => r.text).join('')]
          : b.type === 'list'
            ? b.items.map((i) => i.map((r) => r.text).join(''))
            : b.type === 'table'
              ? [...b.columns, ...b.rows.flatMap((row) => row.map((c) => c.map((r) => r.text).join('')))]
              : [],
    ),
  ].filter(Boolean)
const squash = (t: string) => t.normalize('NFC').replace(/\s+/g, ' ').trim()

function checkMarkdown(file: string, md: string, doc: ReportDoc) {
  if (BAD.test(md)) note(file, `Markdown has ${md.match(BAD)![0]}`)
  const lines = md.split('\n')
  let header = 0
  for (const [n, line] of lines.entries()) {
    // Emphasis markers outside escapes come in pairs on a line.
    const bare = line.replace(/\\[\\`*_[\]<>|~#]/g, '')
    if ((bare.match(/\*\*/g) ?? []).length % 2) note(file, `line ${n + 1}: odd "**"`)
    if ((bare.replace(/\*\*/g, '').match(/\*/g) ?? []).length % 2) note(file, `line ${n + 1}: odd "*"`)
    if ((bare.match(/~~/g) ?? []).length % 2) note(file, `line ${n + 1}: odd "~~"`)
    // An opening marker followed by a space, or a closing one after a space, does not render as emphasis.
    if (/(?:^|[\s(|])\*{1,3}\s|\s\*{1,3}(?=$|[\s,.;:!?)|])/.test(bare.replace(/^\s*- /, ''))) note(file, `line ${n + 1}: space inside an emphasis`)
    // Every row of a table has as many cells as its header.
    if (line.startsWith('|')) {
      const cells = bare.split('|').length - 2
      if (!header) header = cells
      else if (cells !== header) note(file, `line ${n + 1}: ${cells} cells, header has ${header}`)
    } else header = 0
  }
  // Every text of the report is in the Markdown (once escapes and markers are removed).
  // Markers and table pipes go first (unescaped ones only), then escapes: a "*" or "|" in the text itself stays.
  const flat = squash(
    md
      .replace(/^#+ |^- |^> /gm, '')
      .replace(/(?<!\\)(\*\*\*|\*\*|\*|~~)/g, '')
      .replace(/<br>|(?<!\\)\|/g, ' ')
      .replace(/\\([\\`*_[\]<>|~#])/g, '$1'),
  )
  for (const t of textOf(doc)) if (!flat.includes(squash(t.replace(/\n/g, ' ')))) note(file, `Markdown lost "${t.slice(0, 60)}"`)
}

async function checkDocx(file: string, buffer: Buffer, doc: ReportDoc) {
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) return note(file, 'Word file has no document.xml')
  try {
    xmljs.xml2js(xml)
  } catch (error) {
    return note(file, `Word XML is not well-formed: ${(error as Error).message}`)
  }
  if (BAD.test(xml.replace(/<[^>]+>/g, ' '))) note(file, `Word has ${xml.replace(/<[^>]+>/g, ' ').match(BAD)![0]}`)
  const text = squash(
    [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:br\/>|<\/w:p>/g)]
      .map((m) => (m[1] !== undefined ? m[1] : ' '))
      .join('')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&'),
  )
  for (const t of textOf(doc)) if (!text.includes(squash(t.replace(/\n/g, ' ')))) note(file, `Word lost "${t.slice(0, 60)}"`)
  const tables = doc.blocks.filter((b) => b.type === 'table').length
  const found = (xml.match(/<w:tbl>/g) ?? []).length
  if (found !== tables) note(file, `Word has ${found} tables, the report ${tables}`)
}

function checkPdf(file: string, pdf: Buffer, doc: ReportDoc) {
  if (pdf.subarray(0, 5).toString() !== '%PDF-' || !pdf.subarray(-32).toString().includes('%%EOF')) return note(file, 'not a complete PDF')
  const { pages, text, pageTexts, missing } = readPdf(pdf)
  // A page must not end with a heading or a table's header row (they belong with what follows).
  const squeeze = (t: string) => t.normalize('NFC').replace(/\s+/g, '')
  const endings = [
    ...doc.blocks.flatMap((b) => (b.type === 'heading' ? [{ what: 'heading', text: squeeze(b.text) }] : [])),
    ...doc.blocks.flatMap((b) => (b.type === 'table' ? [{ what: 'table header row', text: squeeze(b.columns.join('')) }] : [])),
  ]
  pageTexts.slice(0, -1).forEach((t, i) => {
    const end = squeeze(t).replace(/\d+\/\d+$/, '')
    const orphan = endings.find((e) => end.endsWith(e.text))
    if (orphan) note(file, `page ${i + 1} ends with a ${orphan.what} ("${orphan.text.slice(0, 30)}")`)
  })
  if (!pages) note(file, 'PDF has no page')
  if (missing) note(file, `PDF draws ${missing} letter(s) its font does not have (boxes)`)
  if (BAD.test(text)) note(file, `PDF has ${text.match(BAD)![0]}`)
  // Lines wrap anywhere in a PDF: compared without any spaces.
  // Page numbers ("6 / 8") sit between the lines of a paragraph that runs onto the next page: left out.
  const flat = text
    .normalize('NFC')
    .replace(/\s+/g, '')
    .replace(new RegExp(`\\d+/${pages}`, 'g'), '')
  for (const t of textOf(doc)) {
    const want = t.normalize('NFC').replace(/\s+/g, '')
    if (flat.includes(want)) continue
    // Where it parts from the PDF: the longest start of the text the PDF holds.
    let n = 0
    while (n < want.length && flat.includes(want.slice(0, n + 1))) n++
    const at = flat.indexOf(want.slice(0, n))
    note(file, `PDF lost "${t.slice(0, 40)}…": text "${want.slice(Math.max(0, n - 12), n + 12)}" vs PDF "${flat.slice(Math.max(0, at + n - 12), at + n + 12)}"`)
  }
}

async function check(doc: ReportDoc, name: string) {
  const md = toMarkdown(doc)
  const pdf = await reportPdf(doc)
  const docx = await Packer.toBuffer(await docxDocument(doc))
  writeFileSync(path.join(out, `${name}.md`), md)
  writeFileSync(path.join(out, `${name}.pdf`), pdf)
  writeFileSync(path.join(out, `${name}.docx`), docx)
  checkMarkdown(`${name}.md`, md, doc)
  checkPdf(`${name}.pdf`, pdf, doc)
  await checkDocx(`${name}.docx`, docx, doc)
  return { blocks: doc.blocks.length, tables: doc.blocks.filter((b) => b.type === 'table').length, kb: Math.round(docx.length / 1024) }
}

let count = 0
for (const kind of ['speaking', 'writing-reviews'] as const) {
  const dir = path.join(root, 'progress', kind)
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const result = JSON.parse(readFileSync(path.join(dir, f), 'utf8'))
    const id = f.replace(/\.json$/, '')
    for (const showNatural of [false, true]) {
      const all = new Set((kind === 'speaking' ? SPEAKING_SECTIONS : WRITING_SECTIONS).map((s) => s.key))
      const doc =
        kind === 'speaking'
          ? speakingReport(result as SpeakingResult, (result as SpeakingResult).answers.map((_, i) => i), { sections: all, showNatural })
          : writingReport(result as WritingReviewResult, { sections: all, showNatural })
      const info = await check(doc, `${kind === 'speaking' ? 'speaking' : 'writing'}-${id}${showNatural ? '-natural' : ''}`)
      if (!showNatural) console.log(`${kind.padEnd(15)} ${id.padEnd(18)} ${String(info.blocks).padStart(4)} blocks ${String(info.tables).padStart(3)} tables ${String(info.kb).padStart(4)} KB docx`)
      count++
    }
  }
}
// Topic groups as the history page gathers them (topic + part, several results): one report each, every question.
const groups = new Map<string, SpeakingResult[]>()
for (const f of readdirSync(path.join(root, 'progress', 'speaking')).filter((x) => x.endsWith('.json'))) {
  const r = JSON.parse(readFileSync(path.join(root, 'progress', 'speaking', f), 'utf8')) as SpeakingResult
  const key = `${r.topic.trim().toLowerCase()}|${r.part}`
  groups.set(key, [...(groups.get(key) ?? []), r])
}
for (const [key, results] of groups) {
  if (results.length < 2) continue
  const entries = results.flatMap((result) => result.answers.map((_, index) => ({ result, index })))
  const doc = speakingCollectionReport(entries, { sections: new Set(SPEAKING_SECTIONS.map((s) => s.key)), showNatural: false })
  const info = await check(doc, `speaking-group-${key.replace(/[^a-z0-9]+/g, '-')}`)
  console.log(`speaking group   ${key.padEnd(18)} ${String(info.blocks).padStart(4)} blocks ${String(info.tables).padStart(3)} tables ${String(info.kb).padStart(4)} KB docx`)
  count++
}

console.log(`\n${count} reports × 3 formats in ${out}`)
console.log(problems.length ? `${problems.length} problems:\n${problems.map((p) => `  ${p}`).join('\n')}` : 'No problems found.')
