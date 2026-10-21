// Practice questions generated from a vocabulary entry, merged into content/practice/quiz/<Topic>_<SubTopic>.json
// (the folder the practice pages are built from).
import { slugify } from '../../content-pipeline/shared.ts'
import type { RawVocabWord } from '../../content-pipeline/vocabulary.ts'
import type { QuizQuestion } from '../../src/types/content.ts'
import type { ApiContext } from '../api.ts'
import { contentFile } from '../files.ts'
import { generateLogged } from './ai.ts'
import { updateJsonDoc } from './store.ts'

const BOLD = /\*\*(.+?)\*\*/g

/** "Can you **make a decision**?" → { sentence: "Can you ___?", answer: "make a decision" }. Needs exactly one bold span. */
function blankOut(example: string): { sentence: string; answer: string } | null {
  const spans = [...example.matchAll(BOLD)]
  if (spans.length !== 1) return null
  const answer = spans[0][1].trim()
  if (!answer) return null
  return { sentence: example.replace(BOLD, '___').trim(), answer }
}

/** "IELTS-5" + "Speaking" → "IELTS_5_Speaking.json" */
export function quizFileName(topic: string, subTopic: string): string {
  const base = `${topic}_${subTopic}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${base || 'Quiz'}.json`
}

interface Case {
  sentence: string
  answer: string
  info: string
  hint: string
}

const DISTRACTOR_SCHEMA = {
  type: 'object',
  properties: {
    cases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          case: { type: 'integer', description: 'Case number from the input (1-based).' },
          distractors: {
            type: 'array',
            items: { type: 'string' },
            minItems: 3,
            maxItems: 3,
            description: 'Three plausible but incorrect options of the same form as the answer.',
          },
          explanation_vi: { type: 'string', description: 'One short Vietnamese sentence: why the answer fits.' },
        },
        required: ['case', 'distractors', 'explanation_vi'],
      },
    },
  },
  required: ['cases'],
}

interface DistractorResponse {
  cases?: { case?: number; distractors?: string[]; explanation_vi?: string }[]
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/**
 * Multiple choice from bolded sense examples (Gemini only writes the distractors, so the correct answer
 * and its option id are always computed here), plus short-answer questions from bolded collocation
 * examples (no API call).
 */
export async function buildQuestions(ctx: ApiContext, entry: RawVocabWord): Promise<QuizQuestion[]> {
  const idBase = slugify(entry.word).replace(/-/g, '_')
  const cases: Case[] = []
  for (const sense of entry.senses ?? []) {
    for (const example of [sense.examples ?? []].flat()) {
      const blank = blankOut(example)
      if (blank) cases.push({ ...blank, info: (sense.patterns ?? []).join(', ') || entry.word, hint: sense.definition_vi ?? '' })
    }
  }

  const questions: QuizQuestion[] = []
  if (cases.length) {
    const prompt = [
      'You are an expert English teacher writing multiple-choice gap-fill questions for IELTS learners.',
      'For each case below, the sentence has a blank (___) and the correct answer is given.',
      'Write exactly 3 distractors per case: same part of speech and form as the answer, plausible, but clearly wrong in this context.',
      'Distractors must differ from the answer and from each other. Also write a one-sentence Vietnamese explanation of why the answer fits.',
      '',
      `Target word: ${entry.word}`,
      ...cases.map((c, i) => `Case ${i + 1}:\n- Sentence: ${c.sentence}\n- Answer: ${c.answer}\n- Pattern/collocation: ${c.info}`),
    ].join('\n')
    const { value } = await generateLogged<DistractorResponse>(ctx, `practice: ${entry.word}`, {
      prompt,
      schema: DISTRACTOR_SCHEMA,
      temperature: 0.7,
    })
    for (const item of value.cases ?? []) {
      const source = cases[(item.case ?? 0) - 1]
      if (!source) continue
      const seen = new Set([source.answer.toLowerCase()])
      const distractors = (item.distractors ?? [])
        .map((d) => d.trim())
        .filter((d) => d && !seen.has(d.toLowerCase()) && seen.add(d.toLowerCase()))
        .slice(0, 3)
      if (distractors.length < 3) continue
      const options = shuffle([source.answer, ...distractors]).map((text, i) => ({ id: 'abcd'[i], text }))
      questions.push({
        id: `mc_${idBase}_${questions.length}`,
        type: 'multiple_choice',
        sentence: source.sentence,
        options,
        correct_answer: options.find((o) => o.text === source.answer)!.id,
        explanation: item.explanation_vi?.trim() || source.info,
        hint: source.hint,
      })
    }
  }

  let shortAnswers = 0
  for (const collocation of entry.collocations ?? []) {
    const label = collocation.text || collocation.word || entry.word
    for (const example of [collocation.examples ?? []].flat()) {
      const blank = blankOut(example)
      if (!blank) continue
      questions.push({
        id: `sa_${idBase}_${shortAnswers++}`,
        type: 'short_answer',
        sentence: blank.sentence,
        options: [],
        correct_answer: blank.answer,
        explanation: label,
        hint: collocation.meaning_vi || entry.senses?.[0]?.definition_vi || entry.word,
        ...(collocation.type ? { collocation_type: collocation.type } : {}),
      })
    }
  }
  return questions
}

export interface PracticeSummary {
  file: string
  added: number
  replaced: number
}

/** Merges questions into the sub-topic's quiz file, replacing this word's previous questions and exact duplicates. */
export async function saveQuestions(
  ctx: ApiContext,
  topic: string,
  subTopic: string,
  word: string,
  questions: QuizQuestion[],
): Promise<PracticeSummary> {
  const name = quizFileName(topic, subTopic)
  const idBase = slugify(word).replace(/-/g, '_')
  const ownId = new RegExp(`^(mc|sa)_${idBase}_\\d+(_\\d+)*$`)
  const key = (q: Pick<QuizQuestion, 'type' | 'sentence'>) => `${q.type}|${q.sentence.trim().toLowerCase()}`
  const incoming = new Set(questions.map(key))

  return updateJsonDoc<{ questions?: QuizQuestion[] }, PracticeSummary>(
    contentFile(ctx.contentDir, 'practice', 'quiz', name),
    { questions: [] },
    (doc) => {
      const existing = Array.isArray(doc.questions) ? doc.questions : []
      const kept = existing.filter((q) => !ownId.test(q.id) && !incoming.has(key(q)))
      doc.questions = [...kept, ...questions]
      return { file: `practice/quiz/${name}`, added: questions.length, replaced: existing.length - kept.length }
    },
  )
}
