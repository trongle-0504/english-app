// Phase 2 proposals end to end (fake agent → real MCP call → proposal on the turn → Confirm) and Phase 3 pure parts:
// T-PROP-01…08, proposal news in the next header, library outcomes, Admin stats, page context, suggestions.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ApiError, type ApiContext } from '../../server/api.ts'
import { AcpClient } from '../../server/coach/acp.ts'
import type { LibraryWriter } from '../../server/coach/library-job.ts'
import { pageContext, proposalNews, turnHeader } from '../../server/coach/preamble.ts'
import { CoachService } from '../../server/coach/service.ts'
import { createTasks } from '../../server/planner/actions.ts'
import { suggestionsFor } from '../../src/features/coach/suggestions.ts'
import type { CoachTurn } from '../../src/types/coach.ts'

const FAKE = path.join(import.meta.dirname, 'helpers', 'fake-acp-agent.ts')
const NOW = new Date('2026-11-08T03:00:00.000Z') // 10:00 VN, Sunday

function setup(opts: { writeLibrary?: LibraryWriter } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'coach-prop-'))
  const logFile = path.join(root, 'fake.log')
  process.env.FAKE_ACP_LOG = logFile
  // One scored essay, so the mistake book has items.
  const writing = path.join(root, 'progress', 'writing-reviews')
  mkdirSync(writing, { recursive: true })
  const fix = (type: string, severity: string, original: string, replacement: string) => ({
    id: `${type}-${original}`,
    sentenceIndex: 0,
    original,
    replacement,
    type,
    severity,
    explanation: `why ${original}`,
    evidence: 'meaning',
    dictionary: [],
  })
  writeFileSync(
    path.join(writing, 'mw6kmvdx-bab436.json'),
    JSON.stringify({
      id: 'mw6kmvdx-bab436',
      createdAt: '2026-11-07T15:41:41.349Z',
      title: 'Essay',
      durationMs: 1,
      text: 'A large number of the population agree.',
      sentences: ['A large number of the population agree.'],
      correctedSentences: [],
      corrected: '',
      fixes: [fix('collocation', 'error', 'a large number of the population', 'a large proportion of the population'), fix('collocation', 'improve', 'selection', 'choice')],
      warnings: [],
      natural: [],
      upgrades: [],
      protected: [],
      recheck: [],
      checked: { total: 0, confirmed: 0 },
      usage: {},
    }),
  )
  const ctx: ApiContext = { rootDir: root, contentDir: path.join(root, 'content'), onContentChange: () => {} }
  const acp = new AcpClient({ command: process.execPath, args: [FAKE], cwd: path.join(root, 'agent-cwd') })
  const coach = new CoachService({ rootDir: root, contentDir: ctx.contentDir, acp, now: () => NOW, config: { turnTimeoutMs: 20_000 }, record: () => {}, writeLibrary: opts.writeLibrary })
  const ask = async (sessionId: string, text: string): Promise<CoachTurn> => {
    const turnId = await coach.startTurn(sessionId, text, '/')
    for (let i = 0; i < 300; i++) {
      const poll = await coach.getTurn(sessionId, turnId)
      if (poll.done) return poll.turn
      await new Promise((r) => setTimeout(r, 30))
    }
    throw new Error('turn did not finish')
  }
  const call = (sessionId: string, tool: string, args: unknown) => ask(sessionId, `CALL ${tool} ${JSON.stringify(args)}`)
  const planner = () => {
    const file = path.join(root, 'progress', 'planner', 'planner.json')
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { tasks: { id: string; title: string; date: string; time?: string; source: string; movedFrom?: string }[] }).tasks : []
  }
  const prompts = () =>
    readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
      .filter((e) => e.in?.method === 'session/prompt')
      .map((e) => e.in.params.prompt.at(-1).text as string)
  const cleanup = async () => {
    await coach.stop()
    rmSync(root, { recursive: true, force: true })
  }
  return { root, ctx, coach, ask, call, planner, prompts, cleanup }
}

const rejects = (status: number) => (e: unknown) => (e as { status?: number }).status === status

test('T-PROP-01/02: a bad task is refused; a good proposal is stored on the turn and changes nothing', async () => {
  const s = setup()
  try {
    const sid = await s.coach.createSession()
    const bad = await s.call(sid, 'propose_tasks', { tasks: [{ title: 'Speaking', date: '9 Nov' }] })
    assert.match(bad.answer, /^Error: tasks\[0\]: /)
    assert.equal(bad.proposals, undefined)

    const turn = await s.call(sid, 'propose_tasks', {
      tasks: [
        { title: 'Speaking Part 1', date: '2026-11-10', time: '19:00', durationMin: 30, skill: 'speaking' },
        { title: 'Speaking Part 2', date: '2026-11-10', skill: 'speaking' },
        { title: 'Speaking Part 3', date: '2026-11-10', skill: 'nonsense' },
      ],
    })
    assert.equal(turn.steps[0].tool, 'propose_tasks')
    assert.equal(turn.steps[0].status, 'done')
    assert.match(turn.answer, /"proposalId":"p[0-9a-f]{10}"/)
    assert.match(turn.answer, /Nothing has changed yet/)
    const [p] = turn.proposals ?? []
    assert.equal(p.kind, 'tasks')
    assert.equal(p.status, 'open')
    assert.deepEqual(p.items.map((i) => i.label), ['Speaking Part 1', 'Speaking Part 2', 'Speaking Part 3'])
    assert.equal(p.items[0].detail, 'Tue 10/11 · 19:00 · 30 min · speaking')
    assert.equal(p.items[2].data.skill, 'other')
    assert.deepEqual(s.planner(), [])
    // Saved with the chat (reopening it shows the card).
    assert.equal((await s.coach.getSession(sid)).turns.at(-1)?.proposals?.[0].id, p.id)
  } finally {
    await s.cleanup()
  }
})

test('T-PROP-03/04/05/08: Confirm applies only the kept items, once; another chat → 404; dismissed → 409', async () => {
  const s = setup()
  try {
    const sid = await s.coach.createSession()
    const other = await s.coach.createSession()
    const turn = await s.call(sid, 'propose_tasks', { tasks: ['A', 'B', 'C'].map((title) => ({ title, date: '2026-11-11', skill: 'writing' })) })
    const pid = turn.proposals![0].id
    await assert.rejects(s.coach.applyProposal(s.ctx, other, pid, [0], { authorized: true }), rejects(404))
    await assert.rejects(s.coach.applyProposal(s.ctx, sid, pid, [], { authorized: true }), rejects(400))
    await assert.rejects(s.coach.applyProposal(s.ctx, sid, pid, [0, 7], { authorized: true }), rejects(400))

    const applied = await s.coach.applyProposal(s.ctx, sid, pid, [2, 0], { authorized: true })
    assert.equal(applied.status, 'applied')
    assert.deepEqual(applied.kept, [0, 2])
    assert.equal(applied.result?.summary, '2 tasks added')
    assert.deepEqual(s.planner().map((t) => [t.title, t.source]), [['A', 'coach'], ['C', 'coach']])

    await assert.rejects(s.coach.applyProposal(s.ctx, sid, pid, [1], { authorized: true }), rejects(409))
    assert.equal(s.planner().length, 2)
    assert.equal((await s.coach.getSession(sid)).turns.at(-1)?.proposals?.[0].status, 'applied')

    const again = await s.call(sid, 'propose_tasks', { tasks: [{ title: 'D', date: '2026-11-12' }] })
    const pid2 = again.proposals![0].id
    await s.coach.dismissProposal(sid, pid2)
    await assert.rejects(s.coach.applyProposal(s.ctx, sid, pid2, [0], { authorized: true }), rejects(409))
    assert.equal(s.planner().length, 2)
  } finally {
    await s.cleanup()
  }
})

test('the next question tells the coach what the learner confirmed or dismissed, once', async () => {
  const s = setup()
  try {
    const sid = await s.coach.createSession()
    const turn = await s.call(sid, 'propose_tasks', { tasks: [{ title: 'A', date: '2026-11-11' }, { title: 'B', date: '2026-11-11' }] })
    await s.coach.applyProposal(s.ctx, sid, turn.proposals![0].id, [1], { authorized: true })
    await s.ask(sid, 'thanks')
    await s.ask(sid, 'and now?')
    const [, second, third] = s.prompts()
    assert.match(second, /\[app\] since your last answer the learner confirmed “Add 2 tasks to your plan” \(1 of 2: 1 task added\)/)
    assert.doesNotMatch(third, /since your last answer/)
  } finally {
    await s.cleanup()
  }
})

test('T-PROP-06: unknown task ids are skipped with a note; Confirm moves the rest', async () => {
  const s = setup()
  try {
    const [a, b] = await createTasks(s.ctx, [
      { title: 'Read', date: '2026-11-10', time: '08:00' },
      { title: 'Write', date: '2026-11-10' },
    ])
    const sid = await s.coach.createSession()
    const none = await s.call(sid, 'propose_moves', { moves: [{ taskId: 'ghost', date: '2026-11-11' }] })
    assert.match(none.answer, /^Error: No task to move/)
    const turn = await s.call(sid, 'propose_moves', {
      moves: [
        { taskId: a.id, date: '2026-11-11', time: '09:00' },
        { taskId: 'ghost', date: '2026-11-11' },
        { taskId: b.id, date: '2026-11-11' },
      ],
    })
    const p = turn.proposals![0]
    assert.equal(p.items.length, 2)
    assert.equal(p.items[0].detail, 'Tue 10/11 08:00 → Wed 11/11 09:00')
    assert.deepEqual(p.notes, ['Unknown task ghost — skipped.'])
    assert.equal(s.planner().find((t) => t.id === a.id)?.date, '2026-11-10')
    const applied = await s.coach.applyProposal(s.ctx, sid, p.id, undefined, { authorized: true })
    assert.equal(applied.result?.summary, '2 tasks moved')
    const moved = s.planner().find((t) => t.id === a.id)!
    assert.deepEqual([moved.date, moved.time, moved.movedFrom], ['2026-11-11', '09:00', '2026-11-10'])
  } finally {
    await s.cleanup()
  }
})

test('T-PROP-07: review cards from the mistake book need the admin token like the app’s own button', async () => {
  const s = setup()
  const saved = process.env.ADMIN_TOKEN
  try {
    const sid = await s.coach.createSession()
    const turn = await s.call(sid, 'propose_review_cards', {
      mistakes: [
        { wrong: 'A large number of the population', right: 'a large proportion of the population' },
        { wrong: 'made up', right: 'never seen' },
      ],
    })
    const p = turn.proposals![0]
    assert.equal(p.kind, 'review-cards')
    assert.deepEqual(p.items.map((i) => i.label), ['a large number of the population → a large proportion of the population'])
    assert.equal(p.items[0].data.key, 'collocation|a large number of the population|a large proportion of the population')
    assert.equal(p.notes?.length, 1)
    // A phrase that is not in the library needs the work it came from.
    const noWork = await s.call(sid, 'propose_review_cards', { phrases: [{ term: 'heavy traffic' }] })
    assert.match(noWork.answer, /^Error: Nothing to add\. “heavy traffic” is not in the library and no from_id/)

    await assert.rejects(s.coach.applyProposal(s.ctx, sid, p.id, [0], { authorized: false }), rejects(401))
    assert.equal(p.status, 'open')
    const applied = await s.coach.applyProposal(s.ctx, sid, p.id, [0], { authorized: true })
    assert.equal(applied.result?.summary, '1 card added to your reviews')
    const state = JSON.parse(readFileSync(path.join(s.root, 'progress', 'review.json'), 'utf8')) as { cards: Record<string, unknown> }
    assert.equal(Object.keys(state.cards).filter((id) => id.startsWith('custom:so-loi:')).length, 1)
  } finally {
    if (saved === undefined) delete process.env.ADMIN_TOKEN
    else process.env.ADMIN_TOKEN = saved
    await s.cleanup()
  }
})

test('library proposals: Confirm starts a server job; progress, 409 = already there, errors, in-app links only', async () => {
  const written: string[] = []
  const s = setup({
    writeLibrary: async (_ctx, item) => {
      written.push(`${item.target}|${item.phrase}|${item.meaning_vi ?? ''}|${item.example ?? ''}`)
      await new Promise((r) => setTimeout(r, 20))
      if (item.phrase === 'have little choice but to') throw new ApiError(409, 'already in Notes')
      if (item.phrase === 'boom') throw new Error('Gemini did not answer')
      return { label: `Vocabulary › Transport › ${item.phrase}`, href: item.phrase === 'evil' ? '//evil.example' : `/vocabulary/transport#${item.phrase.replace(/ /g, '-')}`, cardId: `vocab:${item.phrase}` }
    },
  })
  try {
    const sid = await s.coach.createSession()
    const bad = await s.call(sid, 'propose_library_add', { items: [{ target: 'vocabulary' }] })
    assert.match(bad.answer, /^Error: items\[0\] needs target/)
    const turn = await s.call(sid, 'propose_library_add', {
      items: [
        { target: 'vocabulary', phrase: 'heavy traffic', meaning_vi: 'giao thông đông đúc', example: 'There was heavy traffic.' },
        { target: 'note', phrase: 'have little choice but to' },
        { target: 'vocabulary', phrase: 'Heavy  Traffic' },
        { target: 'vocabulary', phrase: 'boom' },
        { target: 'vocabulary', phrase: 'evil' },
      ],
    })
    const p = turn.proposals![0]
    assert.equal(p.title, 'Add 4 entries to your library')
    assert.deepEqual(p.items.map((i) => i.label), ['heavy traffic', 'have little choice but to', 'boom', 'evil'])
    assert.equal(p.items[0].detail, 'Vocabulary · giao thông đông đúc · “There was heavy traffic.”')
    assert.deepEqual(p.items[1].data, { target: 'note', phrase: 'have little choice but to' })
    assert.equal(written.length, 0, 'nothing is written before Confirm')

    await assert.rejects(s.coach.applyProposal(s.ctx, sid, p.id, [0], { authorized: false }), rejects(401))
    const started = await s.coach.applyProposal(s.ctx, sid, p.id, [0, 1, 2, 3], { authorized: true })
    assert.equal(started.status, 'applying')
    assert.equal(started.progress?.length, 4)
    await assert.rejects(s.coach.applyProposal(s.ctx, sid, p.id, [0], { authorized: true }), rejects(409))

    let now = started
    for (let i = 0; i < 200 && now.status === 'applying'; i++) {
      await new Promise((r) => setTimeout(r, 20))
      now = await s.coach.getProposal(sid, p.id)
    }
    assert.equal(now.status, 'applied')
    assert.deepEqual(now.progress?.map((r) => r.status), ['done', 'skipped', 'error', 'done'])
    assert.deepEqual(written[0], 'vocabulary|heavy traffic|giao thông đông đúc|There was heavy traffic.')
    assert.equal(now.result?.summary, '2 entries saved to your library · 1 already there')
    assert.deepEqual(now.result?.links, [{ label: 'Vocabulary › Transport › heavy traffic', href: '/vocabulary/transport#heavy-traffic' }])
    assert.deepEqual(now.result?.failed, ['boom: Gemini did not answer'])
    // The next question tells the coach what happened.
    await s.ask(sid, 'ok')
    assert.match(s.prompts().at(-1)!, /confirmed “Add 4 entries to your library” \(4 of 4: 2 entries saved/)
  } finally {
    await s.cleanup()
  }
})

test('library proposals: a job cut off by a restart is reported as interrupted, not left running', async () => {
  const s = setup({ writeLibrary: () => new Promise(() => {}) })
  try {
    const sid = await s.coach.createSession()
    const turn = await s.call(sid, 'propose_library_add', { items: [{ target: 'vocabulary', phrase: 'traffic jam' }] })
    const p = turn.proposals![0]
    assert.equal((await s.coach.applyProposal(s.ctx, sid, p.id, [0], { authorized: true })).status, 'applying')
    assert.equal((await s.coach.getProposal(sid, p.id)).status, 'applying', 'still running in this process')
    // A new process (server restart) finds it "applying" with no job behind it.
    const restarted = new CoachService({ rootDir: s.root, contentDir: s.ctx.contentDir, now: () => NOW, record: () => {} })
    const settled = await restarted.getProposal(sid, p.id)
    assert.equal(settled.status, 'applied')
    assert.deepEqual(settled.progress?.map((r) => r.status), ['error'])
    assert.match(settled.result?.failed?.[0] ?? '', /^traffic jam: interrupted by a server restart/)
  } finally {
    await s.cleanup()
  }
})

test('quiz cards, sentence lookups and Admin stats', async () => {
  const s = setup()
  try {
    const sid = await s.coach.createSession()
    const quiz = await s.call(sid, 'get_due_cards', { limit: 3 })
    assert.deepEqual(JSON.parse(quiz.answer), { dueToday: 0, items: [], reviewHref: '/review' })
    const sentence = await s.call(sid, 'get_writing_review', { id: 'mw6kmvdx-bab436', section: 'fixes', sentence: 1 })
    const body = JSON.parse(sentence.answer)
    assert.equal(body.sentenceText, 'A large number of the population agree.')
    assert.deepEqual(body.fixes.map((f: { original: string }) => f.original), ['a large number of the population', 'selection'])
    const tooFar = await s.call(sid, 'get_writing_review', { id: 'mw6kmvdx-bab436', section: 'fixes', sentence: 4 })
    assert.equal(tooFar.answer, 'Error: The text has 1 sentences.')
    await s.call(sid, 'propose_tasks', { tasks: [{ title: 'A', date: '2026-11-11' }] })
    const [today] = await s.coach.stats()
    assert.equal(today.day, '2026-11-08')
    assert.equal(today.turns, 4)
    assert.equal(today.proposals, 1)
    assert.equal(today.applied, 0)
    assert.ok(today.medianMs > 0)
  } finally {
    await s.cleanup()
  }
})

test('Phase 3: the header names the open review; suggestions follow the page', () => {
  assert.equal(pageContext('/practice/writing-review?id=mw6kmvdx-bab436'), 'open: Writing review id mw6kmvdx-bab436 (“this essay / bài này” = it)')
  assert.equal(pageContext('/practice/speaking-review?id=mw5reryb-536fc8&x=1'), 'open: Speaking review id mw5reryb-536fc8 (“this recording / bài này” = it)')
  assert.equal(pageContext('/practice/writing-review?id=../../etc'), 'open: Writing practice')
  assert.equal(pageContext('/planner'), 'open: the Planner')
  assert.equal(pageContext('/somewhere'), '')
  assert.equal(pageContext(undefined), '')
  assert.match(turnHeader({ nowLabel: 'x', page: '/planner', overview: 'o' }), /^\[app\] now x · page \/planner \(open: the Planner\)\n\[app\] overview: o$/)
  assert.equal(proposalNews([]), '')
  assert.equal(
    proposalNews([
      { title: 'Move 2 tasks', status: 'dismissed', items: [1, 2] },
      { title: 'Add 1 card', status: 'open', items: [1] },
    ]),
    '[app] since your last answer the learner dismissed “Move 2 tasks”; has not confirmed “Add 1 card” yet (nothing changed)',
  )
  assert.match(suggestionsFor('/practice/writing-review', '?id=abc123')[0], /this essay/)
  assert.match(suggestionsFor('/practice/writing-review', '')[0], /mistakes do I make/)
  assert.match(suggestionsFor('/planner', '').join(' '), /Move my overdue tasks/)
  assert.match(suggestionsFor('/review', '')[0], /Quiz me/)
})
