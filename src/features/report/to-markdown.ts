import { MARK_STYLE, type Block, type MarkKind, type ReportDoc, type Run } from './model.ts'

/** Characters Markdown would read as formatting, escaped. */
const esc = (text: string) => text.replace(/([\\`*_[\]<>|~#])/g, '\\$1')

/** How a mark reads in Markdown (no colours): library phrases bold, new phrases bold italic, unconfirmed italic. */
const MD_LOOK: Partial<Record<MarkKind, { bold?: boolean; italic?: boolean }>> = {
  library: { bold: true },
  extra: { bold: true, italic: true },
  unverified: { italic: true },
}

/** A run with its emphasis around the words only ("** x**" would not render): spaces stay outside the markers. */
function run(r: Run, breakLine: string): string {
  const look = (r.mark && MD_LOOK[r.mark]) || {}
  const bold = r.bold || look.bold
  const italic = r.italic || look.italic
  const open = `${r.strike ? '~~' : ''}${bold && italic ? '***' : bold ? '**' : italic ? '*' : ''}`
  const close = [...open].reverse().join('')
  return r.text
    .split('\n')
    .map((line) => {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(line)!
      return m[2] ? `${m[1]}${open}${esc(m[2])}${close}${m[3]}` : line
    })
    .join(breakLine)
}

const runs = (rs: Run[], breakLine = '  \n') => rs.map((r) => run(r, breakLine)).join('')

function block(b: Block): string {
  switch (b.type) {
    case 'heading':
      return `${'#'.repeat(b.level)} ${esc(b.text)}`
    case 'paragraph':
      return runs(b.runs)
    case 'list':
      return b.items.map((item) => `- ${runs(item, '  \n  ')}`).join('\n')
    case 'table': {
      const cell = (rs: Run[]) => runs(rs, '<br>').replace(/\n/g, ' ') || ' '
      return [
        `| ${b.columns.map(esc).join(' | ')} |`,
        `| ${b.columns.map(() => '---').join(' | ')} |`,
        ...b.rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
      ].join('\n')
    }
    case 'legend': {
      const shown = b.marks.filter((m) => MD_LOOK[m])
      if (!shown.length) return ''
      return `> Chú giải: ${shown.map((m) => run({ text: MARK_STYLE[m].label, mark: m }, ' ')).join(' · ')}`
    }
  }
}

/** The report as Markdown (GitHub-flavoured: tables). */
export function toMarkdown(doc: ReportDoc): string {
  return [`# ${esc(doc.title)}`, doc.meta.map(esc).join(' · '), ...doc.blocks.map(block)].filter(Boolean).join('\n\n') + '\n'
}
