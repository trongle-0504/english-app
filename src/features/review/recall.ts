// Checking a typed answer in "Nhớ ra từ" (recall). Note titles are often patterns with slots — "fascination with + N",
// "it bothers somebody to do something", "assert that + S + V" — so the slots are optional: the fixed words must be
// typed, in order, and a slot may be left out or filled with up to a few words of your own.
import { normalizeAnswer } from '../practice/lib/compare'
import { phraseVariants } from '../collocations/highlightPhrases'

/** Words that only mark a slot in a pattern. */
const SLOT =
  /^(\+|sb|sth|sb's|somebody|somebody's|something|someone|someone's|one's|n|v|v-ing|v-inf|v-ed|v3|to-inf|s|o|sv|adj|adv|noun|verb|clause|place|time|number)$/i
const SLOT_WORDS = 4

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** "fascination with + N" → /^fascination with(?: \S+){0,4}$/ on the normalised answer; null when it has no slot. */
function slotPattern(term: string): RegExp | null {
  const tokens = term
    .replace(/\([^)]*\)/g, ' + ')
    // "regard A as B", "offer sb a chance to do something": capital letters and "do/doing something" are slots too.
    .replace(/\b[A-D]\b/g, ' + ')
    .replace(/\b(do|doing)\s+(something|sth)\b/gi, ' + ')
    .split(/\s+/)
    .filter(Boolean)
  if (!tokens.some((t) => SLOT.test(t))) return null
  const parts: string[] = []
  let slot = false
  for (const t of tokens) {
    if (SLOT.test(t)) slot = true
    else {
      const word = normalizeAnswer(t)
      if (!word) continue
      parts.push(`${slot && parts.length ? `(?: \\S+){0,${SLOT_WORDS}}` : ''}${parts.length ? ' ' : ''}${escape(word)}`)
      slot = false
    }
  }
  if (!parts.length) return null
  const lead = SLOT.test(tokens[0]) ? `(?:\\S+ ){0,${SLOT_WORDS}}` : ''
  return new RegExp(`^${lead}${parts.join('')}${slot ? `(?: \\S+){0,${SLOT_WORDS}}` : ''}$`)
}

/** Any "/" or "vs" alternative ("pose challenges / pose a threat", "have/exert", "affect vs effect"), a dropped leading "to/a/the", and pattern slots left out or filled in. */
export function isRecallCorrect(input: string, term: string): boolean {
  const answer = normalizeAnswer(input)
  if (!answer) return false
  const forms = term.split(/\s+(?:\/|vs\.?)\s+/i).flatMap((alt) => [alt, ...phraseVariants(alt)])
  return forms.some((v) => answer === normalizeAnswer(v) || Boolean(slotPattern(v)?.test(answer)))
}
