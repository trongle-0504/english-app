// Fluency measured by code from the recognizer's word timings: speed, pauses, fillers, repeats, word variety, sentence
// length, unclear words. The AI gets these figures for Fluency & Coherence / Pronunciation, and the page shows them.
import type { TalkFluency, TalkWord } from '../../src/types/speakingReview.ts'

const PAUSE = 1
const LONG_PAUSE = 2
/** A silence of at least this long inside a sentence is a hesitation. */
export const HESITATION = 0.8
/** The recognizer put a full stop here: the next silence is between sentences. */
export const endsSentence = (w: string) => /[.!?]["')\]]*$/.test(w)
/** Below this the recognizer was unsure of the word. */
export const UNCLEAR = 0.6
const WINDOW = 50

const SINGLE_FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'ah', 'eh', 'hmm', 'mm', 'mhm'])

const plain = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

/** Filler words and phrases: um / uh…, "you know", "I mean", and "like" set off by commas. */
function fillersOf(words: TalkWord[]): Map<string, number> {
  const found = new Map<string, number>()
  const add = (f: string) => found.set(f, (found.get(f) ?? 0) + 1)
  words.forEach((word, i) => {
    const w = plain(word.w)
    const next = plain(words[i + 1]?.w ?? '')
    if (SINGLE_FILLERS.has(w)) add(w.replace(/(.)\1+$/, '$1'))
    else if (w === 'you' && next === 'know' && /[,.?]$/.test(words[i + 1]?.w ?? '')) add('you know')
    else if (w === 'i' && next === 'mean' && /,$/.test(words[i + 1]?.w ?? '')) add('I mean')
    else if (w === 'like' && (/,$/.test(word.w) || /,$/.test(words[i - 1]?.w ?? ''))) add('like')
  })
  return found
}

/** Different words / all words, averaged over windows of WINDOW words (moving-average type-token ratio). */
function variety(words: string[]): number {
  if (!words.length) return 0
  if (words.length <= WINDOW) return new Set(words).size / words.length
  let sum = 0
  let n = 0
  for (let i = 0; i + WINDOW <= words.length; i++, n++) sum += new Set(words.slice(i, i + WINDOW)).size / WINDOW
  return sum / n
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits

export function measureFluency(words: TalkWord[], duration: number, sentences: string[]): TalkFluency {
  const spoken = words.map((w) => plain(w.w)).filter(Boolean)
  const speech = words.length ? Math.max(0, words[words.length - 1].end - words[0].start) : 0
  const gaps = words.slice(1).map((w, i) => w.start - words[i].end)
  const pauses = gaps.filter((g) => g >= PAUSE)
  // A silence inside a sentence is a search for words (a hesitation); one between sentences is natural.
  const inSentence = gaps.filter((_, i) => !endsSentence(words[i].w))
  const hesitations = inSentence.filter((g) => g >= HESITATION)
  const fillers = fillersOf(words)
  const fillerCount = [...fillers.values()].reduce((a, b) => a + b, 0)
  let repeats = 0
  for (let i = 1; i < spoken.length; i++) if (spoken[i] === spoken[i - 1] && !SINGLE_FILLERS.has(spoken[i])) repeats++
  const content = spoken.filter((w) => !SINGLE_FILLERS.has(w))
  return {
    duration: round(duration, 1),
    speech: round(speech, 1),
    words: content.length,
    wpm: speech > 0 ? Math.round((content.length / speech) * 60) : 0,
    pauses: pauses.length,
    longPauses: pauses.filter((g) => g >= LONG_PAUSE).length,
    longestPause: round(Math.max(0, ...gaps), 1),
    pauseRatio: speech > 0 ? round(pauses.reduce((a, b) => a + b, 0) / speech) : 0,
    hesitations: hesitations.length,
    longestHesitation: round(Math.max(0, ...inSentence), 1),
    sentencePauses: gaps.filter((g, i) => endsSentence(words[i].w) && g >= PAUSE).length,
    fillers: [...fillers].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count),
    fillerCount,
    repeats,
    variety: round(variety(content)),
    sentences: sentences.length,
    avgSentenceWords: sentences.length ? round(content.length / sentences.length, 1) : 0,
    unclear: words.filter((w) => w.conf < UNCLEAR).length,
  }
}
