// The coach's MCP listener over real HTTP on 127.0.0.1: T-MCP-01…06.
import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolError } from '../../server/coach/data.ts'
import { CoachMcpServer } from '../../server/coach/mcp.ts'
import type { CoachTool } from '../../server/coach/tools/types.ts'

const echo: CoachTool = {
  name: 'echo',
  description: 'Echo the text back, for tests.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  label: () => 'Echoing…',
  async run(args) {
    if (typeof args.text !== 'string') throw new ToolError('text is required.')
    return { text: args.text }
  },
}
const boom: CoachTool = { ...echo, name: 'boom', run: async () => Promise.reject(new Error('disk on fire /secret/path')) }

async function withServer(fn: (s: CoachMcpServer, url: string, token: string, calls: unknown[]) => Promise<void>) {
  const server = new CoachMcpServer({ tools: [echo, boom], context: () => ({ rootDir: '/x', contentDir: '/x', now: new Date() }) })
  const url = await server.start()
  const calls: unknown[] = []
  const token = server.register({ sessionId: 'abc', onCall: (c) => calls.push(c) })
  try {
    await fn(server, url, token, calls)
  } finally {
    await server.stop()
  }
}

/** The JSON-RPC replies these tests read. */
interface Rpc {
  result: {
    protocolVersion: string
    capabilities: unknown
    tools: { name: string; inputSchema: { type: string } }[]
    content: { text: string }[]
    isError?: boolean
  }
  error: { code: number }
}
const read = async (res: Response) => (await res.json()) as Rpc

const rpc = (url: string, token: string | null, method: string, params: unknown = {}, id: number | null = 1) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params }),
  })

test('T-MCP-01/02: initialize and tools/list', async () => {
  await withServer(async (_s, url, token) => {
    const init = await read(await rpc(url, token, 'initialize', { protocolVersion: '2025-03-26' }))
    assert.equal(init.result.protocolVersion, '2025-03-26')
    assert.deepEqual(init.result.capabilities, { tools: {} })
    assert.equal((await rpc(url, token, 'notifications/initialized', {}, null)).status, 202)
    const list = await read(await rpc(url, token, 'tools/list'))
    assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name), ['echo', 'boom'])
    assert.equal(list.result.tools[0].inputSchema.type, 'object')
  })
})

test('T-MCP-03/05: no token, a wrong token or a revoked token → 401 and nothing runs', async () => {
  await withServer(async (s, url, token, calls) => {
    assert.equal((await rpc(url, null, 'tools/call', { name: 'echo', arguments: { text: 'x' } })).status, 401)
    assert.equal((await rpc(url, 'f'.repeat(64), 'tools/call', { name: 'echo', arguments: { text: 'x' } })).status, 401)
    s.revoke(token)
    assert.equal((await rpc(url, token, 'tools/call', { name: 'echo', arguments: { text: 'x' } })).status, 401)
    assert.equal(calls.length, 0)
  })
})

test('T-MCP-04: tool calls — result, unknown tool, bad arguments, a crash without leaking details', async () => {
  await withServer(async (_s, url, token, calls) => {
    const ok = await read(await rpc(url, token, 'tools/call', { name: 'echo', arguments: { text: 'hi', toolSummary: 'extra key' } }))
    assert.deepEqual(JSON.parse(ok.result.content[0].text), { text: 'hi' })
    const unknown = await read(await rpc(url, token, 'tools/call', { name: 'nope', arguments: {} }))
    assert.equal(unknown.result.isError, true)
    const bad = await read(await rpc(url, token, 'tools/call', { name: 'echo', arguments: {} }))
    assert.equal(bad.result.content[0].text, 'Error: text is required.')
    const crash = await read(await rpc(url, token, 'tools/call', { name: 'boom', arguments: {} }))
    assert.equal(crash.result.isError, true)
    assert.doesNotMatch(crash.result.content[0].text, /secret/)
    const missing = await read(await rpc(url, token, 'resources/list'))
    assert.equal(missing.error.code, -32601)
    assert.equal(calls.length, 4)
  })
})

test('T-MCP-06: only POST /mcp on 127.0.0.1', async () => {
  await withServer(async (s, url, token) => {
    assert.equal(s.address()?.address, '127.0.0.1')
    const base = url.replace(/\/mcp$/, '')
    assert.equal((await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).status, 404)
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status, 404)
    assert.equal((await rpc(`${base}/other`, token, 'tools/list')).status, 404)
  })
})
