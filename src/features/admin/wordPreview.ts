import type { VocabRelation, VocabWord } from '@/types/content'
import { cleanDictation, cleanParaphrase, cleanUsePrompts } from '@/lib/wordDrills'
import { slugify } from './utils'

// Mirrors normalizeWord (content-pipeline/vocabulary.ts), so the Admin preview shows an entry exactly like the site.
const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v == null ? [] : [v]).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
type Raw = Record<string, any>

function relation(item: Raw): VocabRelation | null {
  const text = String(item?.text ?? item?.word ?? '').trim()
  if (!text) return null
  return { text, pronunciation: str(item.pronunciation), meaning_vi: str(item.meaning_vi), type: str(item.type), examples: strings(item.examples) }
}
const relations = (v: unknown) => (Array.isArray(v) ? v.map(relation).filter((x): x is VocabRelation => Boolean(x)) : [])

function image(v: unknown): string | undefined {
  if (typeof v === 'string') return /^(https?:)?\/\//.test(v) || v.startsWith('/') ? v : undefined
  return v && typeof v === 'object' ? str((v as Raw).link) : undefined
}

/** The entry as the site will show it, or null when the JSON is not a word yet. */
export function previewWord(raw: unknown): VocabWord | null {
  if (!raw || typeof raw !== 'object' || typeof (raw as Raw).word !== 'string' || !(raw as Raw).word.trim()) return null
  const r = raw as Raw
  const roots = r.word_roots && typeof r.word_roots === 'object' ? r.word_roots : undefined
  const pic = image(r.image)
  const collocations = relations(r.collocations)
  const texts = collocations.map((c) => c.text)
  const usePrompts = cleanUsePrompts(r.use_prompts, texts)
  const dictation = cleanDictation(r.dictation, r.word.trim(), texts)
  const paraphrase = cleanParaphrase(r.paraphrase, r.word.trim(), texts)
  return {
    id: slugify(r.word),
    word: r.word.trim(),
    pronunciation: str(r.pronunciation) ?? '',
    image: pic,
    ...(pic && str(r.image_credit) ? { image_credit: str(r.image_credit) } : {}),
    part_of_speech: strings(r.part_of_speech),
    senses: (Array.isArray(r.senses) ? r.senses : []).map((s: Raw) => ({
      definition_vi: String(s?.definition_vi ?? ''),
      examples: strings(s?.examples),
      patterns: strings(s?.patterns?.length ? s.patterns : s?.grammar_patterns),
      usage_notes_vi: str(s?.usage_notes_vi),
    })),
    collocations,
    synonyms: relations(r.synonyms),
    antonyms: relations(r.antonyms),
    word_family: strings(r.word_family),
    word_roots: roots && (roots.origin || roots.roots?.length || roots.mnemonic_vi) ? { origin: roots.origin, roots: roots.roots ?? [], mnemonic_vi: roots.mnemonic_vi } : undefined,
    mnemonic_vi: str(r.mnemonic_vi),
    ...(usePrompts.length ? { use_prompts: usePrompts } : {}),
    ...(dictation.length ? { dictation } : {}),
    ...(paraphrase.length ? { paraphrase } : {}),
    created_at: str(r.created_at),
  } as VocabWord
}
