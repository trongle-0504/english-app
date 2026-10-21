import type { VocabWord } from '@/types/content'

interface HastText {
  type: 'text'
  value: string
}
interface HastElement {
  type: 'element'
  tagName: string
  properties: Record<string, unknown>
  children: HastNode[]
}
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] }

const SKIP = new Set(['code', 'pre', 'a', 'term', 'h1'])
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** "to wreck/ruin someone's career" → ["to wreck someone's career", "to ruin someone's career", "wreck …", "ruin …"] */
export function phraseVariants(phrase: string): string[] {
  const words = phrase.trim().split(/\s+/)
  let variants = [[] as string[]]
  for (const word of words) {
    const options = word.includes('/') ? word.split('/').filter(Boolean) : [word]
    variants = variants.flatMap((v) => options.map((o) => [...v, o]))
  }
  const result = new Set<string>()
  for (const v of variants) {
    const text = v.join(' ').replace(/\s*\.{3}\s*/g, ' ').trim()
    if (text.length > 2) result.add(text)
    const bare = text.replace(/^(to|a|an|the)\s+/i, '')
    if (bare.length > 3 && bare.includes(' ')) result.add(bare)
  }
  return [...result]
}

/**
 * Rehype plugin: wraps every occurrence of a lesson collocation in `<term data-id>` so the renderer
 * can make it interactive. The lesson markdown is plain text, so phrases are found by matching.
 */
export function rehypeHighlightPhrases(words: VocabWord[]) {
  const idByPhrase = new Map<string, string>()
  for (const word of words) {
    for (const variant of phraseVariants(word.word)) {
      const key = variant.toLowerCase().replace(/’/g, "'")
      if (!idByPhrase.has(key)) idByPhrase.set(key, word.id)
    }
  }
  const phrases = [...idByPhrase.keys()].sort((a, b) => b.length - a.length)
  if (!phrases.length) return () => {}
  const pattern = new RegExp(`(?<![\\w'’-])(${phrases.map((p) => escape(p).replace(/'/g, "['’]")).join('|')})(?![\\w'’-])`, 'gi')

  const splitText = (value: string): HastNode[] | null => {
    const out: HastNode[] = []
    let last = 0
    for (const match of value.matchAll(pattern)) {
      const id = idByPhrase.get(match[0].toLowerCase().replace(/’/g, "'"))
      if (!id) continue
      if (match.index > last) out.push({ type: 'text', value: value.slice(last, match.index) })
      out.push({ type: 'element', tagName: 'term', properties: { dataId: id }, children: [{ type: 'text', value: match[0] }] })
      last = match.index + match[0].length
    }
    if (!out.length) return null
    if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
    return out
  }

  const walk = (node: HastNode) => {
    if (!('children' in node) || !node.children) return
    if (node.type === 'element' && SKIP.has((node as HastElement).tagName)) return
    node.children = node.children.flatMap((child) => {
      if (child.type === 'text') return splitText((child as HastText).value) ?? [child]
      walk(child)
      return [child]
    })
  }

  return () => (tree: HastNode) => walk(tree)
}
