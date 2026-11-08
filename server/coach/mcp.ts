// The app's MCP server for the coach: JSON-RPC over HTTP on 127.0.0.1 only (not under /api, so the login gate is
// untouched). Each coach session gets its own bearer token; agy sends it on every call. Anything but POST /mcp → 404
// (agy also probes /.well-known/oauth-protected-resource without a token).
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { fit, ToolError, type ToolContext } from './data.ts'
import type { CoachTool } from './tools/types.ts'

/** What a token unlocks, and who is told about each call. */
export interface McpBinding {
  sessionId: string
  /** Called before a tool runs (counting, step labels) and after (result size, error). */
  onCall?: (call: { tool: string; args: Record<string, unknown>; ok: boolean; ms: number; chars: number; error?: string }) => void
}

export interface McpServerOptions {
  tools: CoachTool[]
  /** The tool context for a call; `binding` says which chat it belongs to. */
  context: (binding: McpBinding) => ToolContext
  /** Max request body, bytes. */
  maxBody?: number
}

const PROTOCOL = '2025-06-18'

export class CoachMcpServer {
  private server: http.Server | null = null
  private tokens = new Map<string, McpBinding>()
  private readonly opts: McpServerOptions

  constructor(opts: McpServerOptions) {
    this.opts = opts
  }

  /** Starts the listener once; returns its URL. */
  async start(): Promise<string> {
    if (this.server) return this.url()
    const server = http.createServer((req, res) => void this.handle(req, res))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    server.unref()
    this.server = server
    return this.url()
  }

  url(): string {
    const address = this.server?.address() as AddressInfo | null
    if (!address) throw new Error('MCP server not started.')
    return `http://127.0.0.1:${address.port}/mcp`
  }

  address(): AddressInfo | null {
    return (this.server?.address() as AddressInfo | null) ?? null
  }

  /** A new token for a coach session. */
  register(binding: McpBinding): string {
    const token = randomBytes(32).toString('hex')
    this.tokens.set(token, binding)
    return token
  }

  revoke(token: string): void {
    this.tokens.delete(token)
  }

  revokeSession(sessionId: string): void {
    for (const [token, b] of this.tokens) if (b.sessionId === sessionId) this.tokens.delete(token)
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.tokens.clear()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const end = (status: number, body?: unknown) => {
      res.statusCode = status
      if (body === undefined) return res.end()
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST' || req.url?.split('?')[0] !== '/mcp') return end(404)
    const auth = String(req.headers.authorization ?? '')
    const binding = auth.startsWith('Bearer ') ? this.tokens.get(auth.slice(7)) : undefined
    if (!binding) return end(401)
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (raw.length > (this.opts.maxBody ?? 64_000)) return end(413)
    }
    let msg: { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, unknown> }
    try {
      msg = JSON.parse(raw)
    } catch {
      return end(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    }
    // Notifications get no body.
    if (msg.id === undefined || msg.id === null) return end(202)
    const reply = (result: unknown) => end(200, { jsonrpc: '2.0', id: msg.id, result })
    const fail = (code: number, message: string) => end(200, { jsonrpc: '2.0', id: msg.id, error: { code, message } })

    if (msg.method === 'initialize') {
      const asked = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : PROTOCOL
      return reply({ protocolVersion: asked, capabilities: { tools: {} }, serverInfo: { name: 'english-app-coach', version: '1' } })
    }
    if (msg.method === 'ping') return reply({})
    if (msg.method === 'tools/list') return reply({ tools: this.opts.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
    if (msg.method === 'tools/call') {
      const name = String(msg.params?.name ?? '')
      const args = (msg.params?.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {}) as Record<string, unknown>
      const tool = this.opts.tools.find((t) => t.name === name)
      const started = Date.now()
      if (!tool) {
        binding.onCall?.({ tool: name, args, ok: false, ms: 0, chars: 0, error: 'unknown tool' })
        return reply({ content: [{ type: 'text', text: `Error: unknown tool ${name}.` }], isError: true })
      }
      try {
        const text = JSON.stringify(fit(await tool.run(args, this.opts.context(binding))))
        binding.onCall?.({ tool: name, args, ok: true, ms: Date.now() - started, chars: text.length })
        return reply({ content: [{ type: 'text', text }] })
      } catch (error) {
        const message = error instanceof ToolError ? error.message : 'The tool failed. Try a simpler request.'
        if (!(error instanceof ToolError)) console.error(`[coach] tool ${name} failed:`, error)
        binding.onCall?.({ tool: name, args, ok: false, ms: Date.now() - started, chars: 0, error: message })
        return reply({ content: [{ type: 'text', text: `Error: ${message}` }], isError: true })
      }
    }
    return fail(-32601, `Method not found: ${msg.method}`)
  }
}
