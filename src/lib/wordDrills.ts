// Review drills stored on a vocabulary entry: "use_prompts" (Tự dùng), "dictation" (Nghe chép), "paraphrase" (Viết lại
// câu). Gemini writes them when a word is generated in Admin; these cleaners are shared by the content pipeline, the
// Admin generator and the Admin preview, so all three keep the same items. Relative imports only (also used by the server).
import type { DictationLine, ParaphraseTask, UsePrompt } from '../types/content.ts'

export const USE_PROMPT_COUNT = 3
export const PARAPHRASE_COUNT = 2

/** "Take  the Responsibility" → "take responsibility": how a target or a `fits` item is matched to the entry's own. */
export const phraseKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(a|an|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
const objects = (raw: unknown) => (Array.isArray(raw) ? raw.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object') : [])

/** Maps a target to the entry's own spelling: the word itself or one of its collocations (null for anything else). */
function targets(word: string, collocations: string[]): (t: unknown) => string | null {
  const own = new Map([word, ...collocations].map((c) => [phraseKey(c), c]))
  return (t) => own.get(phraseKey(str(t))) ?? null
}

/** Keeps well-formed prompts; `fits` is reduced to the entry's real collocations, spelled as they are there. */
export function cleanUsePrompts(raw: unknown, collocations: string[]): UsePrompt[] {
  const own = new Map(collocations.map((c) => [phraseKey(c), c]))
  return objects(raw).flatMap((r): UsePrompt[] => {
    const context = str(r.context)
    const question = str(r.question)
    if (!context || !question) return []
    const fits = (Array.isArray(r.fits) ? r.fits : []).flatMap((f) => {
      const hit = own.get(phraseKey(str(f)))
      return hit ? [hit] : []
    })
    return [{ context, question, fits: [...new Set(fits)] }]
  })
}

/** One sentence per target (the word, then each collocation); unknown targets are dropped. */
export function cleanDictation(raw: unknown, word: string, collocations: string[]): DictationLine[] {
  const target = targets(word, collocations)
  const seen = new Set<string>()
  return objects(raw).flatMap((r): DictationLine[] => {
    const t = target(r.target)
    const text = str(r.text).replace(/\*\*/g, '')
    if (!t || !text || seen.has(t)) return []
    seen.add(t)
    return [{ target: t, text }]
  })
}

/** Rewrite tasks whose target is the word or one of its collocations, with a source and a model answer. */
export function cleanParaphrase(raw: unknown, word: string, collocations: string[]): ParaphraseTask[] {
  const target = targets(word, collocations)
  return objects(raw).flatMap((r): ParaphraseTask[] => {
    const t = target(r.target)
    const source = str(r.source)
    const model = str(r.model).replace(/\*\*/g, '')
    return t && source && model ? [{ target: t, source, model }] : []
  })
}

export interface Drills {
  use_prompts?: UsePrompt[]
  dictation?: DictationLine[]
  paraphrase?: ParaphraseTask[]
}

/**
 * All three drills of an entry, cleaned; empty ones are left out. `item` = the word / note title, `partners` = the texts
 * a drill may target besides it (a word's collocations, a note's patterns).
 */
export function cleanDrills(raw: { use_prompts?: unknown; dictation?: unknown; paraphrase?: unknown }, item: string, partners: string[]): Drills {
  const use_prompts = cleanUsePrompts(raw.use_prompts, partners)
  const dictation = cleanDictation(raw.dictation, item, partners)
  const paraphrase = cleanParaphrase(raw.paraphrase, item, partners)
  return {
    ...(use_prompts.length ? { use_prompts } : {}),
    ...(dictation.length ? { dictation } : {}),
    ...(paraphrase.length ? { paraphrase } : {}),
  }
}
