// The report as a pdfmake document definition (the server turns it into a PDF file: server/report-pdf.ts). A4, the
// marks in the page's colours, tables with a repeated header row, page numbers. Pure data: no pdfmake import here.
import { MARK_STYLE, type Block, type ReportDoc, type Run } from './model.ts'

type PdfText = { text: string | PdfText[]; [key: string]: unknown }
type Position = { pageNumber: number }
/** What pdfmake tells pageBreakBefore about a laid-out node (`table`: the table itself, its cells with their positions). */
type PdfNodeInfo = { headlineLevel?: number; style?: unknown; startPosition?: Position; table?: { body: { positions?: Position[] }[][] } }

/**
 * The page a table really starts on. pdfmake lays the header row and the first row out as one block (keepWithHeaderRows)
 * and, when the block goes over to the next page, its cells keep the place they were meant for — except a cell with an
 * id, whose first position gets the page it is drawn on: the first row's first cell has one. (Not the header row's: it
 * is drawn again on every page the table runs onto, and its page would be the last of them.)
 */
const tableStart = (t: PdfNodeInfo) => t.table?.body[1]?.[0]?.positions?.[0]?.pageNumber ?? t.startPosition?.pageNumber

/** The id of each table's first-row cell (unique in a document). */
let tables = 0
type PdfNode = Record<string, unknown>

const MUTED = '#64748B'
const BORDER = '#CBD5E1'

/** Marks the text fonts lack (Arial has no ✓): drawn with the symbol font, or swapped for √ when there is none. */
const SYMBOLS = /([✓✔✗✘★☆⚠])/
let symbolFont: string | undefined

/** A run's words, the symbols in the symbol font. */
const words = (t: string): string | PdfText[] =>
  SYMBOLS.test(t) ? t.split(SYMBOLS).filter(Boolean).map((p) => (SYMBOLS.test(p) ? (symbolFont ? { text: p, font: symbolFont } : { text: '√' }) : { text: p })) : t

function text(r: Run): PdfText {
  const style = r.mark ? MARK_STYLE[r.mark] : undefined
  const decoration = r.strike ? 'lineThrough' : style?.underline ? 'underline' : undefined
  return {
    text: words(r.text),
    ...(r.bold || style?.bold ? { bold: true } : {}),
    ...(r.italic || style?.italic ? { italics: true } : {}),
    ...(style ? { color: `#${style.color}` } : {}),
    ...(r.muted ? { color: MUTED, fontSize: 8.5 } : {}),
    ...(decoration ? { decoration } : {}),
    ...(style?.underline && style.underline !== 'single' && !r.strike ? { decorationStyle: style.underline === 'dash' ? 'dashed' : 'dotted' } : {}),
    ...(style?.underline ? { decorationColor: `#${style.color}` } : {}),
  }
}
const texts = (runs: Run[]) => runs.map(text)

function block(b: Block): PdfNode[] {
  switch (b.type) {
    case 'heading':
      return [{ text: b.text, style: `h${b.level}`, headlineLevel: b.level }]
    case 'paragraph':
      return [{ text: texts(b.runs), margin: [0, 0, 0, 6], ...(b.small ? { fontSize: 8.5, color: MUTED } : {}) }]
    case 'list':
      return [{ ul: b.items.map((item) => ({ text: texts(item), margin: [0, 0, 0, 2] })), margin: [0, 0, 0, 6] }]
    case 'legend':
      return [
        {
          text: [
            { text: 'Chú giải: ', color: MUTED },
            ...b.marks.flatMap((m, i) => [...(i ? [{ text: '  ·  ', color: '#94A3B8' }] : []), text({ text: MARK_STYLE[m].label, mark: m })]),
          ],
          fontSize: 8.5,
          margin: [0, 0, 0, 10],
        },
      ]
    case 'table': {
      const total = (b.widths ?? b.columns.map(() => 1)).reduce((s, w) => s + w, 0)
      return [
        {
          table: {
            // The header row repeats on every page, never stands alone at the bottom of one (it goes with the first row),
            // and a row is never cut in two.
            headerRows: 1,
            keepWithHeaderRows: 1,
            dontBreakRows: true,
            widths: (b.widths ?? b.columns.map(() => 1)).map((w) => `${((100 * w) / total).toFixed(2)}%`),
            body: [
              b.columns.map((c) => ({ text: c, bold: true, fillColor: '#F1F5F9' })),
              ...b.rows.map((row, r) => {
                const id = r === 0 ? `table-${++tables}` : undefined
                return row.map((cell, c) => ({ text: cell.length ? texts(cell) : ' ', ...(id && c === 0 ? { id } : {}) }))
              }),
            ],
          },
          layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => BORDER,
            vLineColor: () => BORDER,
            paddingLeft: () => 4,
            paddingRight: () => 4,
            paddingTop: () => 3,
            paddingBottom: () => 3,
          },
          fontSize: 9,
          margin: [0, 2, 0, 10],
        },
      ]
    }
  }
}

/**
 * The pdfmake document definition of the report; `font`: the family name the server registered, `symbols`: a family
 * with ✓ and the like (none: they become √).
 */
export function pdfDefinition(doc: ReportDoc, font: string, symbols?: string): PdfNode {
  symbolFont = symbols
  tables = 0
  return {
    info: { title: doc.title, creator: 'LinearThinking' },
    pageSize: 'A4',
    pageMargins: [48, 48, 48, 56],
    defaultStyle: { font, fontSize: 10.5, lineHeight: 1.3, color: '#0F172A' },
    styles: {
      title: { fontSize: 18, bold: true, margin: [0, 0, 0, 2] },
      meta: { fontSize: 9, color: MUTED, margin: [0, 0, 0, 14] },
      h1: { fontSize: 15, bold: true, margin: [0, 16, 0, 6] },
      h2: { fontSize: 13.5, bold: true, color: '#1E3A8A', margin: [0, 16, 0, 6] },
      h3: { fontSize: 11.5, bold: true, color: '#334155', margin: [0, 10, 0, 4] },
      pageNumber: { alignment: 'center', fontSize: 8, color: '#94A3B8', margin: [0, 20, 0, 0] },
    },
    // A heading never ends a page: it moves to the next one with what follows when nothing but headings follows it on
    // its page — the first thing after it (past other headings) starts on a later page. A table counts where its first
    // row is (the header row goes with it); the page number, "on the page" too, is left out.
    pageBreakBefore: (node: PdfNodeInfo, nodes: { getFollowingNodesOnPage: () => PdfNodeInfo[] }) => {
      if (!node.headlineLevel) return false
      const next = nodes.getFollowingNodesOnPage().find((n) => !n.headlineLevel && n.style !== 'pageNumber')
      return !next || (next.table ? tableStart(next) : next.startPosition?.pageNumber) !== node.startPosition?.pageNumber
    },
    footer: (page: number, pages: number) => ({ text: `${page} / ${pages}`, style: 'pageNumber' }),
    content: [{ text: doc.title, style: 'title' }, { text: doc.meta.join(' · '), style: 'meta' }, ...doc.blocks.flatMap(block)],
  }
}
