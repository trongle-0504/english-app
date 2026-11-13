// The warm `agy acp` pool for one-shot AI calls (server/llm/acp-pool.ts) against the scripted fake agent (no AI):
// starts on the first real call only (that call goes through agy -p), one session per call, stops when idle but never
// while a call runs, falls back (null) on a crash and replaces the process, and can be switched off.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { WarmAgentPool, type WarmEvent } from '../../server/llm/acp-pool.ts'
import { acceptable, parseStructured } from '../../server/llm/antigravity-cli.ts'

const FAKE = path.join(import.meta.dirname, 'helpers', 'fake-acp-agent.ts')

function pool(opts: { idleMs?: number; enabled?: boolean; maxTurns?: number } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'warm-pool-'))
  const logFile = path.join(root, 'fake.log')
  writeFileSync(logFile, '')
  process.env.FAKE_ACP_LOG = logFile
  const events: WarmEvent[] = []
  const p = new WarmAgentPool({
    command: process.execPath,
    args: [FAKE],
    cwd: path.join(root, 'cwd'),
    idleMs: () => opts.idleMs ?? 60_000,
    enabled: () => opts.enabled ?? true,
    maxTurns: opts.maxTurns,
    timeoutMs: () => 10_000,
    onEvent: (e) => events.push(e),
  })
  const received = () =>
    readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l).in)
      .filter(Boolean)
  return { p, events, received }
}

const until = async (check: () => boolean, ms = 5000) => {
  for (let waited = 0; !check(); waited += 20) {
    if (waited > ms) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 20))
  }
}

test('nothing starts until a real call; the first call goes to agy -p (null) while the agent starts', async () => {
  const { p, events } = pool()
  assert.equal(p.running, false, 'not started by creating the pool (server start, page open)')
  assert.equal(await p.run('first', 'hello', 'gemini-3.8-flash-low'), null)
  assert.equal(p.running, true)
  await until(() => p.ready)
  assert.deepEqual(events.map((e) => e.event), ['start'])
  assert.match(events[0].reason, /first AI call \(first\)/)
  const turn = await p.run('second', 'hello', 'gemini-3.8-flash-low')
  assert.equal(turn?.text, 'ok')
  assert.equal(turn?.usage?.inputTokens, 8000)
  p.stop('test', true)
})

test('every call opens its own session with its own model and closes it', async () => {
  const { p, received } = pool()
  await p.run('a', 'x', 'm')
  await until(() => p.ready)
  await Promise.all([p.run('b', 'one', 'gemini-3.8-flash-low'), p.run('c', 'two', 'gemini-3.8-flash-medium')])
  await new Promise((r) => setTimeout(r, 50))
  const msgs = received()
  const created = msgs.filter((m) => m.method === 'session/new')
  assert.equal(created.length, 2)
  for (const m of created) assert.deepEqual(m.params.mcpServers, [], 'no MCP server attached')
  assert.deepEqual(msgs.filter((m) => m.method === 'session/set_model').map((m) => m.params.modelId).sort(), ['gemini-3.8-flash-low', 'gemini-3.8-flash-medium'])
  const prompted = new Set(msgs.filter((m) => m.method === 'session/prompt').map((m) => m.params.sessionId))
  assert.equal(prompted.size, 2, 'no session is reused')
  assert.deepEqual(new Set(msgs.filter((m) => m.method === 'session/close').map((m) => m.params.sessionId)), prompted)
  p.stop('test', true)
})

test('stops after the idle time, never while a call runs, and the next call starts it again', async () => {
  const { p, events } = pool({ idleMs: 300 })
  await p.run('a', 'x', 'm')
  await until(() => p.ready)
  // SLOW takes ~5 s in the fake agent: far beyond the idle time, and the agent must stay up.
  const slow = p.run('slow', 'SLOW', 'm')
  await new Promise((r) => setTimeout(r, 800))
  assert.equal(p.running, true, 'not stopped while a call runs')
  assert.equal((await slow)?.text, 'slow done')
  await until(() => !p.running, 3000)
  assert.equal(events.at(-1)?.event, 'stop')
  assert.match(events.at(-1)!.reason, /idle/)
  assert.equal(await p.run('again', 'x', 'm'), null, 'after the stop the next call is again an agy -p call')
  await until(() => p.ready)
  p.stop('test', true)
})

test('a crash mid-turn falls back (null) and the process is replaced', async () => {
  const { p, events } = pool()
  await p.run('a', 'x', 'm')
  await until(() => p.ready)
  assert.equal(await p.run('crash', 'CRASH', 'm'), null)
  assert.ok(events.some((e) => e.event === 'fallback'))
  assert.ok(events.some((e) => e.event === 'restart'))
  await until(() => p.ready)
  assert.equal((await p.run('after', 'x', 'm'))?.text, 'ok')
  p.stop('test', true)
})

test('restarts while idle after maxTurns', async () => {
  const { p, events } = pool({ maxTurns: 2 })
  await p.run('a', 'x', 'm')
  await until(() => p.ready)
  await p.run('1', 'x', 'm')
  await p.run('2', 'x', 'm')
  assert.ok(events.some((e) => e.event === 'restart' && /2 turns/.test(e.reason)))
  p.stop('test', true)
})

test('ANTIGRAVITY_WARM=off: never starts', async () => {
  const { p } = pool({ enabled: false })
  assert.equal(await p.run('a', 'x', 'm'), null)
  assert.equal(p.running, false)
})

test('answers from the warm agent are parsed like agy -p answers and checked before use', () => {
  assert.deepEqual(parseStructured('Here:\n```json\n{"lemma":"decision","headwords":["decision"]}\n```'), { lemma: 'decision', headwords: ['decision'] })
  assert.deepEqual(parseStructured('{"why": "say "a lot" here"}'), { why: 'say "a lot" here' })
  assert.equal(parseStructured('⚠ API error (attempt 1): UNAVAILABLE'), undefined)
  const schema = { required: ['lemma', 'headwords'] }
  assert.equal(acceptable({ lemma: 'x', headwords: [] }, schema), true)
  assert.equal(acceptable({ lemma: 'x' }, schema), false)
  assert.equal(acceptable(undefined, schema), false)
  assert.equal(acceptable({ a: 1 }, schema, (v) => 'a' in (v as object)), true)
})
