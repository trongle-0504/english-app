import { dateOf, fileNameOf, type Block, type ReportDoc } from '@/features/report/model'
import type { NewsItem } from '@/types/news'
import { parseInlineRuns, triggerBlobDownload } from '../notepad/export-notepad'

export function newsToReportDoc(item: NewsItem): ReportDoc {
  const blocks: Block[] = []

  if (item.ai.summary) {
    blocks.push({ type: 'heading', level: 2, text: '1. Executive Summary' })
    blocks.push({ type: 'paragraph', runs: [{ text: item.ai.summary, italic: true }] })
  }

  if (item.ai.article) {
    blocks.push({ type: 'heading', level: 2, text: '2. English Article' })
    for (const rawLine of item.ai.article.replace(/\r\n/g, '\n').split('\n')) {
      const line = rawLine.trim()
      if (!line) continue
      const h = /^(#{1,4})\s+(.*)$/.exec(line)
      if (h) {
        blocks.push({ type: 'heading', level: 3, text: h[2].replace(/\*\*/g, '').trim() })
      } else {
        blocks.push({ type: 'paragraph', runs: parseInlineRuns(line) })
      }
    }
  }

  if (item.ai.vocabulary.length > 0) {
    blocks.push({ type: 'heading', level: 2, text: `3. IELTS Vocabulary (${item.ai.vocabulary.length} items)` })
    blocks.push({
      type: 'table',
      columns: ['Phrase / Collocation', 'IPA', 'Meaning (VI)'],
      widths: [38, 24, 38],
      rows: item.ai.vocabulary.map((v) => [
        [{ text: v.phrase, bold: true }],
        [{ text: v.ipa, muted: true }],
        [{ text: v.meaning_vi }],
      ]),
    })
  }

  if (item.source_url) {
    blocks.push({ type: 'heading', level: 2, text: '4. Link bài báo gốc (VnExpress)' })
    blocks.push({ type: 'paragraph', runs: [{ text: item.source_url }] })
  }

  return {
    title: item.title,
    meta: [
      item.source || 'vnexpress.net',
      ...(item.ai.topic ? [`Topic: ${item.ai.topic}`] : []),
      dateOf(item.published_at || item.fetched_at),
    ],
    blocks,
    fileName: fileNameOf('daily-paper', item.title),
  }
}

export function newsToMarkdown(item: NewsItem): string {
  const lines: string[] = [
    `# ${item.title}`,
    '',
    `- **Nguồn:** [${item.source}](${item.source_url})`,
    ...(item.published_at ? [`- **Ngày đăng:** ${item.published_at}`] : []),
    ...(item.ai.topic ? [`- **Chủ đề:** ${item.ai.topic}`] : []),
    '',
  ]
  if (item.ai.summary) {
    lines.push('## 1. Executive Summary', '', `> ${item.ai.summary}`, '')
  }
  if (item.ai.article) {
    lines.push('## 2. English Article', '', item.ai.article, '')
  }
  if (item.ai.vocabulary.length > 0) {
    lines.push(`## 3. IELTS Vocabulary (${item.ai.vocabulary.length})`, '', '| Phrase | IPA | Nghĩa tiếng Việt |', '| --- | --- | --- |')
    for (const v of item.ai.vocabulary) {
      lines.push(`| **${v.phrase}** | ${v.ipa} | ${v.meaning_vi} |`)
    }
    lines.push('')
  }
  if (item.source_url) {
    lines.push('## 4. Link bài báo gốc (VnExpress)', '', `- [${item.source_url}](${item.source_url})`, '')
  }
  return lines.join('\n')
}

export { triggerBlobDownload }
