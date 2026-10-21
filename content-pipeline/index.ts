import { createHash } from 'node:crypto'
import type { LookupIndex } from '../src/types/content.ts'
import { buildBlog } from './blog.ts'
import { buildCollocations } from './collocations.ts'
import { buildEssays } from './essays.ts'
import { contentPath, readJson, warnings, type Output } from './shared.ts'
import { buildReview } from './review.ts'
import { buildGrammar, buildNotes, buildPractice } from './study.ts'
import { ALL_TOPIC_ID, buildVocabulary } from './vocabulary.ts'

export interface ContentBuild {
  /** `/data/<key>` → serialised JSON */
  files: Map<string, string>
  version: string
  warnings: string[]
}

export function buildContent(root: string): ContentBuild {
  warnings.length = 0
  const out: Output = new Map()

  const words = buildVocabulary(root, out)
  const lessons = buildCollocations(root, out)
  buildGrammar(root, out)
  const notes = buildNotes(root, out)
  buildPractice(root, out)
  buildBlog(root, out)
  const essays = buildEssays(root, out)
  out.set('grammar/history.json', readJson<Record<string, string>>(contentPath(root, 'grammar/history.json'), {}))

  // Word → first vocabulary lesson that contains it, so lookup results open in context.
  const wordHome = new Map<string, string>()
  for (const [key, doc] of out) {
    const match = /^vocabulary\/([^/]+)\/([^/]+)\.json$/.exec(key)
    if (!match || match[1] === ALL_TOPIC_ID) continue
    for (const w of (doc as { words: { id: string }[] }).words) {
      if (!wordHome.has(w.id)) wordHome.set(w.id, `/vocabulary/${match[1]}/${match[2]}`)
    }
  }

  // Everything the header word lookup needs, fetched once when it is first opened.
  const lookup: LookupIndex = {
    vocabulary: words.map((word) => ({ word, href: `${wordHome.get(word.id) ?? `/vocabulary/${ALL_TOPIC_ID}/${ALL_TOPIC_ID}`}#${word.id}` })),
    collocations: lessons.flatMap((lesson) =>
      Object.values(lesson.words).map((word) => ({ word, lesson: lesson.title, lessonId: lesson.id, href: `/collocations/${lesson.id}#${word.id}` })),
    ),
    notes,
  }
  out.set('lookup.json', lookup)

  buildReview(root, out, { words, lessons, notes, essays })

  const files = new Map<string, string>()
  const hash = createHash('sha1')
  for (const [key, doc] of out) {
    const json = JSON.stringify(doc)
    files.set(key, json)
    hash.update(key).update(json)
  }
  return { files, version: hash.digest('hex').slice(0, 10), warnings: [...warnings] }
}
