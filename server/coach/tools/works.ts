// Saved work: lists, scores, and one Writing / Speaking review in detail.
import type { TalkReviewResult } from '../../../src/types/speakingReview.ts'
import type { WritingFix, WritingReviewResult } from '../../../src/types/writingReview.ts'
import { cut, dayOf, ideaDocs, inRange, talkDocs, timeOf, ToolError, validWorkId, writingDocs } from '../data.ts'
import { optDay, optEnum, optEnumList, optInt, type Args } from './args.ts'
import { DAY, type CoachTool } from './types.ts'

const WORK_KINDS = ['writing', 'speaking_review', 'speaking_ideas'] as const
const SCORED_KINDS = ['writing', 'speaking_review'] as const
const FIX_TYPES = ['spelling', 'grammar', 'word form', 'collocation', 'word choice', 'naturalness', 'confusable', 'verb pattern'] as const
const PAGE = 10

const writingTitle = (r: WritingReviewResult) => cut(r.title || r.prompt || r.text, 80)
const talkTitle = (r: TalkReviewResult) => cut(r.question || r.topic || r.transcript, 80)
/** In-app page that opens one saved work (the review pages read `?id=`). */
export const workHref = (kind: (typeof WORK_KINDS)[number], id: string) =>
  kind === 'writing'
    ? `/practice/writing-review?id=${encodeURIComponent(id)}`
    : kind === 'speaking_review'
      ? `/practice/speaking-review?id=${encodeURIComponent(id)}`
      : `/practice/speaking-ideas/history?id=${encodeURIComponent(id)}`
const errorsOf = (fixes: WritingFix[]) => fixes.filter((f) => f.severity !== 'improve').length
/** A criterion's name as the learner knows it: Task 1 keeps Task Achievement in the tr slot. */
const criterionKey = (k: string, task?: number) => (task === 1 && k === 'tr' ? 'TA' : k.toUpperCase())
const taskOf = (r: WritingReviewResult) => (r.task === 1 ? 1 : 2)

/** The Task 1 checks of a review, short: overview, key features, wrong figures, plan check, model-essay comparison. */
function task1Section(r: WritingReviewResult) {
  const t = r.task1
  const m = r.task1Model
  return {
    noChart: t?.noChart ?? null,
    chart: t?.chart ? { kind: t.chart.kind, subject: cut(t.chart.subject, 120), overview: t.chart.overview.map((o) => cut(o, 200)) } : null,
    overview: t ? { status: t.overview.status, note: cut(t.overview.note, 200) } : null,
    keyFeatures: t ? { covered: t.keyFeatures.covered.map((x) => cut(x, 120)), missed: t.keyFeatures.missed.map((x) => cut(x, 120)) } : null,
    dataErrors: (t?.dataErrors ?? []).map((e) => ({ sentenceNo: e.sentence + 1, quote: cut(e.quote, 120), wrote: cut(e.wrote, 120), chartShows: cut(e.correct, 120) })),
    planCheck: t?.ideaCheck
      ? { summary: cut(t.ideaCheck.summary, 200), matched: t.ideaCheck.matched.map((x) => cut(x, 120)), missing: t.ideaCheck.missing.map((x) => cut(x, 120)), wrong: t.ideaCheck.wrong.map((x) => cut(x, 120)) }
      : null,
    modelEssay: m?.comparison
      ? {
          summary: cut(m.comparison.summary, 200),
          points: m.comparison.points.map((p) => ({ area: p.area, yours: cut(p.yours, 120), model: cut(p.model, 160), why: cut(p.why, 160), try: cut(p.try, 160) })),
          phrases: m.vocab.map((v) => ({ phrase: v.phrase, meaning: cut(v.meaning_vi, 80), used: v.used })),
        }
      : null,
  }
}

export const listWorks: CoachTool = {
  name: 'list_works',
  description:
    "The learner's saved work, newest first: Writing reviews (scored essays), Speaking reviews (scored recordings) or Speaking ideas (suggested answers, not scored). Each item has its id (for get_writing_review / get_speaking_review) and href (the in-app page that opens it).",
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: WORK_KINDS },
      from: DAY,
      to: DAY,
      limit: { type: 'integer', description: '1-10, default 10' },
      offset: { type: 'integer' },
    },
    required: ['kind'],
  },
  label: (a) => (a.kind === 'writing' ? 'Listing your Writing reviews…' : a.kind === 'speaking_ideas' ? 'Listing your Speaking ideas…' : 'Listing your Speaking reviews…'),
  async run(args, ctx) {
    const kind = optEnum(args, 'kind', WORK_KINDS, 'writing')
    const from = optDay(args, 'from')
    const to = optDay(args, 'to')
    const limit = optInt(args, 'limit', 1, PAGE, PAGE)
    const offset = optInt(args, 'offset', 0, 10_000, 0)
    let rows: Record<string, unknown>[]
    if (kind === 'writing') {
      rows = (await writingDocs(ctx))
        .filter((r) => inRange(dayOf(r.createdAt), from, to))
        .map((r) => ({ id: r.id, href: workHref('writing', r.id), day: dayOf(r.createdAt), time: timeOf(r.createdAt), title: writingTitle(r), task: taskOf(r), band: r.score?.overall ?? null, fixes: r.fixes.length, errors: errorsOf(r.fixes) }))
    } else if (kind === 'speaking_review') {
      rows = (await talkDocs(ctx))
        .filter((r) => inRange(dayOf(r.createdAt), from, to))
        .map((r) => ({ id: r.id, href: workHref('speaking_review', r.id), day: dayOf(r.createdAt), time: timeOf(r.createdAt), part: r.part, question: talkTitle(r), band: r.overall ?? null, fixes: r.fixes.length, mispronounced: r.misheard?.length ?? 0 }))
    } else {
      rows = (await ideaDocs(ctx))
        .filter((r) => inRange(dayOf(r.createdAt), from, to))
        .map((r) => ({ id: r.id, href: workHref('speaking_ideas', r.id), day: dayOf(r.createdAt), part: r.part, topic: cut(r.topic, 80), questions: r.answers.length }))
    }
    const page = rows.slice(offset, offset + limit)
    return { kind, total: rows.length, items: page, ...(offset + limit < rows.length ? { more: { offset: offset + limit } } : {}) }
  },
}

export const getScores: CoachTool = {
  name: 'get_scores',
  description: 'Band scores of the newest scored Writing or Speaking reviews, per criterion, with averages and the weakest criterion.',
  inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: SCORED_KINDS }, limit: { type: 'integer', description: '1-10, default 5' } }, required: ['kind'] },
  label: (a) => (a.kind === 'speaking_review' ? 'Reading your Speaking scores…' : 'Reading your Writing scores…'),
  async run(args, ctx) {
    const kind = optEnum(args, 'kind', SCORED_KINDS, 'writing')
    const limit = optInt(args, 'limit', 1, 10, 5)
    const rows: { id: string; day: string; task?: number; overall: number; criteria: Record<string, number> }[] = []
    if (kind === 'writing') {
      for (const r of await writingDocs(ctx)) {
        if (!r.score) continue
        rows.push({
          id: r.id,
          day: dayOf(r.createdAt),
          task: taskOf(r),
          overall: r.score.overall,
          criteria: Object.fromEntries(Object.entries(r.score.criteria).map(([k, c]) => [criterionKey(k, r.task), c.band])),
        })
      }
    } else {
      for (const r of await talkDocs(ctx)) {
        if (typeof r.overall !== 'number') continue
        const criteria = Object.fromEntries(Object.entries(r.criteria ?? {}).flatMap(([k, c]) => (typeof c?.band === 'number' ? [[k.toUpperCase(), c.band]] : [])))
        rows.push({ id: r.id, day: dayOf(r.createdAt), overall: r.overall, criteria })
      }
    }
    const items = rows.slice(0, limit)
    // Averages use only the values present (older reviews may miss a criterion).
    const sums = new Map<string, { sum: number; n: number }>()
    for (const r of items) for (const [k, band] of Object.entries(r.criteria)) {
      const s = sums.get(k) ?? { sum: 0, n: 0 }
      sums.set(k, { sum: s.sum + band, n: s.n + 1 })
    }
    const averages = Object.fromEntries([...sums].map(([k, s]) => [k, Math.round((s.sum / s.n) * 10) / 10]))
    const weakest = Object.entries(averages).sort((a, b) => a[1] - b[1])[0]?.[0] ?? null
    const overall = items.length ? Math.round((items.reduce((s, r) => s + r.overall, 0) / items.length) * 10) / 10 : null
    return {
      kind,
      criteriaNames: kind === 'writing' ? { TR: 'Task Response (Task 2)', TA: 'Task Achievement (Task 1)', CC: 'Coherence & Cohesion', LR: 'Lexical Resource', GRA: 'Grammatical Range & Accuracy' } : { FC: 'Fluency & Coherence', LR: 'Lexical Resource', GRA: 'Grammatical Range & Accuracy', PRON: 'Pronunciation' },
      items,
      averageOverall: overall,
      averages,
      weakest,
    }
  },
}

/** Fixes as the model sees them: errors first, short fields. */
function fixRows(fixes: WritingFix[], sentences: string[]) {
  return fixes
    .map((f, i) => ({ f, i }))
    .sort((a, b) => Number(a.f.severity === 'improve') - Number(b.f.severity === 'improve') || a.i - b.i)
    .map(({ f }) => ({
      type: f.type,
      severity: f.severity ?? 'error',
      original: cut(f.original, 120),
      replacement: cut(f.replacement, 120),
      why: cut(f.explanation, 120),
      sentenceNo: f.sentenceIndex + 1,
      sentence: cut(sentences[f.sentenceIndex], 110),
    }))
}

const SENTENCE = { type: 'integer', description: 'only this sentence (1 = first; "câu 3" = 3); with section fixes' }

/** The fixes of a work, or of one sentence (its full text and every fix in it, so "câu 3 sai gì?" needs one call). */
function fixesOf(fixes: WritingFix[], sentences: string[], args: Args) {
  if (args.sentence === undefined || args.sentence === null || args.sentence === '') return page(fixRows(fixes, sentences), args)
  const n = optInt(args, 'sentence', 1, 10_000, 1)
  if (n > sentences.length) throw new ToolError(`The text has ${sentences.length} sentences.`)
  const rows = fixRows(fixes.filter((f) => f.sentenceIndex === n - 1), sentences).map(({ sentence: _s, sentenceNo: _n, ...rest }) => rest)
  return { sentenceNo: n, sentences: sentences.length, sentenceText: cut(sentences[n - 1], 600), fixes: rows, ...(rows.length ? {} : { note: 'No correction in this sentence.' }) }
}

/** Budget for a page of items, leaving room for the head fields inside MAX_RESULT_CHARS. */
const PAGE_CHARS = 3600

/** One page: up to `size` items, fewer if they would not fit; `more.offset` points at the first item left out. */
function page<T>(rows: T[], args: Args, size = PAGE) {
  const offset = optInt(args, 'offset', 0, 10_000, 0)
  let n = Math.min(size, rows.length - offset)
  while (n > 1 && JSON.stringify(rows.slice(offset, offset + n)).length > PAGE_CHARS) n--
  const items = rows.slice(offset, offset + Math.max(0, n))
  const next = offset + items.length
  return { total: rows.length, items, ...(next < rows.length ? { more: { offset: next } } : {}) }
}

function textPage(text: string, args: Args, size = 1500) {
  const offset = optInt(args, 'offset', 0, 1_000_000, 0)
  return { text: text.slice(offset, offset + size), length: text.length, ...(offset + size < text.length ? { more: { offset: offset + size } } : {}) }
}

export const getWritingReview: CoachTool = {
  name: 'get_writing_review',
  description:
    "One scored Writing review by id (task 1 = chart description, task 2 = essay). section: fixes (the corrections, filter by types / severity: error = wrong, improve = correct but weak or unnatural; for unnatural wording use types collocation, naturalness, word choice), score (bands and the one-line reason per criterion; Task 1 has TA instead of TR), prompt (the question), essay (the learner's text, paged), task1 (Task 1 only: overview, key features covered / missed, figures reported wrongly against the chart, the Vietnamese plan checked against the chart, the comparison with the learner's model essay and its phrases).",
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      section: { type: 'string', enum: ['fixes', 'score', 'prompt', 'essay', 'task1'] },
      types: { type: 'array', items: { type: 'string', enum: FIX_TYPES } },
      severity: { type: 'string', enum: ['error', 'improve', 'all'] },
      sentence: SENTENCE,
      offset: { type: 'integer' },
    },
    required: ['id', 'section'],
  },
  label: (a) => (a.section === 'score' ? 'Reading the essay’s scores…' : a.section === 'fixes' ? 'Reading the essay’s corrections…' : 'Opening the essay…'),
  async run(args, ctx) {
    if (!validWorkId(args.id)) throw new ToolError('Unknown id. Use list_works to find Writing review ids.')
    const r = (await writingDocs(ctx)).find((x) => x.id === args.id)
    if (!r) throw new ToolError('Unknown id. Use list_works to find Writing review ids.')
    const section = optEnum(args, 'section', ['fixes', 'score', 'prompt', 'essay', 'task1'] as const, 'fixes')
    const head = { id: r.id, href: workHref('writing', r.id), day: dayOf(r.createdAt), time: timeOf(r.createdAt), title: writingTitle(r), task: taskOf(r) }
    if (section === 'fixes') {
      const types = optEnumList(args, 'types', FIX_TYPES)
      const severity = optEnum(args, 'severity', ['error', 'improve', 'all'] as const, 'all')
      const fixes = r.fixes.filter((f) => (!types.length || types.includes(f.type)) && (severity === 'all' || (f.severity ?? 'error') === severity))
      return { ...head, ...fixesOf(fixes, r.sentences, args) }
    }
    if (section === 'score') {
      if (!r.score) {
        const note =
          r.scoreSkipped === 'short' ? 'Not scored: under 150 words.' : r.scoreSkipped === 'task1' ? 'Not scored: reviewed before Task 1 scoring existed.' : 'Not scored.'
        return { ...head, score: null, note }
      }
      return {
        ...head,
        overall: r.score.overall,
        words: r.score.words,
        criteria: Object.fromEntries(Object.entries(r.score.criteria).map(([k, c]) => [criterionKey(k, r.task), { band: c.band, next: cut(c.summary, 200) }])),
      }
    }
    if (section === 'task1') {
      if (r.task !== 1) return { ...head, note: 'Not a Task 1 review: the task1 section exists only for Writing Task 1 (charts).' }
      return { ...head, task1: task1Section(r) }
    }
    if (section === 'prompt') return { ...head, prompt: cut(r.prompt, 600), questionType: r.questionType ?? null, topic: r.topic ?? null, words: r.score?.words ?? null }
    return { ...head, ...textPage(r.text, args) }
  },
}

export const getSpeakingReview: CoachTool = {
  name: 'get_speaking_review',
  description:
    'One scored Speaking review (a recording) by id. section: fixes (corrections of what was said), score (bands per criterion), pronunciation (words heard wrongly, with IPA and a tip), transcript (paged).',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' }, section: { type: 'string', enum: ['fixes', 'score', 'pronunciation', 'transcript'] }, sentence: SENTENCE, offset: { type: 'integer' } },
    required: ['id', 'section'],
  },
  label: (a) => (a.section === 'pronunciation' ? 'Checking your pronunciation…' : a.section === 'score' ? 'Reading the recording’s scores…' : 'Opening the Speaking review…'),
  async run(args, ctx) {
    if (!validWorkId(args.id)) throw new ToolError('Unknown id. Use list_works with kind speaking_review.')
    const r = (await talkDocs(ctx)).find((x) => x.id === args.id)
    if (!r) throw new ToolError('Unknown id. Use list_works with kind speaking_review.')
    const section = optEnum(args, 'section', ['fixes', 'score', 'pronunciation', 'transcript'] as const, 'fixes')
    const head = { id: r.id, href: workHref('speaking_review', r.id), day: dayOf(r.createdAt), time: timeOf(r.createdAt), part: r.part, question: talkTitle(r) }
    if (section === 'fixes') return { ...head, ...fixesOf(r.fixes, r.sentences, args) }
    if (section === 'score')
      return {
        ...head,
        overall: r.overall ?? null,
        criteria: Object.fromEntries(Object.entries(r.criteria ?? {}).map(([k, c]) => [k.toUpperCase(), { band: c?.band ?? null, next: cut(c?.summary, 200) }])),
      }
    if (section === 'pronunciation')
      return { ...head, ...page((r.misheard ?? []).map((m) => ({ heard: cut(m.heard, 60), meant: cut(m.meant, 60), ipa: cut(m.ipa, 60), tip: cut(m.tip, 120) })), args, 20) }
    return { ...head, ...textPage(r.transcript, args) }
  },
}
