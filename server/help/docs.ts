// The help pages (content/docs/*.md): what each feature does and how to use it. Read by the /help page and by Nova's
// search_help / read_help tools, so a learner can ask "how do I…" (PLAN-multi-user-v2.md, 4.3). Kept in step with
// the menu by scripts/tests/help-docs.test.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export interface HelpDoc {
  id: string
  title: string
  routes: string[]
  keywords: string[]
  updated: string
  body: string
}

export const docsDir = () => process.env.HELP_DOCS_DIR || path.resolve(import.meta.dirname, '..', '..', 'content', 'docs')

const list = (value: string | undefined) =>
  (value ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export function parseDoc(id: string, text: string): HelpDoc {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  const fields: Record<string, string> = {}
  for (const line of (m?.[1] ?? '').split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { id, title: fields.title || id, routes: list(fields.routes), keywords: list(fields.keywords), updated: fields.updated ?? '', body: (m?.[2] ?? text).trim() }
}

let cache: { stamp: string; docs: HelpDoc[] } | null = null

export function loadDocs(): HelpDoc[] {
  const dir = docsDir()
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return []
  }
  const stamp = files.map((f) => `${f}:${statSync(path.join(dir, f)).mtimeMs}`).join('|')
  if (cache?.stamp === stamp) return cache.docs
  const docs = files.map((f) => parseDoc(f.replace(/\.md$/, ''), readFileSync(path.join(dir, f), 'utf8')))
  cache = { stamp, docs }
  return docs
}

/** Lowercase, Vietnamese marks removed: "làm sao" and "lam sao" match. */
export const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')

const STOP = new Set(['lam', 'sao', 'de', 'the', 'nao', 'how', 'do', 'i', 'to', 'a', 'the', 'toi', 'minh', 'cach', 'o', 'dau', 'la', 'gi', 'co', 'khong', 'duoc', 'what', 'where', 'is', 'can', 'my', 've', 'cua', 'cho', 'va'])

export interface HelpHit {
  id: string
  title: string
  section: string
  text: string
  href: string
  score: number
}

/** Sections (## …) of every page ranked for a question: words in the title, keywords, heading and text. Pure. */
export function searchDocs(docs: HelpDoc[], query: string, limit = 4): HelpHit[] {
  const words = fold(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w))
  if (!words.length) return []
  const hits: HelpHit[] = []
  for (const doc of docs) {
    const head = fold(`${doc.title} ${doc.keywords.join(' ')}`)
    const sections = doc.body.split(/\n(?=## )/)
    for (const section of sections) {
      const heading = /^## (.+)/.exec(section)?.[1] ?? doc.title
      const text = fold(section)
      let score = 0
      for (const w of words) {
        if (head.includes(w)) score += 3
        if (fold(heading).includes(w)) score += 2
        if (text.includes(w)) score += 1
      }
      if (score > 0) hits.push({ id: doc.id, title: doc.title, section: heading, text: section.replace(/^## .+\n/, '').trim().slice(0, 1500), href: `/help/${doc.id}`, score })
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
