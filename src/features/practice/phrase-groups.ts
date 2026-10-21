// The phrase lists a Speaking answer / Writing model essay shows: "Cụm từ trong thư viện", "Cụm ngoài thư viện" and
// "Cụm AI tự viết, đã tra từ điển". After you edit the text, only the phrases still in it. Shared by the result pages and
// the server (server/practice/recent.ts: the phrases of your recent work as review cards); keep imports relative.
import type { AnswerSegment, AnswerSentence, CheckedWording, SpeakingExtra, SpeakingPick } from '../../types/speaking.ts'

/** The phrase is in the text (case and punctuation ignored). */
export function phraseMatchesText(phrase: string, fullText: string): boolean {
  if (!phrase || !fullText) return false
  const p = phrase
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:"'’()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!p) return false
  const t = fullText
    .toLowerCase()
    .replace(/[.,!?;:"'’()]/g, ' ')
    .replace(/\s+/g, ' ')
  return t.includes(` ${p} `) || t.startsWith(`${p} `) || t.endsWith(` ${p}`) || t === p || t.includes(p)
}

/** A Speaking answer or a Writing model essay. */
export interface PhraseSource {
  picks: SpeakingPick[]
  extras: SpeakingExtra[]
  wording?: CheckedWording[]
  sentences?: AnswerSentence[]
  /** The whole answer (older Speaking results only have this). */
  answer?: AnswerSegment[]
  userEdited?: string
  originalAnswer?: unknown
}

export interface PhraseGroups {
  /** The learner edited the text: the lists keep only what is still in it. */
  isCustomized: boolean
  /** The text the lists are about. */
  text: string
  picks: SpeakingPick[]
  extras: SpeakingExtra[]
  /** "Cụm AI tự viết, đã tra từ điển": the checked wording, plus every other marked phrase of the text. */
  wording: CheckedWording[]
  unusedPicks: SpeakingPick[]
  unusedExtras: SpeakingExtra[]
}

export function phraseGroups(src: PhraseSource): PhraseGroups {
  const isCustomized = Boolean(src.userEdited || src.originalAnswer)
  const text =
    src.userEdited ||
    (src.sentences?.length
      ? src.sentences.map((s) => s.segments.map((g) => g.text).join('')).join(' ')
      : (src.answer ?? []).map((g) => g.text).join(''))

  const picks = isCustomized ? src.picks.filter((p) => phraseMatchesText(p.term, text) || (p.slot && phraseMatchesText(p.slot, text))) : src.picks
  const extras = isCustomized ? src.extras.filter((e) => phraseMatchesText(e.phrase, text)) : src.extras
  const pickIds = new Set(picks.map((p) => p.cardId))
  const extraKeys = new Set(extras.map((e) => e.phrase.toLowerCase()))

  // Any phrase marked in the text that is in none of the lists shows with the wording.
  const wording = (src.wording ?? []).filter((w) => !isCustomized || phraseMatchesText(w.text, text))
  const seen = new Set(wording.map((w) => w.text.trim().toLowerCase()))
  const pickTerms = new Set(picks.flatMap((p) => [p.term.trim().toLowerCase(), (p.slot || '').trim().toLowerCase()]).filter(Boolean))
  const extraPhrases = new Set(extras.map((e) => e.phrase.trim().toLowerCase()))
  for (const seg of src.sentences?.flatMap((s) => s.segments) ?? src.answer ?? []) {
    if (!seg.mark || seg.mark === 'structure') continue
    const phrase = seg.text.trim()
    const lower = phrase.toLowerCase()
    if (phrase.length <= 2 || seen.has(lower) || pickTerms.has(lower) || extraPhrases.has(lower)) continue
    seen.add(lower)
    wording.push({
      text: phrase,
      verified: seg.mark === 'checked' || seg.mark === 'library',
      ...(seg.mark === 'natural' ? { natural: true } : {}),
      // A library phrase written in another form (marked as library in the text): not a phrase of its own.
      ...(seg.mark === 'library' ? { library: true } : {}),
      dictionary: seg.note ? [seg.note] : [],
      sources: [
        {
          name: 'OZDIC',
          url: `https://ozdic.com/word/${encodeURIComponent(phrase.split(/\s+/).pop()?.toLowerCase() || lower)}`,
        },
      ],
    })
  }

  return {
    isCustomized,
    text,
    picks,
    extras,
    wording,
    unusedPicks: isCustomized ? src.picks.filter((p) => !pickIds.has(p.cardId)) : [],
    unusedExtras: isCustomized ? src.extras.filter((e) => !extraKeys.has(e.phrase.toLowerCase())) : [],
  }
}

/** The sentence of the text a phrase is in (for a card's example). */
export function sentenceWith(phrase: string, src: Pick<PhraseSource, 'sentences' | 'answer'>): string | undefined {
  const lines = src.sentences?.length
    ? src.sentences.map((s) => s.segments.map((g) => g.text).join(''))
    : [(src.answer ?? []).map((g) => g.text).join('')]
  return lines.find((line) => phraseMatchesText(phrase, line))?.trim()
}

/** As content-pipeline/shared.ts `slugify` (card ids are built with it), without its Node imports. */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The deck of the cards made from Speaking / Writing phrases (content/review/speaking-writing.json). */
export const PHRASE_DECK = 'Speaking & Writing'
export const PHRASE_DECK_ID = slugify(PHRASE_DECK)
/** The deck of the mistake cards (content/review/so-loi.json). */
export const MISTAKE_DECK = 'Sổ lỗi'
export const MISTAKE_DECK_ID = slugify(MISTAKE_DECK)

/** The review card of a phrase from outside the library. */
export const phraseCardId = (term: string) => `custom:${PHRASE_DECK_ID}:${slugify(term)}`
