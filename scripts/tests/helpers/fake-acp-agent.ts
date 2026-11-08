// A scripted stand-in for `agy acp`, for the coach tests (no AI). Every received message is appended to FAKE_ACP_LOG.
// The last text block of a prompt decides what happens:
//   TOOL        → a tool_call for mcp_app_list_works, a real MCP call to the app's server, then "Hello world"
//   PERMISSION  → asks permission to run `ls /`, logs the chosen option, then "denied ok"
//   SLOW        → waits 5 s (or until session/cancel)
//   CRASH       → exits in the middle of the turn
//   otherwise   → "ok"
import { appendFileSync } from 'node:fs'
import readline from 'node:readline'

const LOG = process.env.FAKE_ACP_LOG
const log = (entry: unknown) => LOG && appendFileSync(LOG, `${JSON.stringify(entry)}\n`)
const send = (msg: unknown) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...(msg as object) })}\n`)
const update = (sessionId: string, u: unknown) => send({ method: 'session/update', params: { sessionId, update: u } })

const sessions = new Map<string, { mcp: { url: string; headers: { name: string; value: string }[] }[] }>()
const cancelled = new Set<string>()
const waiting = new Map<string, (value: unknown) => void>()
let counter = 0
const usage = { inputTokens: 8000, outputTokens: 20, cachedReadTokens: 0, cachedWriteTokens: 0, thoughtTokens: 5, totalTokens: 8025 }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function prompt(id: number, params: { sessionId: string; prompt: { type: string; text?: string }[] }) {
  const { sessionId } = params
  const text = [...params.prompt].reverse().find((b) => b.type === 'text')?.text ?? ''
  cancelled.delete(sessionId)
  if (text.includes('CRASH')) {
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial' } })
    await sleep(50)
    process.exit(1)
  }
  if (text.includes('SLOW')) {
    for (let i = 0; i < 50 && !cancelled.has(sessionId); i++) await sleep(100)
    if (cancelled.has(sessionId)) return send({ id, result: { stopReason: 'cancelled', usage } })
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'slow done' } })
    return send({ id, result: { stopReason: 'end_turn', usage } })
  }
  if (text.includes('TOOL')) {
    const mcp = sessions.get(sessionId)?.mcp[0]
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'c1', name: 'mcp_app_1a2b3c4d_list_works', title: 'Run mcp_app_1a2b3c4d_list_works', status: 'in_progress', rawInput: { kind: 'writing', toolSummary: 'x' } })
    if (mcp) {
      const auth = mcp.headers.find((h) => h.name === 'Authorization')?.value ?? ''
      const res = await fetch(mcp.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_works', arguments: { kind: 'writing', toolSummary: 'x' } } }),
      })
      log({ mcpStatus: res.status, mcpBody: await res.text() })
    }
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'c1', name: 'mcp_app_1a2b3c4d_list_works', status: 'completed' })
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } })
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } })
    return send({ id, result: { stopReason: 'end_turn', usage: { ...usage, inputTokens: 15000, totalTokens: 15100 } } })
  }
  if (text.includes('PERMISSION')) {
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'c2', name: 'run_command', title: 'ls /', kind: 'execute', status: 'pending' })
    const answer = await new Promise((resolve) => {
      waiting.set('perm-1', resolve)
      send({ id: 'perm-1', method: 'session/request_permission', params: { sessionId, toolCall: { title: 'ls /', kind: 'execute' }, options: [{ optionId: 'allow', kind: 'allow_once' }, { optionId: 'reject', kind: 'reject_once' }] } })
    })
    log({ permissionAnswer: answer })
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'c2', status: 'failed' })
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'denied ok' } })
    return send({ id, result: { stopReason: 'end_turn', usage } })
  }
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } })
  send({ id, result: { stopReason: 'end_turn', usage } })
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line)
  log({ in: msg })
  if (msg.id !== undefined && !msg.method) return waiting.get(String(msg.id))?.(msg.result)
  switch (msg.method) {
    case 'initialize':
      return send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } })
    case 'session/new': {
      const sessionId = `fake-${process.pid}-${++counter}`
      sessions.set(sessionId, { mcp: msg.params.mcpServers })
      return send({ id: msg.id, result: { sessionId } })
    }
    case 'session/load':
      if (!String(msg.params.sessionId).startsWith('fake-')) return send({ id: msg.id, error: { code: -32000, message: 'unknown session' } })
      sessions.set(msg.params.sessionId, { mcp: msg.params.mcpServers })
      update(msg.params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'REPLAYED HISTORY' } })
      return send({ id: msg.id, result: {} })
    case 'session/set_model':
    case 'session/close':
      return send({ id: msg.id, result: {} })
    case 'session/cancel':
      cancelled.add(msg.params.sessionId)
      return
    case 'session/prompt':
      return void prompt(msg.id, msg.params)
    default:
      if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: 'no' } })
  }
})
