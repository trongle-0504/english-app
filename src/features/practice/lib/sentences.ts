/** Abbreviations that never end a sentence (titles, Latin shorthands followed by more text). */
const NEVER_FINAL = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'e.g', 'i.e', 'cf', 'fig', 'approx', 'dept'])
/** Abbreviations that end a sentence only when the next word is capitalised. */
const MAYBE_FINAL = new Set(['etc', 'a.m', 'p.m', 'u.s', 'u.k', 'inc', 'ltd', 'co', 'corp'])

const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»'])
const TERMINATORS = new Set(['.', '!', '?', '…'])

/** The word immediately before `end` (letters, digits and inner dots), lowercased. */
function wordBefore(text: string, end: number): string {
  let start = end
  while (start > 0 && /[\p{L}\p{N}.]/u.test(text[start - 1])) start--
  return text.slice(start, end).replace(/^\.+/, '').toLowerCase()
}

/** Whether the "." at `dot` belongs to an abbreviation or initial rather than ending the sentence. */
function isAbbreviation(text: string, dot: number, next: string): boolean {
  const word = wordBefore(text, dot)
  if (!word) return false
  if (NEVER_FINAL.has(word)) return true
  if (MAYBE_FINAL.has(word)) return !/\p{Lu}/u.test(next)
  // Single capital initials ("J. K. Rowling") and dotted acronyms ("U.N.").
  return /^\p{L}(\.\p{L})*$/u.test(word) && /\p{Lu}/u.test(text[dot - 1])
}

/**
 * Splits prose into sentences. Handles abbreviations (Mr., e.g., etc.), initials, decimals (3.5),
 * ellipses, closing quotes/brackets after the terminator, and treats line breaks as boundaries.
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = []
  let start = 0

  const push = (end: number) => {
    const sentence = text.slice(start, end).replace(/\s+/g, ' ').trim()
    if (sentence) sentences.push(sentence)
    start = end
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '\n') {
      push(i)
      continue
    }
    if (!TERMINATORS.has(char)) continue

    let end = i + 1
    while (end < text.length && (TERMINATORS.has(text[end]) || CLOSERS.has(text[end]))) end++
    // A terminator glued to the next character is a decimal, URL or inner abbreviation dot.
    if (end < text.length && !/\s/.test(text[end])) continue

    const next = text.slice(end).trimStart()[0] ?? ''
    if (char === '.' && end === i + 1 && isAbbreviation(text, i, next)) continue

    push(end)
    i = end - 1
  }
  push(text.length)
  return sentences
}

/** Removes markdown emphasis/code markers so text can be compared or read aloud. */
export function stripMarkdown(text: string): string {
  return text.replace(/(\*\*|__|\*|`)(.+?)\1/g, '$2').replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*+]\s+/gm, '')
}
