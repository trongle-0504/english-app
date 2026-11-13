// What the admin typed, made ready for a dictionary lookup (Admin → Vocabulary / Notes → Generate). Longman and OZDIC
// name their pages after the base form, lower case: "decisions", "took" or "“Decision.”" find nothing as typed.

/**
 * Normalises in place, for free: trims, collapses whitespace, turns curly quotes into straight ones and drops
 * punctuation and quotes at both ends. `lower: false` keeps the admin's capitals (the entry's own title).
 */
export function normalizeTerm(input: string, { lower = true } = {}): string {
  const text = input
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'`([{<.,;:!?…*_-]+/, '')
    .replace(/[\s"'`)\]}>.,;:!?…*_-]+$/, '')
    .trim()
  return lower ? text.toLowerCase() : text
}

/** One word: letters with inner hyphens or apostrophes ("well-being", "o'clock"), no spaces. */
export function isSingleWord(term: string): boolean {
  return /^[a-z]+(?:['-][a-z]+)*$/i.test(term)
}

/** Endings that may mark an inflected form: -s, -es, -ies, -ed, -ing, -er, -est (plurals, past, -ing, comparatives). */
const INFLECTION = /(?:s|ed|ing|er|est)$/i

/**
 * True when a single word may be inflected, so its Longman/OZDIC page is probably under another form. Words of three
 * letters or fewer ("bus", "red", "her") are too short to tell and count as base forms.
 */
export function hasInflectionSign(word: string): boolean {
  return word.length > 3 && INFLECTION.test(word)
}

/** A single word without an inflection sign: looked up as typed, and the AI base-form call can be skipped when Longman has it. */
export function lookupAsTyped(term: string): boolean {
  return isSingleWord(term) && !hasInflectionSign(term)
}
