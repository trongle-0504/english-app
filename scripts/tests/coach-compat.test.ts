// Compatibility tests written before the coach touches shared code (PLAN-study-coach §12.4): they record what the
// planner and practice routes do today, so the Phase 2 refactors (C2, C3) must keep them green.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ApiContext, ApiRequest } from '../../server/api.ts'
import { taskFromBody } from '../../server/planner/store.ts'
import { adminRoutes } from '../../server/routes/admin.ts'
import { analyzeRoutes } from '../../server/routes/analyze.ts'
import { authRoutes } from '../../server/routes/auth.ts'
import { coachRoutes } from '../../server/routes/coach.ts'
import { essayRoutes } from '../../server/routes/essays.ts'
import { ideaRoutes } from '../../server/routes/idea.ts'
import { listeningRoutes } from '../../server/routes/listening.ts'
import { lookupRoutes } from '../../server/routes/lookup.ts'
import { newsRoutes } from '../../server/routes/news.ts'
import { notepadRoutes } from '../../server/routes/notepad.ts'
import { plannerRoutes } from '../../server/routes/planner.ts'
import { practiceRoutes } from '../../server/routes/practice.ts'
import { reportRoutes } from '../../server/routes/report.ts'
import { reviewRoutes } from '../../server/routes/review.ts'
import { speakingMockRoutes } from '../../server/routes/speaking-mock.ts'
import { speakingReviewRoutes } from '../../server/routes/speaking-review.ts'
import { speakingRoutes } from '../../server/routes/speaking.ts'
import { translateRoutes } from '../../server/routes/translate.ts'
import { ttsRoutes } from '../../server/routes/tts.ts'
import { writingReviewRoutes } from '../../server/routes/writing-review.ts'
import { routes } from '../../server/routes.ts'
import { featureOf } from '../../server/usage.ts'

const req = (body: unknown, query = ''): ApiRequest => ({
  method: 'POST',
  path: '/',
  query: new URLSearchParams(query),
  headers: {},
  body,
  rawBody: Buffer.alloc(0),
  incoming: {} as ApiRequest['incoming'],
})

function tempCtx(): ApiContext & { cleanup: () => void; planner: () => { tasks: { id: string; title: string; date: string; time?: string; movedFrom?: string; source: string }[] } } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'coach-compat-'))
  return {
    rootDir: root,
    contentDir: path.join(root, 'content'),
    onContentChange: () => {},
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    planner: () => JSON.parse(readFileSync(path.join(root, 'progress', 'planner', 'planner.json'), 'utf8')),
  }
}

test('T-COMPAT-01: task sources — known kept, unknown becomes manual', () => {
  const now = '2026-11-08T00:00:00.000Z'
  assert.equal(taskFromBody({ title: 'A', date: '2026-11-08', source: 'quick-add' }, now).source, 'quick-add')
  assert.equal(taskFromBody({ title: 'A', date: '2026-11-08', source: 'weird' }, now).source, 'manual')
  assert.equal(taskFromBody({ title: 'A', date: '2026-11-08' }, now).source, 'manual')
})

test('T-COMPAT-02: POST /planner/tasks — saves valid lists, refuses empty, too long and bad items', async () => {
  const ctx = tempCtx()
  const create = plannerRoutes['POST /planner/tasks']
  try {
    const res = (await create(req({ tasks: [{ title: 'Writing', date: '2026-11-09', time: '19:00', skill: 'writing' }, { title: 'Read', date: '2026-11-10' }] }), ctx)) as {
      json: { tasks: { title: string }[] }
    }
    assert.deepEqual(res.json.tasks.map((t) => t.title), ['Writing', 'Read'])
    assert.deepEqual(ctx.planner().tasks.map((t) => [t.title, t.date, t.time ?? '']), [['Writing', '2026-11-09', '19:00'], ['Read', '2026-11-10', '']])
    await assert.rejects(async () => create(req({ tasks: [] }), ctx), { status: 400, message: 'Send 1–60 tasks.' })
    await assert.rejects(async () => create(req({ tasks: Array.from({ length: 61 }, () => ({ title: 'x', date: '2026-11-09' })) }), ctx), { status: 400 })
    await assert.rejects(async () => create(req({ tasks: ['nope'] }), ctx), { status: 400, message: 'Each task must be an object.' })
    await assert.rejects(async () => create(req({ tasks: [{ title: '', date: '2026-11-09' }] }), ctx), { status: 400 })
    await assert.rejects(async () => create(req('not an object'), ctx), { status: 400 })
    assert.equal(ctx.planner().tasks.length, 2)
  } finally {
    ctx.cleanup()
  }
})

test('T-COMPAT-03: POST /planner/reschedule/apply — moves, drops, ignores unknown ids, refuses bad dates', async () => {
  const ctx = tempCtx()
  try {
    const created = (await plannerRoutes['POST /planner/tasks'](
      req({ tasks: [{ title: 'A', date: '2026-11-05', time: '08:00' }, { title: 'B', date: '2026-11-05' }, { title: 'C', date: '2026-11-06' }] }),
      ctx,
    )) as { json: { tasks: { id: string }[] } }
    const [a, b, c] = created.json.tasks.map((t) => t.id)
    const apply = plannerRoutes['POST /planner/reschedule/apply']
    const res = (await apply(req({ moves: [{ taskId: a, date: '2026-11-09', time: '' }, { taskId: 'ghost', date: '2026-11-09' }], drop: [b] }), ctx)) as { json: unknown }
    assert.deepEqual(res.json, { moved: 1, dropped: 1 })
    const tasks = ctx.planner().tasks
    assert.deepEqual(tasks.map((t) => [t.id, t.date, t.time ?? '', t.movedFrom ?? '']), [[a, '2026-11-09', '', '2026-11-05'], [c, '2026-11-06', '', '']])
    await assert.rejects(async () => apply(req({ moves: [{ taskId: c, date: '9 Nov' }] }), ctx), { status: 400 })
    assert.equal(ctx.planner().tasks.find((t) => t.id === c)?.date, '2026-11-06')
  } finally {
    ctx.cleanup()
  }
})

test('T-COMPAT-04: POST /practice/cards — the request checks', async () => {
  const ctx = tempCtx()
  const cards = practiceRoutes['POST /practice/cards']
  const saved = process.env.ADMIN_TOKEN
  delete process.env.ADMIN_TOKEN
  try {
    await assert.rejects(async () => cards(req({ phrases: [] }), ctx), { status: 400 })
    await assert.rejects(async () => cards(req({ from: { kind: 'essay', id: 'abc123' }, phrases: [{ term: 'x', group: 'collocation' }] }), ctx), {
      status: 400,
      message: '`from` must be { kind: speaking | writing, id }.',
    })
    await assert.rejects(async () => cards(req({ from: { kind: 'writing', id: 'abc123' }, phrases: [] }), ctx), { status: 400, message: '`phrases`: 1–50 phrases.' })
    await assert.rejects(
      async () => cards(req({ from: { kind: 'writing', id: 'abc123' }, phrases: Array.from({ length: 51 }, () => ({ term: 'x', group: 'collocation' })) }), ctx),
      { status: 400, message: '`phrases`: 1–50 phrases.' },
    )
    await assert.rejects(async () => cards(req({ from: { kind: 'writing', id: 'abc123' }, phrases: [{ term: 'x' }] }), ctx), {
      status: 400,
      message: 'phrases[0] needs a term and a group.',
    })
  } finally {
    if (saved !== undefined) process.env.ADMIN_TOKEN = saved
    ctx.cleanup()
  }
})

test('T-COMPAT-05: usage feature names', () => {
  assert.equal(featureOf('coach'), 'Coach')
  assert.equal(featureOf('writing-review: judge'), 'Writing Review')
  assert.equal(featureOf('something-new: x'), 'something-new')
})

test('T-COMPAT-06: the route table — no module overwrites another, the coach adds only /coach/* keys', () => {
  const modules = [
    authRoutes,
    coachRoutes,
    analyzeRoutes,
    adminRoutes,
    reviewRoutes,
    practiceRoutes,
    lookupRoutes,
    notepadRoutes,
    newsRoutes,
    writingReviewRoutes,
    speakingRoutes,
    speakingMockRoutes,
    speakingReviewRoutes,
    ttsRoutes,
    translateRoutes,
    ideaRoutes,
    essayRoutes,
    reportRoutes,
    listeningRoutes,
    plannerRoutes,
  ]
  const all = modules.flatMap((m) => Object.keys(m))
  assert.equal(new Set(all).size, all.length, 'a key is defined twice')
  assert.equal(Object.keys(routes).length, all.length + 1) // + GET /health
  for (const key of Object.keys(coachRoutes)) assert.match(key, /^(GET|POST|DELETE) \/coach\//)
  for (const key of all) assert.ok(key in routes, key)
})

test('R-06: COACH_ENABLED=0 switches the coach off without a code change', async () => {
  const saved = process.env.COACH_ENABLED
  process.env.COACH_ENABLED = '0'
  const ctx = tempCtx()
  try {
    const status = (await coachRoutes['GET /coach/status'](req(undefined), ctx)) as { json: { enabled: boolean } }
    assert.equal(status.json.enabled, false)
    await assert.rejects(async () => coachRoutes['GET /coach/sessions'](req(undefined), ctx), { status: 404 })
    await assert.rejects(async () => coachRoutes['POST /coach/turn'](req({ sessionId: 'x', text: 'hi' }), ctx), { status: 404 })
  } finally {
    if (saved === undefined) delete process.env.COACH_ENABLED
    else process.env.COACH_ENABLED = saved
    ctx.cleanup()
  }
})
