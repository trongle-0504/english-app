import { loadData } from '@/lib/data'
import type { ReviewIndex } from '@/types/content'

/**
 * British IPA for running text. Sources, best first: the app's own vocabulary (review cards with a
 * pronunciation), then public/pronunciation/en-gb.tsv (ipa-dict, built by scripts/build-pronunciation.ts).
 */
export interface Pronunciations {
  own: Map<string, string>
  dict: Map<string, string>
}

export type IpaSource = 'app' | 'dictionary' | 'guess'

let loading: Promise<Pronunciations> | null = null

export function loadPronunciations(): Promise<Pronunciations> {
  loading ??= (async () => {
    const [text, index] = await Promise.all([
      fetch('/pronunciation/en-gb.tsv').then((res) => {
        if (!res.ok) throw new Error(`Could not load the pronunciation dictionary (${res.status}).`)
        return res.text()
      }),
      loadData<ReviewIndex>('review/index.json').catch(() => null),
    ])
    const dict = new Map<string, string>()
    for (const line of text.split('\n')) {
      const tab = line.indexOf('\t')
      if (tab > 0) dict.set(line.slice(0, tab), line.slice(tab + 1))
    }
    const own = new Map<string, string>()
    for (const card of index?.cards ?? []) {
      const ipa = card.pronunciation?.trim()
      if (card.source === 'vocabulary' && ipa && /^\/[^/]+\/$/.test(ipa) && !/\s/.test(card.term.trim())) own.set(card.term.trim().toLowerCase(), ipa)
    }
    return { own, dict }
  })().catch((error) => {
    loading = null
    throw error
  })
  return loading
}

/** Lowercase word without surrounding punctuation; curly apostrophes become straight. */
export function cleanWord(token: string): string {
  return token
    .replace(/[’‘]/g, "'")
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')
    .replace(/^'+|'+$/g, '')
    .toLowerCase()
}

const bare = (ipa: string) => ipa.replace(/^\/|\/$/g, '')

/** -s / -'s ending after a word's IPA: /ɪz/ after sibilants, /s/ after voiceless sounds, else /z/. */
function addS(ipa: string): string {
  const b = bare(ipa)
  if (/(s|z|ʃ|ʒ|tʃ|dʒ)$/.test(b)) return `/${b}ɪz/`
  if (/(p|t|k|f|θ)$/.test(b)) return `/${b}s/`
  return `/${b}z/`
}

export function lookupIpa(word: string, p: Pronunciations): { ipa: string; source: IpaSource } | null {
  const direct = (w: string) => {
    const own = p.own.get(w)
    if (own) return { ipa: own, source: 'app' as const }
    const dict = p.dict.get(w)
    return dict ? { ipa: dict, source: 'dictionary' as const } : null
  }
  if (!word || /^\d/.test(word)) return null
  const found = direct(word)
  if (found) return found

  // Possessive: Vietnam's, children's.
  if (word.endsWith("'s")) {
    const base = direct(word.slice(0, -2))
    if (base) return { ipa: addS(base.ipa), source: 'guess' }
  }
  // Hyphenated compounds: each part.
  if (word.includes('-')) {
    const parts = word.split('-').filter(Boolean).map((part) => direct(part))
    if (parts.length > 1 && parts.every(Boolean)) return { ipa: `/${parts.map((x) => bare(x!.ipa)).join(' ')}/`, source: 'guess' }
  }
  return null
}
