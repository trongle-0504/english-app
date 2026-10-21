// Your script against what you said, sentence by sentence, by code (no AI): each script sentence is matched with the
// stretch of your answer (anywhere, across your sentence breaks) that says most of its content words, and is marked said / partly /
// missed, with the words you left out. The coverage is the share of the script's content words you said.

/** Words that carry no content of their own: saying or skipping them does not change what got across. */
const FUNCTION = new Set(
  'a an the and or but so if then than that this these those to of in on at for by with from as about into over after before is are was were be been being am do does did have has had will would can could should may might must shall it its they them their there here he she him her his we us our you your i me my not no very also just really more most much many some any all each every such which who whom whose what when where while how because well'.split(
    ' ',
  ),
)

const tokens = (text: string) =>
  text
    .toLowerCase()
    .replace(/’/g, "'")
    .match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? []
/**
 * A rough stem, so "explores", "explored" and "exploring" meet "explore", "smartphones" meets "smartphone", and both
 * "movies" / "movie" and "studies" / "study" meet (a final y and ie both become i).
 */
function stem(w: string): string {
  // One plural ending at most: "uses" loses "es" and stops (not "s" again).
  const plural = /ies$/.test(w) ? w.replace(/ies$/, 'i') : /(?<=[sxz]|ch|sh)es$/.test(w) ? w.slice(0, -2) : w.replace(/(?<!s)s$/, '')
  const one = w.length > 3 ? plural : w
  const base = one.length > 4 ? one.replace(/(ing|ed|ly)$/, '') : one
  return base.length > 2 ? base.replace(/e$/, '').replace(/y$/, 'i') : base
}
const content = (text: string) =>
  tokens(text)
    .filter((w) => !FUNCTION.has(w))
    .map(stem)

/** Sentences of a typed script: at . ! ? before a capital, and at line breaks. */
export function scriptSentences(script: string): string[] {
  return script
    .split(/\n+/)
    .flatMap((line) => line.trim().split(/(?<=[.!?])\s+(?=["'(A-Z])/))
    .map((s) => s.trim())
    .filter((s) => tokens(s).length > 0)
}

/** At most this many lines are checked: a longer script (a Part 2 answer) is cut into passages of sentences in a row. */
export const MAX_UNITS = 16

/** What is checked line by line: the script's sentences, or passages of them when there are more than MAX_UNITS. */
export function scriptUnits(script: string, max = MAX_UNITS): string[] {
  const sentences = scriptSentences(script)
  if (sentences.length <= max) return sentences
  // The same number of sentences in each passage, in order.
  const per = Math.ceil(sentences.length / max)
  const units: string[] = []
  for (let i = 0; i < sentences.length; i += per) units.push(sentences.slice(i, i + per).join(' '))
  return units
}

/** A script line against what you said for it: the share of its content words you said, word by word. */
export function wordCheck(line: string, said: string): { share: number; words: { text: string; missing: boolean }[] } {
  const want = new Set(content(line))
  const have = new Set(content(said))
  return {
    share: want.size ? [...want].filter((w) => have.has(w)).length / want.size : 1,
    words: line.split(/(\s+)/).map((text) => {
      const word = content(text)[0]
      return { text, missing: Boolean(word) && !have.has(word) }
    }),
  }
}

export type ScriptStatus = 'said' | 'partly' | 'missed'

export interface ScriptLine {
  sentence: string
  status: ScriptStatus
  /** Share of the sentence's content words you said, 0–1. */
  share: number
  /** What you said for it (one or two of your sentences); empty when missed. */
  said: string
  /** Your sentences it spans (0-based), the hint given to the AI. */
  heard: number[]
  /** The script sentence word by word, each content word marked when you did not say it. */
  words: { text: string; missing: boolean }[]
}

export interface ScriptCheck {
  lines: ScriptLine[]
  /** Share of all the script's content words you said, 0–100. */
  coverage: number
  counts: Record<ScriptStatus, number>
}

const SAID = 0.7
const PARTLY = 0.3
/** How many words "You said" may reach back / ahead to start or end where your sentence does. */
const NEAR = 4

/**
 * The stretch of your answer that says most of a script sentence: a window of words slid over the whole answer, so
 * where the recognizer put its full stops (or your commas) does not matter — a sentence you split in two, merged with
 * the next one or moved elsewhere is still found. The window is a little longer than the sentence (you rarely say it
 * word for word); the stretch shown is trimmed to the first and last word it shares with the sentence.
 */
function bestStretch(want: string[], length: number, raw: string[], stems: string[][]): { from: number; to: number; hits: number } {
  const size = Math.max(8, Math.ceil(length * 1.6))
  let best = { from: -1, to: -1, hits: 0 }
  for (let start = 0; start < raw.length; start++) {
    const end = Math.min(raw.length, start + size)
    const seen = new Set<string>()
    let first = -1
    let last = -1
    for (let i = start; i < end; i++) {
      // Only a word the stretch has not had yet counts (and stretches it): "people" said again in the next sentence does not.
      const fresh = stems[i].filter((s) => want.includes(s) && !seen.has(s))
      if (!fresh.length) continue
      fresh.forEach((s) => seen.add(s))
      if (first < 0) first = i
      last = i
    }
    // More of the sentence's words wins; on a tie, the tighter stretch.
    if (seen.size > best.hits || (seen.size === best.hits && seen.size > 0 && last - first < best.to - best.from))
      best = { from: first, to: last, hits: seen.size }
  }
  return best
}

/** `max`: how many lines at most (sentences, or passages of them for a longer script). */
export function checkScript(script: string, spoken: string[], max = MAX_UNITS): ScriptCheck {
  // Your answer as one run of words: the sentence breaks the recognizer guessed play no part.
  const raw: string[] = []
  /** The sentence of yours each word is in. */
  const sentenceOf: number[] = []
  spoken.forEach((s, i) =>
    s
      .split(/\s+/)
      .filter(Boolean)
      .forEach((w) => {
        raw.push(w)
        sentenceOf.push(i)
      }),
  )
  const stems = raw.map(content)
  let total = 0
  let found = 0
  const lines = scriptUnits(script, max).map((sentence): ScriptLine => {
    const want = [...new Set(content(sentence))]
    const stretch = want.length ? bestStretch(want, tokens(sentence).length, raw, stems) : { from: -1, to: -1, hits: 0 }
    const share = want.length ? stretch.hits / want.length : 1
    const have = new Set(stretch.from < 0 ? [] : stems.slice(stretch.from, stretch.to + 1).flat())
    total += want.length
    found += stretch.hits
    // One word in common is chance ("like", "people"), not a part of the sentence said.
    const status: ScriptStatus = share >= SAID ? 'said' : share >= PARTLY && stretch.hits >= 2 ? 'partly' : 'missed'
    // Shown from the start of your sentence and to its end when they are only a few words away ("It's totally…", not
    // "…totally"); "…" where it still starts or ends inside one of your sentences.
    const ends = (i: number) => i < 0 || /[.!?]$/.test(raw[i])
    let from = stretch.from
    let to = stretch.to
    for (let k = 0; k < NEAR && from > 0 && !ends(from - 1); k++) from--
    for (let k = 0; k < NEAR && to >= 0 && to < raw.length - 1 && !ends(to); k++) to++
    const said = from < 0 ? '' : `${ends(from - 1) ? '' : '…'}${raw.slice(from, to + 1).join(' ')}${ends(to) || to === raw.length - 1 ? '' : '…'}`
    return {
      sentence,
      status,
      share,
      said: status === 'missed' ? '' : said,
      heard: status === 'missed' || stretch.from < 0 ? [] : [...new Set(sentenceOf.slice(stretch.from, stretch.to + 1))],
      words: sentence.split(/(\s+)/).map((text) => {
        const word = content(text)[0]
        return { text, missing: Boolean(word) && !have.has(word) }
      }),
    }
  })
  return {
    lines,
    coverage: total ? Math.round((found / total) * 100) : 0,
    counts: {
      said: lines.filter((l) => l.status === 'said').length,
      partly: lines.filter((l) => l.status === 'partly').length,
      missed: lines.filter((l) => l.status === 'missed').length,
    },
  }
}
