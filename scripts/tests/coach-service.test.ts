// Coach service + ACP client against a scripted fake agent (no AI): T-ACP-01…10, T-STORE-01/02.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AcpClient } from '../../server/coach/acp.ts'
import { allowAppTool, CoachService } from '../../server/coach/service.ts'
import { sessionsDir } from '../../server/coach/store.ts'
import type { UsageEntry } from '../../server/usage.ts'
import type { CoachTurnPoll } from '../../src/types/coach.ts'

const FAKE = path.join(import.meta.dirname, 'helpers', 'fake-acp-agent.ts')

function setup(config: Partial<CoachService['config']> = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'coach-svc-'))
  const cwd = path.join(root, 'agent-cwd')
  const logFile = path.join(root, 'fake.log')
  process.env.FAKE_ACP_LOG = logFile
  const permissions: string[] = []
  const acp = new AcpClient({ command: process.execPath, args: [FAKE], cwd, allow: allowAppTool, onPermission: (p) => permissions.push(`${p.kind}:${p.title}:${p.allowed ? 'allowed' : 'refused'}`) })
  const usage: UsageEntry[] = []
  const coach = new CoachService({ rootDir: root, contentDir: path.join(root, 'content'), acp, config: { turnTimeoutMs: 20_000, ...config }, record: (e) => usage.push(e) })
  const log = () =>
    readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  const done = async (sessionId: string, turnId: string): Promise<CoachTurnPoll> => {
    for (let i = 0; i < 300; i++) {
      const poll = await coach.getTurn(sessionId, turnId)
      if (poll.done) return poll
      await new Promise((r) => setTimeout(r, 30))
    }
    throw new Error('turn did not finish')
  }
  const cleanup = async () => {
    await coach.stop()
    rmSync(root, { recursive: true, force: true })
  }
  return { root, cwd, coach, log, done, usage, permissions, cleanup }
}

test('T-ACP-01/02/10: handshake, MCP over HTTP, steps and text, usage, preamble only on the first prompt', async () => {
  const s = setup()
  try {
    const sid = await s.coach.createSession()
    const first = await s.done(sid, await s.coach.startTurn(sid, 'TOOL please', '/practice'))
    assert.equal(first.turn.status, 'done')
    assert.equal(first.turn.answer, 'Hello world')
    assert.deepEqual(
      first.turn.steps.map((x) => [x.tool, x.label, x.status]),
      [['list_works', 'Listing your Writing reviews…', 'done']],
    )
    assert.equal(first.turn.toolCalls, 1)
    assert.deepEqual(first.turn.usage, { input: 15000, output: 20, thinking: 5, cacheRead: 0, total: 15100 })
    assert.equal(s.usage.length, 1)
    assert.equal(s.usage[0].label, 'coach')
    assert.equal(s.usage[0].total, 15100)

    const second = await s.done(sid, await s.coach.startTurn(sid, 'again'))
    assert.equal(second.turn.answer, 'ok')

    const entries = s.log()
    const created = entries.find((e) => e.in?.method === 'session/new').in.params
    assert.equal(created.cwd, s.cwd)
    assert.equal(created.mcpServers[0].type, 'http')
    assert.match(created.mcpServers[0].url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    assert.match(created.mcpServers[0].headers[0].value, /^Bearer [0-9a-f]{64}$/)
    // The fake agent's real MCP call went through.
    const mcp = entries.find((e) => e.mcpStatus)
    assert.equal(mcp.mcpStatus, 200)
    assert.match(mcp.mcpBody, /"total\\":0/)
    // Instructions only on the first prompt; the [app] header on both.
    const prompts = entries.filter((e) => e.in?.method === 'session/prompt').map((e) => e.in.params.prompt)
    assert.equal(prompts.length, 2)
    assert.equal(prompts[0][0].type, 'resource')
    assert.equal(prompts[1][0].type, 'text')
    for (const p of prompts) assert.match(p.at(-1).text, /^\[app\] now \d{4}-\d{2}-\d{2} \(\w+\) \d{2}:\d{2}( · page \S+)?\n\[app\] overview: today /)
    assert.match(prompts[0].at(-1).text, /page \/practice/)
    // Saved to disk.
    const saved = await s.coach.getSession(sid)
    assert.equal(saved.title, 'TOOL please')
    assert.equal(saved.turns.length, 2)
    assert.equal(saved.turns[0].usage?.total, 15100)
  } finally {
    await s.cleanup()
  }
})

test('T-ACP-03/04: every permission request is rejected', async () => {
  const s = setup()
  try {
    const sid = await s.coach.createSession()
    const poll = await s.done(sid, await s.coach.startTurn(sid, 'PERMISSION'))
    assert.equal(poll.turn.status, 'done')
    assert.equal(poll.turn.answer, 'denied ok')
    assert.deepEqual(s.log().find((e) => e.permissionAnswer).permissionAnswer, { outcome: { outcome: 'selected', optionId: 'reject' } })
    assert.deepEqual(s.permissions, ['execute:ls /:refused'])
    assert.equal(poll.turn.steps[0].status, 'failed')
    assert.match(poll.turn.steps[0].label, /not an app tool/)
  } finally {
    await s.cleanup()
  }
})

test('T-ACP-05: the agent dies mid-turn → error; the next turn restarts it and reloads the session', async () => {
  const s = setup()
  try {
    const sid = await s.coach.createSession()
    await s.done(sid, await s.coach.startTurn(sid, 'hello'))
    const crashed = await s.done(sid, await s.coach.startTurn(sid, 'CRASH now'))
    assert.equal(crashed.turn.status, 'error')
    const next = await s.done(sid, await s.coach.startTurn(sid, 'after'))
    assert.equal(next.turn.status, 'done')
    assert.equal(next.turn.answer, 'ok') // the replayed history of session/load is not shown
    const methods = s.log().filter((e) => e.in?.method).map((e) => e.in.method)
    assert.equal(methods.filter((m) => m === 'initialize').length, 2)
    assert.ok(methods.includes('session/load'))
  } finally {
    await s.cleanup()
  }
})

test('T-ACP-06: a turn over the time limit is cancelled; the chat still works', async () => {
  const s = setup({ turnTimeoutMs: 300 })
  try {
    const sid = await s.coach.createSession()
    const slow = await s.done(sid, await s.coach.startTurn(sid, 'SLOW'))
    assert.equal(slow.turn.status, 'error')
    assert.match(slow.turn.error ?? '', /too long/)
    assert.ok(s.log().some((e) => e.in?.method === 'session/cancel'))
    const next = await s.done(sid, await s.coach.startTurn(sid, 'fine'))
    assert.equal(next.turn.status, 'done')
  } finally {
    await s.cleanup()
  }
})

test('T-ACP-07 and cancel: one turn at a time per chat; Stop cancels', async () => {
  const s = setup()
  try {
    const sid = await s.coach.createSession()
    const turnId = await s.coach.startTurn(sid, 'SLOW')
    await assert.rejects(s.coach.startTurn(sid, 'second'), /still answering/)
    await new Promise((r) => setTimeout(r, 200))
    s.coach.cancelTurn(sid, turnId)
    const poll = await s.done(sid, turnId)
    assert.equal(poll.turn.status, 'cancelled')
  } finally {
    await s.cleanup()
  }
})

test('T-ACP-08: with maxRunning 1 a second chat waits for the first', async () => {
  const s = setup({ maxRunning: 1 })
  try {
    const a = await s.coach.createSession()
    const b = await s.coach.createSession()
    const ta = await s.coach.startTurn(a, 'SLOW')
    const tb = await s.coach.startTurn(b, 'quick')
    await new Promise((r) => setTimeout(r, 300))
    assert.equal((await s.coach.getTurn(b, tb)).turn.status, 'queued')
    s.coach.cancelTurn(a, ta)
    const pb = await s.done(b, tb)
    assert.equal(pb.turn.status, 'done')
    await s.done(a, ta)
  } finally {
    await s.cleanup()
  }
})

test('limits: empty, too long, unknown chat, rate limit', async () => {
  const s = setup({ maxTurnsPerHour: 1 })
  try {
    const sid = await s.coach.createSession()
    await assert.rejects(s.coach.startTurn(sid, '   '), /Type a question/)
    await assert.rejects(s.coach.startTurn(sid, 'x'.repeat(8001)), /At most 8000/)
    await assert.rejects(s.coach.startTurn('nosuchchat000', 'hi'), /Chat not found/)
    await s.done(sid, await s.coach.startTurn(sid, 'one'))
    await assert.rejects(s.coach.startTurn(sid, 'two'), /Too many questions/)
  } finally {
    await s.cleanup()
  }
})

test('T-STORE-01/02: chats older than 30 days are deleted; newer ones stay', async () => {
  const now = new Date('2026-11-08T03:00:00Z')
  const root = mkdtempSync(path.join(os.tmpdir(), 'coach-ret-'))
  const coach = new CoachService({ rootDir: root, contentDir: root, now: () => now, acp: new AcpClient({ command: process.execPath, args: [FAKE], cwd: path.join(root, 'cwd') }) })
  try {
    mkdirSync(sessionsDir(root), { recursive: true })
    const write = (id: string, daysAgo: number) =>
      writeFileSync(
        path.join(sessionsDir(root), `${id}.json`),
        JSON.stringify({ version: 1, id, title: id, model: 'm', createdAt: now.toISOString(), updatedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(), turns: [] }),
      )
    write('oldchat000001', 31)
    write('newchat000001', 29)
    assert.equal(await coach.sweep(), 1)
    await assert.rejects(coach.getSession('oldchat000001'), /Chat not found/)
    assert.equal((await coach.getSession('newchat000001')).id, 'newchat000001')
    assert.deepEqual((await coach.listSessions()).map((x) => x.id), ['newchat000001'])
  } finally {
    await coach.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('T-ACP-05: only the coach\'s own MCP tools are allowed (agy asks before each MCP call when sandboxed)', async () => {
  const s = setup()
  try {
    const sid = await s.coach.createSession()
    for (const title of ['Run mcp_app_get_plan', 'Run mcp_app_82aaed4d_propose_library_add', 'Run mcp_app_write_file', 'Run mcp_other_get_plan', 'Run mcp_app_get_plan; ls /', 'Write .env']) {
      const turnId = await s.coach.startTurn(sid, `PERMISSION ${title}`)
      await s.done(sid, turnId)
    }
    assert.deepEqual(s.permissions, [
      'other:Run mcp_app_get_plan:allowed',
      'other:Run mcp_app_82aaed4d_propose_library_add:allowed',
      'other:Run mcp_app_write_file:refused',
      'other:Run mcp_other_get_plan:refused',
      'other:Run mcp_app_get_plan; ls /:refused',
      'other:Write .env:refused',
    ])
    const answers = s.log().filter((e) => e.permissionAnswer).map((e) => e.permissionAnswer.outcome.optionId)
    assert.deepEqual(answers, ['allow', 'allow', 'reject', 'reject', 'reject', 'reject'])
  } finally {
    await s.cleanup()
  }
})

test('allowAppTool: exact app tool names only', () => {
  assert.equal(allowAppTool({ title: 'Run mcp_app_search_library' }), true)
  assert.equal(allowAppTool({ name: 'mcp_app_1a2b3c4d_get_mistakes' }), true)
  assert.equal(allowAppTool({ title: 'Run read_file' }), false)
  assert.equal(allowAppTool({ title: 'mcp_app_get_plan' }), false)
  assert.equal(allowAppTool({ title: 'Run mcp_app_get_plan x' }), false)
  assert.equal(allowAppTool({}), false)
})
