// Pasted essays often carry section headings ("**Introduction**", "## Overview", "Body Paragraph 1:") on lines of their
// own. They are not sentences of the essay: they would be numbered, scored and counted as words. Shared by the server
// (before a review) and the page (the live word count).

const LABEL =
  /^(?:introduction|intro|overview|body(?:\s+paragraph)?(?:\s*\d+)?|paragraph\s*\d+|conclusion|summary|mở bài|tổng quan|thân bài(?:\s*\d+)?|kết bài|kết luận|đoạn\s*\d+)(?:\s*[:\-–].*)?$/i

/** A line that is only a heading: markdown heading / bold, or a section label alone ("Overview:", "Body 1"). */
export function isHeadingLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (/^#{1,6}\s/.test(t)) return true
  const plain = t
    .replace(/^[*_#>\s]+|[*_\s]+$/g, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/:$/, '')
    .trim()
  if (!plain) return true // a line of stray "*" or "#"
  if (LABEL.test(plain)) return true
  // A short line wrapped in ** **, with no sentence punctuation: a heading.
  return /^\*\*[^*]+\*\*:?$/.test(t) && plain.split(/\s+/).length <= 6 && !/[.!?]$/.test(plain)
}

/** The essay without its heading lines (paragraph breaks kept). */
export function stripHeadingLines(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !isHeadingLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
