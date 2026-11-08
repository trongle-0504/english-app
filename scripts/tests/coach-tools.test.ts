// Coach tools on fixture data (no AI): T-TOOL-01…10.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { dayOf, fit, ToolError, type ToolContext } from '../../server/coach/data.ts'
import { appToolName, overview, COACH_TOOLS } from '../../server/coach/tools/index.ts'
import { fold, searchEntries, type LibraryEntry } from '../../server/coach/tools/library.ts'
import { summarizeMistakes } from '../../server/coach/tools/mistakes.ts'
import { getPlan } from '../../server/coach/tools/plan.ts'
import { getScores, getSpeakingReview, getWritingReview, listWorks, workHref } from '../../server/coach/tools/works.ts'
import type { MistakeItem } from '../../src/types/practice.ts'

function fixtureRoot(): ToolContext & { cleanup: () => void } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'coach-tools-'))
  const writing = path.join(root, 'progress', 'writing-reviews')
  const talks = path.join(root, 'progress', 'speaking-reviews')
  mkdirSync(writing, { recursive: true })
  mkdirSync(talks, { recursive: true })
  const fix = (type: string, severity: string, original: string, replacement: string, sentenceIndex = 0) => ({
    id: `${type}-${original}`,
    sentenceIndex,
    original,
    replacement,
    type,
    severity,
    explanation: `why ${original}`,
    evidence: 'meaning',
    dictionary: [],
  })
  const essay = (id: string, createdAt: string, fixes: unknown[], score?: unknown) => ({
    id,
    createdAt,
    title: `Essay ${id}`,
    durationMs: 1,
    text: 'First sentence. Second sentence.',
    sentences: ['First sentence about the population.', 'Second sentence.'],
    correctedSentences: [],
    corrected: '',
    fixes,
    warnings: [],
    natural: [],
    upgrades: [],
    protected: [],
    recheck: [],
    checked: { total: 0, confirmed: 0 },
    usage: {},
    ...(score ? { score } : {}),
  })
  writeFileSync(
    path.join(writing, 'mw6kmvdx-bab436.json'),
    JSON.stringify(
      essay(
        'mw6kmvdx-bab436',
        '2026-11-07T15:41:41.349Z',
        [
          fix('collocation', 'improve', 'selection', 'choice'),
          fix('grammar', 'error', 'numerous of tasks', 'numerous tasks', 1),
          fix('collocation', 'error', 'a large number of the population', 'a large proportion of the population'),
          fix('naturalness', 'improve', 'does nothing about', 'fails to address'),
          fix('word choice', 'improve', 'bigger causes', 'main contributors'),
        ],
        { overall: 7, words: 280, questionGiven: true, reviewer: 'x', criteria: { tr: { band: 7, summary: 's' }, cc: { band: 7, summary: 's' }, lr: { band: 6, summary: 's' }, gra: { band: 7, summary: 's' } } },
      ),
    ),
  )
  // Saved at 06:30 VN on 2026-11-08 (23:30 UTC the day before).
  writeFileSync(path.join(writing, 'late-night-01.json'), JSON.stringify(essay('late-night-01', '2026-11-07T23:30:00.000Z', [])))
  const talk = (id: string, createdAt: string, overall: number | undefined, criteria: Record<string, unknown>) => ({
    id,
    createdAt,
    durationMs: 1,
    part: 1,
    question: `Question ${id}`,
    audio: false,
    transcript: 'I like it.',
    words: [{ w: 'heavy' }],
    sentences: ['I like it.'],
    correctedSentences: [],
    corrected: '',
    fixes: [],
    warnings: [],
    fluency: {},
    criteria,
    misheard: [{ sentence: 0, heard: 'tree', meant: 'three', ipa: '/θriː/', tip: 'lưỡi giữa răng', start: 0, end: 0 }],
    ...(overall === undefined ? {} : { overall }),
    reviewer: 'x',
  })
  writeFileSync(path.join(talks, 'talk-aaaa01.json'), JSON.stringify(talk('talk-aaaa01', '2026-11-06T10:00:00Z', 6, { fc: { band: 6 }, lr: { band: 6 }, gra: { band: 5 }, pron: { band: 6 } })))
  writeFileSync(path.join(talks, 'talk-aaaa02.json'), JSON.stringify(talk('talk-aaaa02', '2026-11-07T10:00:00Z', 7, { fc: { band: 7 }, lr: { band: 7 } })))
  mkdirSync(path.join(root, 'progress', 'planner'), { recursive: true })
  writeFileSync(
    path.join(root, 'progress', 'planner', 'planner.json'),
    JSON.stringify({
      version: 1,
      tasks: [
        { id: 't1', title: 'Writing Task 2', date: '2026-11-08', time: '19:00', skill: 'writing', durationMin: 60, source: 'manual', createdAt: 'x', updatedAt: 'x' },
        { id: 't2', title: 'Old listening', date: '2026-11-05', skill: 'listening', source: 'manual', createdAt: 'x', updatedAt: 'x' },
      ],
      events: [],
      routine: [],
      settings: {},
    }),
  )
  return { rootDir: root, contentDir: path.join(root, 'content'), now: new Date('2026-11-08T03:00:00Z'), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('T-TOOL-01: the overview names the newest essay with its VN day and band', async () => {
  const ctx = fixtureRoot()
  try {
    const line = await overview(ctx)
    assert.match(line, /^today 2026-11-08 \(Sunday\) 10:00 VN/)
    assert.match(line, /writing reviews: 2, last 2026-11-08 id late-night-01/)
    assert.match(line, /speaking reviews \(recordings\): 2, last 2026-11-07 id talk-aaaa02 band 7/)
    assert.match(line, /plan today: 1 open, 0 done, 1 overdue/)
    assert.ok(line.length <= 600, `${line.length} chars`)
  } finally {
    ctx.cleanup()
  }
})

test('T-TOOL-02: days are VN calendar days', async () => {
  assert.equal(dayOf('2026-11-07T23:30:00.000Z'), '2026-11-08')
  assert.equal(dayOf('2026-11-07T15:41:41.349Z'), '2026-11-07')
  const ctx = fixtureRoot()
  try {
    const r = (await listWorks.run({ kind: 'writing', from: '2026-11-08', to: '2026-11-08' }, ctx)) as { items: { id: string }[] }
    assert.deepEqual(r.items.map((i) => i.id), ['late-night-01'])
    const y = (await listWorks.run({ kind: 'writing', from: '2026-11-07', to: '2026-11-07', toolSummary: 'ignored' }, ctx)) as { items: { id: string; band: number }[] }
    assert.deepEqual(y.items.map((i) => [i.id, i.band]), [['mw6kmvdx-bab436', 7]])
  } finally {
    ctx.cleanup()
  }
})

test('T-TOOL-03: fixes filtered by type, errors before improvements, with the sentence', async () => {
  const ctx = fixtureRoot()
  try {
    const r = (await getWritingReview.run({ id: 'mw6kmvdx-bab436', section: 'fixes', types: ['collocation', 'naturalness', 'word choice'] }, ctx)) as {
      total: number
      items: { type: string; severity: string; original: string; sentence: string }[]
    }
    assert.equal(r.total, 4)
    assert.deepEqual(r.items.map((i) => i.original), ['a large number of the population', 'selection', 'does nothing about', 'bigger causes'])
    assert.equal(r.items[0].severity, 'error')
    assert.equal(r.items[0].sentence, 'First sentence about the population.')
    const errorsOnly = (await getWritingReview.run({ id: 'mw6kmvdx-bab436', section: 'fixes', severity: 'error' }, ctx)) as { total: number }
    assert.equal(errorsOnly.total, 2)
    const score = (await getWritingReview.run({ id: 'mw6kmvdx-bab436', section: 'score' }, ctx)) as { overall: number; criteria: Record<string, { band: number }> }
    assert.equal(score.overall, 7)
    assert.equal(score.criteria.LR.band, 6)
  } finally {
    ctx.cleanup()
  }
})

test('T-TOOL-05: results that are too big are cut and stay valid JSON', () => {
  const big = { items: Array.from({ length: 60 }, (_, i) => ({ n: i, text: 'x'.repeat(80) })) }
  const out = fit(big)
  const json = JSON.stringify(out)
  assert.ok(json.length <= 4000, `${json.length}`)
  assert.equal(out.truncated, true)
  assert.ok((out.items as unknown[]).length < 60)
  assert.deepEqual(JSON.parse(json), out)
  assert.deepEqual(fit({ a: 1 }), { a: 1 })
})

test('T-TOOL-05b: a page holds as many fixes as fit and points at the next one', async () => {
  const ctx = fixtureRoot()
  try {
    const r = (await getWritingReview.run({ id: 'mw6kmvdx-bab436', section: 'fixes' }, ctx)) as { total: number; items: unknown[]; more?: unknown }
    assert.equal(r.total, 5)
    assert.equal(r.items.length, 5)
    assert.equal(r.more, undefined)
    const next = (await getWritingReview.run({ id: 'mw6kmvdx-bab436', section: 'fixes', offset: 3 }, ctx)) as { items: unknown[] }
    assert.equal(next.items.length, 2)
  } finally {
    ctx.cleanup()
  }
})

test('T-TOOL-06: bad and unknown ids are refused before any file access', async () => {
  const ctx = fixtureRoot()
  try {
    await assert.rejects(getWritingReview.run({ id: '../../etc/passwd', section: 'fixes' }, ctx), ToolError)
    await assert.rejects(getWritingReview.run({ id: 'nosuchid-000', section: 'fixes' }, ctx), /Unknown id/)
    await assert.rejects(getSpeakingReview.run({ id: '..', section: 'score' }, ctx), ToolError)
    await assert.rejects(getWritingReview.run({ id: 'mw6kmvdx-bab436', section: 'everything' }, ctx), /section must be one of/)
  } finally {
    ctx.cleanup()
  }
})

const LIB: LibraryEntry[] = [
  { kind: 'collocation', term: 'heavy traffic', meaning_vi: 'giao thông đông đúc', example: 'There was heavy traffic.', href: '/c/1' },
  { kind: 'topic', term: 'traffic congestion', meaning_vi: 'tắc nghẽn giao thông', example: '', href: '/blog' },
  { kind: 'word', term: 'traffic', meaning_vi: 'giao thông', example: '', href: '/v/traffic' },
  { kind: 'word', term: 'trafficking', meaning_vi: 'buôn bán', example: '', href: '/v/t' },
  { kind: 'note', term: 'commute', meaning_vi: 'đi làm', example: 'Long commutes in traffic.', href: '/notes' },
]

test('T-TOOL-07: library search ranks exact, prefix, whole word, inside, then meaning and example', () => {
  assert.deepEqual(
    searchEntries(LIB, 'Traffic', 'any', 8).map((e) => e.term),
    ['traffic', 'traffic congestion', 'trafficking', 'heavy traffic', 'commute'],
  )
  assert.deepEqual(searchEntries(LIB, 'traffic', 'collocation', 8).map((e) => e.term), ['heavy traffic'])
  assert.equal(searchEntries(LIB, 'traffic', 'any', 2).length, 2)
  assert.deepEqual(searchEntries(LIB, '', 'any', 8), [])
})

test('T-TOOL-08: Vietnamese queries match meanings with or without marks', () => {
  assert.equal(fold('Tắc Nghẽn  đường'), 'tac nghen duong')
  assert.deepEqual(searchEntries(LIB, 'tắc nghẽn', 'any', 8).map((e) => e.term), ['traffic congestion'])
  assert.deepEqual(searchEntries(LIB, 'tac nghen', 'any', 8).map((e) => e.term), ['traffic congestion'])
})

test('T-TOOL-09: the plan is read at most 14 days at a time', async () => {
  const ctx = fixtureRoot()
  try {
    await assert.rejects(getPlan.run({ from: '2026-11-01', to: '2026-11-30' }, ctx), /At most 14 days/)
    const r = (await getPlan.run({ from: '2026-11-08', to: '2026-11-08' }, ctx)) as { tasks: { id: string }[]; overdue: { id: string }[]; today: string }
    assert.equal(r.today, '2026-11-08')
    assert.deepEqual(r.tasks.map((t) => t.id), ['t1'])
    assert.deepEqual(r.overdue.map((t) => t.id), ['t2'])
  } finally {
    ctx.cleanup()
  }
})

test('T-TOOL-10: Speaking scores average only the criteria that are present', async () => {
  const ctx = fixtureRoot()
  try {
    const r = (await getScores.run({ kind: 'speaking_review' }, ctx)) as { averages: Record<string, number>; weakest: string; averageOverall: number }
    assert.deepEqual(r.averages, { FC: 6.5, LR: 6.5, GRA: 5, PRON: 6 })
    assert.equal(r.weakest, 'GRA')
    assert.equal(r.averageOverall, 6.5)
    const p = (await getSpeakingReview.run({ id: 'talk-aaaa01', section: 'pronunciation' }, ctx)) as { items: { meant: string; ipa: string }[] }
    assert.deepEqual(p.items[0], { heard: 'tree', meant: 'three', ipa: '/θriː/', tip: 'lưỡi giữa răng' })
  } finally {
    ctx.cleanup()
  }
})

test('T-TOOL-04: mistake summary — counts, two newest examples, repeated mistakes first', () => {
  const item = (key: string, category: MistakeItem['category'], severity: 'error' | 'improve', at: string): MistakeItem => ({
    key,
    kind: 'writing',
    workId: 'w1',
    title: 't',
    at,
    href: '/x',
    category,
    severity,
    sentence: 's',
    wrong: key,
    right: `${key}!`,
    why: 'because',
    dictionary: [],
  })
  const out = summarizeMistakes(
    [
      item('the elderly', 'article', 'error', '2026-11-01T00:00:00Z'),
      item('the elderly', 'article', 'error', '2026-11-05T00:00:00Z'),
      item('a the', 'article', 'error', '2026-11-07T00:00:00Z'),
      item('selection', 'collocation', 'improve', '2026-11-07T00:00:00Z'),
    ],
    6,
  )
  assert.equal(out.total, 4)
  assert.deepEqual(out.categories.map((c) => [c.category, c.errors, c.improves, c.examples.length]), [['article', 3, 0, 2], ['collocation', 0, 1, 1]])
  assert.equal(out.categories[0].examples[0].wrong, 'a the')
  assert.deepEqual(out.repeated, [{ wrong: 'the elderly', right: 'the elderly!', category: 'article', count: 2 }])
})

test('tool names as agy reports them map back to the registry', () => {
  assert.equal(appToolName('mcp_app_82aaed4d_get_writing_review'), 'get_writing_review')
  assert.equal(appToolName('mcp_app_get_mistakes'), 'get_mistakes')
  assert.equal(appToolName('mcp_app_82aaed4d_not_a_tool'), 'mcp_app_82aaed4d_not_a_tool')
  assert.equal(appToolName('run_command'), 'run_command')
})

test('every tool has a schema, a label and a unique name', () => {
  const names = COACH_TOOLS.map((t) => t.name)
  assert.equal(new Set(names).size, names.length)
  for (const t of COACH_TOOLS) {
    assert.equal(t.inputSchema.type, 'object')
    assert.ok(t.description.length > 20)
    assert.equal(typeof t.label({}), 'string')
  }
})

test('T-TOOL: every saved work links to the page that opens it', () => {
  assert.equal(workHref('writing', 'mw6kmvdx-bab436'), '/practice/writing-review?id=mw6kmvdx-bab436')
  assert.equal(workHref('speaking_review', 'abc123'), '/practice/speaking-review?id=abc123')
  assert.equal(workHref('speaking_ideas', 'abc123'), '/practice/speaking-ideas/history?id=abc123')
})
