// Compares the corrections with the model essay: learner errors the essay repeats (`scripts/rereview-writing.ts
// --copied-errors`), and style fixes whose original wording the essay keeps (marked at the end of a review).

export interface CopiedError {
  phrase: string
  sentence: string
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** True when a fix changes only letter case, punctuation or spacing ("Mandating" → "mandating", "funds, the" → "funds; the"). */
export function isSurfaceOnlyFix(original: string, replacement: string): boolean {
  const letters = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  return letters(original) === letters(replacement)
}

export function buildErrorPhrase(draftSentence: string, original: string): string {
  const orig = original.trim()
  if (!orig) return ''
  const idx = draftSentence.toLowerCase().indexOf(orig.toLowerCase())
  if (idx < 0) return orig

  const beforeText = draftSentence.slice(0, idx).trimEnd()
  const afterText = draftSentence.slice(idx + orig.length).trimStart()

  const beforeTokens = beforeText.split(/\s+/).filter(Boolean)
  const rawBefore = beforeTokens[beforeTokens.length - 1] ?? ''
  const cleanBefore = rawBefore.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

  const afterTokens = afterText.split(/\s+/).filter(Boolean)
  const rawAfter = afterTokens[0] ?? ''
  const cleanAfter = rawAfter.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

  return [cleanBefore, orig, cleanAfter].filter(Boolean).join(' ')
}

export function findCopiedErrors(
  draftSentences: string[],
  fixes: { sentenceIndex: number; original: string; replacement: string }[],
  essaySentences: string[],
): CopiedError[] {
  const copied: CopiedError[] = []
  for (const fix of fixes) {
    const phrase = buildErrorPhrase(draftSentences[fix.sentenceIndex] ?? '', fix.original)
    if (!phrase || !/\p{L}/u.test(phrase)) continue
    // A case- or punctuation-only error is copied only when the essay repeats it exactly, so match case-sensitively.
    const flags = isSurfaceOnlyFix(fix.original, fix.replacement) ? 'u' : 'iu'
    const pattern = new RegExp(`(?<=^|[^\\p{L}\\p{N}])${escapeRegex(phrase)}(?=[^\\p{L}\\p{N}]|$)`, flags)
    for (const sentence of essaySentences) {
      if (pattern.test(sentence)) copied.push({ phrase, sentence })
    }
  }
  return copied
}

/**
 * Ids of "improve" fixes whose original wording appears (whole words, any case) in the model essay. The corrections and
 * the essay run in parallel, so the essay can keep a phrase the corrections upgraded; such a fix is a style option.
 */
export function styleFixesKeptInEssay(
  fixes: { id: string; original: string; severity?: string }[],
  essaySentences: string[],
): Set<string> {
  const kept = new Set<string>()
  for (const fix of fixes) {
    if (fix.severity !== 'improve') continue
    const phrase = fix.original.trim()
    if (!/\p{L}/u.test(phrase)) continue
    const pattern = new RegExp(`(?<=^|[^\\p{L}\\p{N}])${escapeRegex(phrase)}(?=[^\\p{L}\\p{N}]|$)`, 'iu')
    if (essaySentences.some((sentence) => pattern.test(sentence))) kept.add(fix.id)
  }
  return kept
}
