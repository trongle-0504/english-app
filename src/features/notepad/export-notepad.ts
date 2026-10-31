import { dateOf, fileNameOf, type Block, type ReportDoc, type Run } from '@/features/report/model'

/** Parses inline Markdown (**bold**, *italic*, <u>underline</u>) into ReportDoc Run[]. */
export function parseInlineRuns(line: string): Run[] {
  const runs: Run[] = []
  const tokenRe = /(\*\*[\s\S]+?\*\*|\*[^*\n]+?\*|<u>[\s\S]+?<\/u>)/g
  let lastIdx = 0
  for (const m of line.matchAll(tokenRe)) {
    const idx = m.index ?? 0
    if (idx > lastIdx) {
      runs.push({ text: line.slice(lastIdx, idx) })
    }
    const raw = m[0]
    if (raw.startsWith('**') && raw.endsWith('**')) {
      runs.push({ text: raw.slice(2, -2), bold: true })
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      runs.push({ text: raw.slice(1, -1), italic: true })
    } else if (raw.startsWith('<u>') && raw.endsWith('</u>')) {
      runs.push({ text: raw.slice(3, -4), bold: true })
    }
    lastIdx = idx + raw.length
  }
  if (lastIdx < line.length) {
    runs.push({ text: line.slice(lastIdx) })
  }
  return runs.length ? runs : [{ text: line }]
}

/** Converts a free-form Notepad note into a ReportDoc for Word (.docx) and PDF (.pdf) export. */
export function notepadToReportDoc(note: { title: string; content: string; updatedAt?: string }): ReportDoc {
  const title = note.title.trim() || 'Ghi chú Notepad'
  const lines = note.content.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let bulletBuffer: Run[][] = []

  const flushBullets = () => {
    if (bulletBuffer.length > 0) {
      blocks.push({ type: 'list', items: bulletBuffer })
      bulletBuffer = []
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      flushBullets()
      continue
    }

    // Divider ---
    if (/^-{3,}$/.test(line)) {
      flushBullets()
      continue
    }

    // Headings # .. ####
    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line)
    if (headingMatch) {
      flushBullets()
      const hashes = headingMatch[1].length
      const level: 1 | 2 | 3 = hashes === 1 ? 1 : hashes === 2 ? 2 : 3
      const text = headingMatch[2].replace(/\*\*|<u>|<\/u>/g, '').trim()
      if (text) blocks.push({ type: 'heading', level, text })
      continue
    }

    // Bullet item (- or *)
    const bulletMatch = /^[-*•]\s+(.*)$/.exec(line)
    if (bulletMatch) {
      bulletBuffer.push(parseInlineRuns(bulletMatch[1]))
      continue
    }

    // Numbered list item (1. ...)
    const numMatch = /^(\d+\.)\s+(.*)$/.exec(line)
    if (numMatch) {
      flushBullets()
      blocks.push({
        type: 'paragraph',
        runs: [{ text: `${numMatch[1]} `, bold: true }, ...parseInlineRuns(numMatch[2])],
      })
      continue
    }

    // Blockquote (> ...)
    const quoteMatch = /^>\s*(.*)$/.exec(line)
    if (quoteMatch) {
      flushBullets()
      blocks.push({
        type: 'paragraph',
        runs: parseInlineRuns(quoteMatch[1]).map((r) => ({ ...r, italic: true })),
      })
      continue
    }

    flushBullets()
    blocks.push({
      type: 'paragraph',
      runs: parseInlineRuns(rawLine),
    })
  }
  flushBullets()

  const wordCount = note.content.trim() ? note.content.trim().split(/\s+/).length : 0
  return {
    title,
    meta: ['Notepad', dateOf(note.updatedAt || new Date().toISOString()), `${wordCount} từ`],
    blocks,
    fileName: fileNameOf('notepad', title),
  }
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
