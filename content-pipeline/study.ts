// Grammar, notes and practice: small datasets that need light normalisation only.
import path from 'node:path'
import type {
  GrammarIndex,
  GrammarLesson,
  Note,
  NoteType,
  PracticeIndex,
  QuizQuestion,
  QuizSet,
  WritingSet,
  WritingTask,
} from '../src/types/content.ts'
import { cleanDrills } from '../src/lib/wordDrills.ts'
import { asStringArray, contentPath, listFiles, readJson, slugify, warn, type Output } from './shared.ts'

/* ───────────── Grammar ───────────── */

interface RawGrammarTopics {
  topics?: { name: string; description_vi?: string; lessons?: string[] }[]
}

type RawGrammarLesson = Omit<GrammarLesson, 'slug'>

export function buildGrammar(root: string, out: Output): GrammarLesson[] {
  const rawTopics = readJson<RawGrammarTopics>(contentPath(root, 'grammar/topics.json'), {}).topics ?? []
  const rawLessons = readJson<RawGrammarLesson[]>(contentPath(root, 'grammar/lessons.json'), [])

  const lessons: GrammarLesson[] = rawLessons
    .filter((l) => l?.title)
    .map((l) => ({
      slug: slugify(l.title),
      title: l.title,
      level: l.level,
      brief_description_vi: l.brief_description_vi ?? '',
      structures: l.structures ?? [],
      usages: (l.usages ?? []).map((u) => ({ explanation_vi: u.explanation_vi, examples: u.examples ?? [] })),
      signals: asStringArray(l.signals),
      notes_and_exceptions: asStringArray(l.notes_and_exceptions),
    }))
  const bySlug = new Map(lessons.map((l) => [l.slug, l]))

  const listed = new Set<string>()
  const index: GrammarIndex = {
    topics: rawTopics.map((topic) => ({
      id: slugify(topic.name),
      name: topic.name,
      description_vi: topic.description_vi || undefined,
      lessons: (topic.lessons ?? []).flatMap((title) => {
        const lesson = bySlug.get(slugify(title))
        if (!lesson) {
          warn(`grammar: topic "${topic.name}" lists "${title}" but no lesson exists`)
          return []
        }
        listed.add(lesson.slug)
        return [{ slug: lesson.slug, title: lesson.title, level: lesson.level, brief_description_vi: lesson.brief_description_vi }]
      }),
    })),
  }

  const orphans = lessons.filter((l) => !listed.has(l.slug))
  if (orphans.length) {
    index.topics.push({
      id: 'other',
      name: 'Other',
      lessons: orphans.map((l) => ({ slug: l.slug, title: l.title, level: l.level, brief_description_vi: l.brief_description_vi })),
    })
  }

  out.set('grammar/index.json', index)
  for (const lesson of lessons) out.set(`grammar/${lesson.slug}.json`, lesson)
  return lessons
}

/* ───────────── Notes ───────────── */

const NOTE_TYPES: NoteType[] = ['Structure', 'Idiom', 'Collocation', 'Vocabulary', 'Other']

export function buildNotes(root: string, out: Output): Note[] {
  const raw = readJson<Partial<Note>[]>(contentPath(root, 'note/notes.json'), [])
  const notes: Note[] = raw
    .filter((n) => n?.title)
    .map((n) => ({
      id: n.id || slugify(n.title!),
      title: n.title!,
      type: NOTE_TYPES.includes(n.type as NoteType) ? (n.type as NoteType) : 'Other',
      meaning_vi: n.meaning_vi ?? '',
      usage_context: n.usage_context || undefined,
      // A few generated notes store several formulas as an array.
      formula: (Array.isArray(n.formula) ? n.formula.join(' / ') : n.formula) || undefined,
      pronunciation: n.type === 'Structure' ? undefined : (n.pronunciation?.trim() || undefined),
      patterns: n.patterns ?? [],
      examples: n.examples ?? [],
      related_notes: asStringArray(n.related_notes),
      created_at: n.created_at ?? '',
      image: n.image || undefined,
      image_credit: n.image_credit || undefined,
      image_source: n.image_source || undefined,
      ...cleanDrills(n, n.title!, (n.patterns ?? []).map((p) => p.pattern)),
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  out.set('notes.json', notes)
  return notes
}

/* ───────────── Practice ───────────── */

const titleFromFile = (file: string) => file.replace(/\.json$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()

export function buildPractice(root: string, out: Output): PracticeIndex {
  const index: PracticeIndex = { quizzes: [], writing: [] }

  const quizDir = contentPath(root, 'practice/quiz')
  for (const file of listFiles(quizDir, '.json')) {
    const raw = readJson<{ questions?: QuizQuestion[] }>(path.join(quizDir, file), {})
    const questions = (raw.questions ?? []).filter((q) => q?.sentence)
    if (!questions.length) continue
    const set: QuizSet = { id: slugify(titleFromFile(file)), title: titleFromFile(file), questions }
    out.set(`practice/quiz/${set.id}.json`, set)
    index.quizzes.push({
      id: set.id,
      title: set.title,
      total: questions.length,
      multipleChoice: questions.filter((q) => q.type === 'multiple_choice').length,
      shortAnswer: questions.filter((q) => q.type === 'short_answer').length,
    })
  }

  const writingDir = contentPath(root, 'practice/writing')
  for (const file of listFiles(writingDir, '.json')) {
    const raw = readJson<{ tasks?: WritingTask[] }>(path.join(writingDir, file), {})
    const seen = new Set<string>()
    const tasks = (raw.tasks ?? []).map((task, i) => {
      // Several source files reuse the same taskId; keep ids unique so each task gets fresh state.
      let taskId = task.taskId || `task-${i + 1}`
      if (seen.has(taskId)) taskId = `${taskId}-${i + 1}`
      seen.add(taskId)
      if (task.taskType === 'guided_writing') {
        const outline = task.content.outlineEnglish as string | string[]
        return {
          ...task,
          taskId,
          content: { ...task.content, outlineEnglish: Array.isArray(outline) ? outline.join('\n') : outline ?? '' },
        }
      }
      return { ...task, taskId }
    })
    if (!tasks.length) continue
    const set: WritingSet = { id: slugify(titleFromFile(file)), title: titleFromFile(file), tasks }
    out.set(`practice/writing/${set.id}.json`, set)
    index.writing.push({ id: set.id, title: set.title, taskCount: tasks.length })
  }

  out.set('practice/index.json', index)
  return index
}
