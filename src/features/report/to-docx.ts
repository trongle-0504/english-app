// The report as a Word document (the docx library, loaded only when a report is exported). A4, 2 cm margins, Arial
// (it has every Vietnamese letter on Windows, macOS, Word Online and Google Docs).
import type { Document as DocxDocument } from 'docx'
import { MARK_STYLE, type Block, type ReportDoc, type Run } from './model.ts'

const FONT = 'Arial'
/** A4 width minus two 2 cm margins, in twips. */
const PAGE_WIDTH = 11906
const MARGIN = 1134
const CONTENT = PAGE_WIDTH - 2 * MARGIN

/** The Word document of the report (a docx `Document`: pack it with `Packer`). */
export async function docxDocument(doc: ReportDoc): Promise<DocxDocument> {
  const d = await import('docx')
  const UNDERLINE = { single: d.UnderlineType.SINGLE, dotted: d.UnderlineType.DOTTED, dash: d.UnderlineType.DASH }

  const textRuns = (r: Run, size?: number) => {
    const style = r.mark ? MARK_STYLE[r.mark] : undefined
    return r.text.split('\n').map(
      (line, i) =>
        new d.TextRun({
          text: line,
          ...(i ? { break: 1 } : {}),
          font: FONT,
          ...(size ? { size } : {}),
          bold: r.bold || style?.bold,
          italics: r.italic || style?.italic,
          strike: r.strike,
          ...(style ? { color: style.color } : {}),
          ...(r.muted ? { color: '64748B', size: 17 } : {}),
          ...(style?.underline ? { underline: { type: UNDERLINE[style.underline], color: style.color } } : {}),
        }),
    )
  }
  const runs = (rs: Run[], size?: number) => rs.flatMap((r) => textRuns(r, size))
  const paragraph = (rs: Run[], options: { size?: number; after?: number } = {}) =>
    new d.Paragraph({ children: runs(rs, options.size), spacing: { after: options.after ?? 120, line: 300 } })

  const cellBorder = { style: d.BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }
  const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder }

  const block = (b: Block) => {
    switch (b.type) {
      case 'heading': {
        const level = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3][b.level - 1]
        return [
          new d.Paragraph({
            heading: level,
            keepNext: true,
            spacing: { before: b.level === 3 ? 200 : 320, after: 100 },
            children: [new d.TextRun({ text: b.text, font: FONT, bold: true, size: [36, 28, 23][b.level - 1], color: ['0F172A', '1E3A8A', '334155'][b.level - 1] })],
          }),
        ]
      }
      case 'paragraph':
        return [paragraph(b.runs, b.small ? { size: 18 } : {})]
      case 'list':
        return b.items.map((item) => new d.Paragraph({ bullet: { level: 0 }, children: runs(item), spacing: { after: 60, line: 300 } }))
      case 'legend':
        return [
          new d.Paragraph({
            spacing: { before: 60, after: 160 },
            children: [
              new d.TextRun({ text: 'Chú giải: ', font: FONT, size: 18, color: '64748B' }),
              ...b.marks.flatMap((m, i) => [
                ...(i ? [new d.TextRun({ text: '  ·  ', font: FONT, size: 18, color: '94A3B8' })] : []),
                ...textRuns({ text: MARK_STYLE[m].label, mark: m }, 18),
              ]),
            ],
          }),
        ]
      case 'table': {
        const total = (b.widths ?? b.columns.map(() => 1)).reduce((s, w) => s + w, 0)
        const widths = (b.widths ?? b.columns.map(() => 1)).map((w) => Math.floor((CONTENT * w) / total))
        const cell = (rs: Run[], i: number, header = false) =>
          new d.TableCell({
            width: { size: widths[i], type: d.WidthType.DXA },
            borders,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            ...(header ? { shading: { type: d.ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' } } : {}),
            // keepNext on the header row: Word never leaves it alone at the bottom of a page.
            children: [new d.Paragraph({ keepNext: header, children: runs(header ? [{ text: rs[0]?.text ?? '', bold: true }] : rs, 19) })],
          })
        return [
          new d.Table({
            width: { size: CONTENT, type: d.WidthType.DXA },
            columnWidths: widths,
            layout: d.TableLayoutType.FIXED,
            rows: [
              new d.TableRow({ tableHeader: true, children: b.columns.map((c, i) => cell([{ text: c }], i, true)) }),
              ...b.rows.map((row) => new d.TableRow({ cantSplit: true, children: row.map((rs, i) => cell(rs, i)) })),
            ],
          }),
          new d.Paragraph({ spacing: { after: 120 }, children: [] }),
        ]
      }
    }
  }

  return new d.Document({
    creator: 'NeuralSymbolic',
    title: doc.title,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [
      {
        properties: { page: { size: { width: PAGE_WIDTH, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
        children: [
          new d.Paragraph({
            heading: d.HeadingLevel.TITLE,
            spacing: { after: 80 },
            children: [new d.TextRun({ text: doc.title, font: FONT, bold: true, size: 36, color: '0F172A' })],
          }),
          new d.Paragraph({ spacing: { after: 240 }, children: [new d.TextRun({ text: doc.meta.join('  ·  '), font: FONT, size: 18, color: '64748B' })] }),
          ...doc.blocks.flatMap(block),
        ],
      },
    ],
  })
}

/** The report as a .docx file (browser). */
export async function toDocxBlob(doc: ReportDoc): Promise<Blob> {
  const { Packer } = await import('docx')
  return Packer.toBlob(await docxDocument(doc))
}
