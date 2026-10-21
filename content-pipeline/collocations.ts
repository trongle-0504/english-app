import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type {
  CollocationIndex,
  CollocationLesson,
  CollocationSession,
  VocabWord,
} from '../src/types/content.ts'
import { contentPath, listFiles, looseKey, readJson, slugify, warn, type Output } from './shared.ts'
import { normalizeWord, type RawVocabWord } from './vocabulary.ts'

interface RawCollocationFile {
  metadata: { lesson_id: string; topic: string; chapter_title: string; pdf_file?: string }
  mindmap_data?: {
    chapter?: {
      sessions?: {
        session_id: string
        title: string
        description_vi?: string
        value?: string
        children_nodes?: { node_id: string; label: string }[]
      }[]
    }
  }
  vocabulary_data?: Record<string, RawVocabWord>
}

const tokens = (value: string) => new Set(looseKey(value).split(' ').filter((t) => t.length > 1))

function similarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.size || !tb.size) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / Math.min(ta.size, tb.size)
}

/**
 * Mind-map nodes reference vocabulary by key, but several lessons key their vocabulary as
 * item_1…item_n, so nodes are matched by key, then by exact text, then by word overlap.
 */
function resolveSessions(
  raw: RawCollocationFile,
  entries: { rawKey: string; word: VocabWord }[],
): CollocationSession[] {
  const byRawKey = new Map(entries.map((e) => [e.rawKey, e.word.id]))
  const byText = new Map(entries.map((e) => [looseKey(e.word.word), e.word.id]))
  const assigned = new Set<string>()

  const findBestMatch = (label: string): string | undefined => {
    let best: { id: string; score: number } | undefined
    for (const { word } of entries) {
      const score = similarity(label, word.word) - (assigned.has(word.id) ? 0.25 : 0)
      if (score >= 0.6 && (!best || score > best.score)) best = { id: word.id, score }
    }
    return best?.id
  }

  const sessions: CollocationSession[] = (raw.mindmap_data?.chapter?.sessions ?? []).map((session) => {
    const wordIds: string[] = []
    for (const node of session.children_nodes ?? []) {
      const id =
        byRawKey.get(node.node_id) ??
        byText.get(looseKey(node.label)) ??
        byText.get(looseKey(node.node_id)) ??
        findBestMatch(node.label)
      if (id && !wordIds.includes(id)) {
        wordIds.push(id)
        assigned.add(id)
      }
    }
    return {
      id: slugify(session.session_id || session.title),
      title: session.title,
      description_vi: session.description_vi || undefined,
      wordIds,
    }
  })

  const leftovers = entries.map((e) => e.word.id).filter((id) => !assigned.has(id))
  if (leftovers.length) {
    sessions.push({ id: 'more', title: 'More collocations', description_vi: 'Các cụm từ khác trong bài.', wordIds: leftovers })
  }
  return sessions.filter((s) => s.wordIds.length > 0)
}

export function buildCollocations(root: string, out: Output): CollocationLesson[] {
  const lessonDir = contentPath(root, 'collocations/lessons')
  const markdownDir = contentPath(root, 'collocations/markdown')
  const pdfDir = path.join(root, '..', 'public/pdf/collocations')

  const lessons: CollocationLesson[] = []
  let missingPdfs = 0

  for (const file of listFiles(lessonDir, '.json')) {
    const parsed = readJson<RawCollocationFile | RawCollocationFile[] | null>(path.join(lessonDir, file), null)
    const raw = Array.isArray(parsed) ? parsed[0] : parsed
    if (!raw?.metadata) {
      warn(`collocations: ${file} has no metadata, skipped`)
      continue
    }

    const usedIds = new Set<string>()
    const entries = Object.entries(raw.vocabulary_data ?? {})
      .filter(([, value]) => value?.word)
      .map(([rawKey, value]) => {
        let id = slugify(value.word) || slugify(rawKey)
        for (let n = 2; usedIds.has(id); n++) id = `${slugify(value.word)}-${n}`
        usedIds.add(id)
        return { rawKey, word: normalizeWord(value, id) }
      })

    const baseName = file.replace(/\.json$/, '')
    const mdFile = path.join(markdownDir, `${baseName}.md`)
    const markdown = existsSync(mdFile)
      ? readFileSync(mdFile, 'utf8')
      : (raw.mindmap_data?.chapter?.sessions ?? []).map((s) => s.value ?? '').join('\n\n')

    // Without its PDF (the minimal data pack has none) a lesson shows no PDF tab.
    let pdfFile = raw.metadata.pdf_file
    if (pdfFile && !existsSync(path.join(pdfDir, pdfFile))) {
      missingPdfs++
      pdfFile = undefined
    }

    const lesson: CollocationLesson = {
      id: slugify(raw.metadata.lesson_id || raw.metadata.chapter_title),
      title: raw.metadata.chapter_title,
      topic: { id: slugify(raw.metadata.topic), name: raw.metadata.topic },
      pdf: pdfFile ? `/pdf/collocations/${encodeURIComponent(pdfFile)}` : undefined,
      markdown,
      sessions: resolveSessions(raw, entries),
      words: Object.fromEntries(entries.map((e) => [e.word.id, e.word])),
    }
    if (lessons.some((l) => l.id === lesson.id)) {
      warn(`collocations: duplicate lesson id "${lesson.id}" in ${file}, skipped`)
      continue
    }
    lessons.push(lesson)
    out.set(`collocations/${lesson.id}.json`, lesson)
  }
  if (missingPdfs) warn(`collocations: ${missingPdfs} lesson PDF(s) missing from public/pdf/collocations, shown without a PDF tab`)

  const topics = new Map<string, CollocationIndex['topics'][number]>()
  for (const lesson of lessons) {
    const topic = topics.get(lesson.topic.id) ?? { id: lesson.topic.id, name: lesson.topic.name, lessons: [] }
    topic.lessons.push({
      id: lesson.id,
      title: lesson.title,
      wordCount: Object.keys(lesson.words).length,
      sessionCount: lesson.sessions.length,
    })
    topics.set(lesson.topic.id, topic)
  }

  const index: CollocationIndex = {
    totalLessons: lessons.length,
    totalWords: lessons.reduce((sum, l) => sum + Object.keys(l.words).length, 0),
    topics: [...topics.values()]
      .map((t) => ({ ...t, lessons: t.lessons.sort((a, b) => a.title.localeCompare(b.title)) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
  out.set('collocations/index.json', index)
  return lessons
}
