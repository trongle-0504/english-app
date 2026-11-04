// Admin → Essays: one Gemini call turns a model essay into a lesson (sentence roles and translations, paragraph outlines,
// collocations / vocabulary / paraphrases / linking words / sentence frames, weak spots, new tasks). Code splits the
// sentences itself and finds every item's exact position, so nothing Gemini "copies" wrongly reaches the page.
import { slugify } from '../../content-pipeline/shared.ts'
import { splitSentences } from '../../src/features/practice/lib/sentences.ts'
import type { Essay, EssayItem, EssayItemKind, EssayParagraph, EssaySentence, SentenceRole } from '../../src/types/essays.ts'
import { generateLogged } from '../admin/ai.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { findLinkers } from './linking.ts'

const ROLES: SentenceRole[] = ['paraphrase', 'position', 'claim', 'explanation', 'example', 'result', 'concession', 'rebuttal', 'summary']
const KINDS: EssayItemKind[] = ['collocation', 'vocabulary', 'paraphrase', 'linking', 'frame']

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short English title, max 6 words.' },
    topic: { type: 'string', description: 'Short English topic label, e.g. "Economy & happiness".' },
    taskType: { type: 'string', description: 'e.g. "Opinion (agree/disagree)", "Discussion + opinion", "Problem–solution".' },
    sentences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          role: { type: 'string', enum: ROLES },
          vi: { type: 'string', description: 'Natural Vietnamese translation of the sentence.' },
        },
        required: ['index', 'role', 'vi'],
      },
    },
    paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          role: { type: 'string', description: 'e.g. "Introduction", "Body 1 — concession + rebuttal", "Conclusion".' },
          summary_vi: { type: 'string', description: 'One Vietnamese sentence: what the paragraph does.' },
          outline: { type: 'array', items: { type: 'string' }, description: '2–4 short English bullets of its ideas, not copied sentences.' },
        },
        required: ['index', 'role', 'summary_vi', 'outline'],
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sentence: { type: 'integer', description: 'Index of the sentence the span is in.' },
          text: { type: 'string', description: 'The span copied EXACTLY from that sentence (same words, same forms).' },
          key: { type: 'string', description: 'Base form to learn: verbs in the infinitive, e.g. "reduce poverty", "a sense of belonging".' },
          kind: { type: 'string', enum: KINDS },
          meaning_vi: { type: 'string' },
          note_vi: { type: 'string', description: 'Optional short Vietnamese note: nuance, register, typical use. "" if none.' },
          frame: { type: 'string', description: 'kind "frame": the reusable pattern with X/Y placeholders; otherwise "".' },
          source: { type: 'string', description: 'kind "paraphrase": the wording of the TASK it paraphrases; otherwise "".' },
          function: { type: 'string', description: 'kind "linking"/"frame": concession, contrast, example, result, addition, cause, emphasis, conclusion…; otherwise "".' },
          headword: { type: 'string', description: 'Dictionary headword of a collocation/vocabulary item (the key noun, verb or adjective); otherwise "".' },
          importance: { type: 'integer', description: '3 = very useful for IELTS writing, 2 = useful, 1 = nice to know.' },
        },
        required: ['sentence', 'text', 'key', 'kind', 'meaning_vi', 'note_vi', 'frame', 'source', 'function', 'headword', 'importance'],
      },
    },
    critique: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sentence: { type: 'integer' },
          text: { type: 'string', description: 'The weak span, copied exactly.' },
          issue_vi: { type: 'string' },
          better: { type: 'string', description: 'A better way to write the span.' },
        },
        required: ['sentence', 'text', 'issue_vi', 'better'],
      },
    },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'A new IELTS Writing Task 2 question on the same topic, from a different angle.' },
          hint_vi: { type: 'string', description: 'One Vietnamese sentence: which ideas/phrases from this essay could be reused.' },
        },
        required: ['prompt', 'hint_vi'],
      },
    },
  },
  required: ['title', 'topic', 'taskType', 'sentences', 'paragraphs', 'items', 'critique', 'tasks'],
}

const SYSTEM = `You are an expert IELTS Writing teacher. A Vietnamese learner (band 6–7) studies a model Task 2 essay to learn its vocabulary, collocations and the way it is written. Turn the essay into a lesson, following the schema.

SENTENCES — for EVERY numbered sentence give its role (paraphrase = restates the task, position = states the writer's view, claim, explanation, example, result, concession, rebuttal, summary) and a natural Vietnamese translation.

PARAGRAPHS — for every paragraph: its role, a one-sentence Vietnamese summary, and an outline of 2–4 SHORT English bullets of its ideas (keywords, not copied sentences) — the learner will rebuild the paragraph from this outline.

ITEMS — the language worth learning, each a span copied EXACTLY from one sentence:
- "collocation" (12–20): natural combinations a learner can reuse (verb + noun, adjective + noun, noun + preposition, adverb + adjective, verb + preposition): "reduce poverty", "strong community ties", "translate into". Skip trivial ones ("many people").
- "vocabulary" (5–10): single less common words or short fixed phrases useful for the topic ("threshold", "imbue", "resilience", "diminishing returns").
- "paraphrase" (at least 3): compare the TASK with the introduction and the conclusion — every phrase that re-expresses the task's wording ("already rich" → "reaches a certain level of wealth"); set "source" to the task's wording it replaces.
- "linking": skip single linking words (code adds them); list only longer cohesive phrases the code cannot know ("This shows that", "whether through …").
- "frame" (4–8): reusable sentence patterns; "frame" generalises them with X/Y ("X does not necessarily translate into Y", "Admittedly, …. However, …"); "text" is the essay's span; set "function".
Aim for 30–40 items in total; a Band 8–9 essay has far more than 15 things worth learning.
Rules: "text" must be a contiguous span of the given sentence, copied character for character; "key" is the base form (infinitive verbs, no sentence-specific words); the same key may appear in several sentences but list each key once unless the second use teaches something new. Never list an error as something to learn.

CRITIQUE — 0–3 spans that are weaker (wordy, slightly unnatural, repetitive), with a better version. Use [] when the essay has none.

TASKS — 3 new IELTS Task 2 questions on the same topic from different angles, each with a Vietnamese hint about what from this essay can be reused.

All Vietnamese must be natural and concise.`

/** Paragraphs split on blank lines (single line breaks when the text has none), sentences by the app's splitter. */
export function splitEssay(text: string): { paragraphs: string[][] } {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  const blocks = /\n\s*\n/.test(normalized) ? normalized.split(/\n\s*\n/) : normalized.split('\n')
  return { paragraphs: blocks.map((b) => splitSentences(b.replace(/\s*\n\s*/g, ' '))).filter((p) => p.length) }
}

const fold = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')

/** Finds `text` in the sentence (then anywhere in the essay), case- and typography-insensitively. */
function locate(sentences: string[], index: number, text: string): { sentence: number; start: number; end: number } | null {
  const needle = fold(text.trim().replace(/^[\s"'“”‘’(]+|[\s,.;:!?"'“”‘’)]+$/g, ''))
  if (needle.length < 2) return null
  const order = [index, ...sentences.keys()].filter((i, n, all) => i >= 0 && i < sentences.length && all.indexOf(i) === n)
  for (const i of order) {
    const at = fold(sentences[i]).indexOf(needle)
    if (at >= 0) return { sentence: i, start: at, end: at + needle.length }
  }
  return null
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

type Raw = Record<string, unknown>

/** Builds the stored essay from Gemini's answer; drops anything that does not match the text. */
export function buildEssay(raw: Raw, prompt: string, paragraphs: string[][], id: string): Essay {
  const flat = paragraphs.flat()
  const byIndex = <T extends { index?: unknown }>(list: unknown, i: number) =>
    (Array.isArray(list) ? (list as T[]) : []).find((x) => Number(x.index) === i)

  const sentences: EssaySentence[] = flat.map((s, i) => {
    const r = byIndex<Raw>(raw.sentences, i)
    const role = text(r?.role) as SentenceRole
    return { text: s, vi: text(r?.vi), role: ROLES.includes(role) ? role : 'explanation' }
  })
  let cursor = 0
  const paras: EssayParagraph[] = paragraphs.map((p, i) => {
    const r = byIndex<Raw>(raw.paragraphs, i)
    const indexes = p.map((_, n) => cursor + n)
    cursor += p.length
    return {
      role: text(r?.role) || (i === 0 ? 'Introduction' : i === paragraphs.length - 1 ? 'Conclusion' : `Body ${i}`),
      summary_vi: text(r?.summary_vi),
      outline: (Array.isArray(r?.outline) ? (r.outline as unknown[]) : []).map(text).filter(Boolean).slice(0, 5),
      sentences: indexes,
    }
  })

  const ids = new Set<string>()
  const seen = new Set<string>()
  const items: EssayItem[] = []
  for (const r of (Array.isArray(raw.items) ? raw.items : []) as Raw[]) {
    const kind = text(r.kind) as EssayItemKind
    if (!KINDS.includes(kind)) continue
    const where = locate(flat, Number(r.sentence), text(r.text))
    if (!where) continue
    const span = flat[where.sentence].slice(where.start, where.end)
    const key = text(r.key) || span
    const dedupe = `${kind}:${where.sentence}:${where.start}:${where.end}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    let itemId = slugify(key) || `item-${items.length + 1}`
    for (let n = 2; ids.has(itemId); n++) itemId = `${slugify(key)}-${n}`
    ids.add(itemId)
    const importance = Math.min(3, Math.max(1, Math.round(Number(r.importance) || 2))) as 1 | 2 | 3
    items.push({
      id: itemId,
      key,
      text: span,
      kind,
      meaning_vi: text(r.meaning_vi),
      ...(text(r.note_vi) ? { note_vi: text(r.note_vi) } : {}),
      ...(kind === 'frame' && text(r.frame) ? { frame: text(r.frame) } : {}),
      ...(kind === 'paraphrase' && text(r.source) ? { source: text(r.source) } : {}),
      ...(text(r.function) ? { function: text(r.function).toLowerCase() } : {}),
      ...(text(r.headword) ? { headword: text(r.headword).toLowerCase() } : {}),
      importance,
      ...where,
    })
  }
  items.push(...findLinkers(flat, items))
  items.sort((a, b) => a.sentence - b.sentence || a.start - b.start)

  const critique = ((Array.isArray(raw.critique) ? raw.critique : []) as Raw[]).flatMap((r) => {
    const where = locate(flat, Number(r.sentence), text(r.text))
    return where && text(r.better) ? [{ sentence: where.sentence, text: flat[where.sentence].slice(where.start, where.end), issue_vi: text(r.issue_vi), better: text(r.better) }] : []
  })
  const tasks = ((Array.isArray(raw.tasks) ? raw.tasks : []) as Raw[])
    .map((r) => ({ prompt: text(r.prompt), hint_vi: text(r.hint_vi) }))
    .filter((t) => t.prompt)
    .slice(0, 4)

  return {
    id,
    title: text(raw.title) || flat[0].slice(0, 60),
    topic: text(raw.topic) || 'General',
    taskType: text(raw.taskType),
    prompt,
    createdAt: new Date().toISOString(),
    sentences,
    paragraphs: paras,
    items,
    critique,
    tasks,
  }
}

export async function analyzeEssay(
  ctx: ApiContext,
  prompt: string,
  essay: string,
  id: (title: string) => Promise<string>,
  requestedVocabulary: string[] = [],
) {
  const { paragraphs } = splitEssay(essay)
  const flat = paragraphs.flat()
  if (paragraphs.flat().length < 3) throw new ApiError(400, 'The essay is too short (need at least 3 sentences).')
  let n = 0
  const numbered = paragraphs.map((p, i) => `Paragraph ${i}:\n${p.map((s) => `  [${n++}] ${s}`).join('\n')}`).join('\n\n')
  const requested = requestedVocabulary.length
    ? `\n\nLEARNER-REQUESTED TERMS — These terms were explicitly requested by the learner. For every term that appears in the essay, include an item for it even if it would not otherwise meet your selection criteria. Use the exact contiguous wording from the essay as "text", choose the most suitable kind, and explain it clearly. Do not invent an item for a term that does not appear:\n${requestedVocabulary.map((term) => `- ${term}`).join('\n')}`
    : ''
  const result = await generateLogged<Raw>(ctx, `essay: ${paragraphs[0][0].slice(0, 50)}`, {
    system: SYSTEM,
    prompt: `TASK:\n${prompt}\n\nESSAY (sentences numbered):\n${numbered}${requested}`,
    schema: SCHEMA,
    // One call per essay, done once: worth more thinking than the default "low".
    thinking: 'medium',
    retries: 2,
  })
  if (!result.value || typeof result.value !== 'object') throw new ApiError(502, 'Gemini did not return a JSON object.')
  const built = buildEssay(result.value, prompt, paragraphs, '')
  built.id = await id(built.title)
  const missingVocabulary = requestedVocabulary.filter((term) => !locate(flat, 0, term))
  return { essay: built, model: result.model, usage: result.usage, missingVocabulary }
}

/* ───────────── One item added by hand (Practice → Model essays: select a phrase → "Add to this essay") ───────────── */

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: KINDS },
    key: { type: 'string', description: 'Base form to learn (infinitive verbs, no sentence-specific words).' },
    meaning_vi: { type: 'string' },
    note_vi: { type: 'string', description: 'Short Vietnamese note on nuance or typical use, or "".' },
    frame: { type: 'string', description: 'kind "frame": the reusable pattern with X/Y placeholders; otherwise "".' },
    source: { type: 'string', description: 'kind "paraphrase": the wording of the TASK it paraphrases; otherwise "".' },
    function: { type: 'string', description: 'kind "linking"/"frame": concession, contrast, example, result, addition…; otherwise "".' },
    headword: { type: 'string', description: 'Dictionary headword (key noun/verb/adjective) of a collocation or vocabulary item; otherwise "".' },
    importance: { type: 'integer', description: '3 very useful for IELTS writing, 2 useful, 1 nice to know.' },
  },
  required: ['kind', 'key', 'meaning_vi', 'note_vi', 'frame', 'source', 'function', 'headword', 'importance'],
}

/** Gemini describes a span the learner selected; the span itself (and its position) comes from the page, not the model. */
export async function describeItem(ctx: ApiContext, essay: Essay, sentence: number, start: number, end: number, kind: EssayItemKind | 'auto'): Promise<EssayItem> {
  const s = essay.sentences[sentence]
  if (!s || start < 0 || end > s.text.length || end - start < 2) throw new ApiError(400, 'The selection is not inside one sentence.')
  const span = s.text.slice(start, end)
  if (span.length > 160) throw new ApiError(400, 'Select a shorter phrase (at most 160 characters).')
  const res = await generateLogged<Raw>(ctx, `essay item: ${span.slice(0, 40)}`, {
    system: `${SYSTEM.split('\n\nSENTENCES')[0]}\nDescribe ONE span the learner selected, as an item of the lesson (see the item kinds below).\n${SYSTEM.slice(SYSTEM.indexOf('ITEMS'), SYSTEM.indexOf('CRITIQUE')).trim()}`,
    prompt: `TASK: ${essay.prompt}\n\nSentence: ${s.text}\nSelected span: "${span}"\n${kind === 'auto' ? 'Choose the best kind.' : `Kind: ${kind}`}`,
    schema: ITEM_SCHEMA,
    retries: 2,
  })
  const r = res.value ?? {}
  const chosen = kind === 'auto' ? (KINDS.includes(text(r.kind) as EssayItemKind) ? (text(r.kind) as EssayItemKind) : 'collocation') : kind
  const key = text(r.key) || span
  const ids = new Set(essay.items.map((i) => i.id))
  let id = slugify(key) || 'item'
  for (let n = 2; ids.has(id); n++) id = `${slugify(key) || 'item'}-${n}`
  return {
    id,
    key,
    text: span,
    kind: chosen,
    meaning_vi: text(r.meaning_vi),
    ...(text(r.note_vi) ? { note_vi: text(r.note_vi) } : {}),
    ...(chosen === 'frame' && text(r.frame) ? { frame: text(r.frame) } : {}),
    ...(chosen === 'paraphrase' && text(r.source) ? { source: text(r.source) } : {}),
    ...(text(r.function) ? { function: text(r.function).toLowerCase() } : {}),
    ...(text(r.headword) ? { headword: text(r.headword).toLowerCase() } : {}),
    importance: Math.min(3, Math.max(1, Math.round(Number(r.importance) || 2))) as 1 | 2 | 3,
    sentence,
    start,
    end,
  }
}
