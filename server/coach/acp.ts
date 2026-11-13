// A small Agent Client Protocol client for `agy acp` (JSON-RPC over stdio). One long-lived process serves every coach
// session. Every permission request is rejected except, when `allow` says so, the coach's own MCP tools.
// The process starts on first use, restarts after a crash, and stops after an idle period. The real agy always runs in
// the bubblewrap sandbox (server/llm/agy-sandbox.ts): it cannot see the project, .env or the real ~/.gemini.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { sandboxedAgy, type AgyProfile } from '../llm/agy-sandbox.ts'

export interface AcpUsage {
  inputTokens?: number
  outputTokens?: number
  thoughtTokens?: number
  cachedReadTokens?: number
  totalTokens?: number
}

export interface AcpPromptResult {
  stopReason: string
  usage?: AcpUsage
}

/** A `session/update` payload (only the fields the coach reads). */
export interface AcpUpdate {
  sessionUpdate: string
  content?: { type?: string; text?: string }
  toolCallId?: string
  name?: string
  title?: string
  kind?: string
  status?: string
  rawInput?: Record<string, unknown>
  args?: Record<string, unknown>
}

export interface AcpMcpServer {
  type: 'http'
  name: string
  url: string
  headers: { name: string; value: string }[]
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'resource'; resource: { uri: string; mimeType: string; text: string } }

export interface AcpClientOptions {
  /** A fake agent command (tests only; run as given, without the sandbox). Default: the sandboxed agy. */
  command?: string
  /** The agent's arguments; default ['acp']. */
  args?: string[]
  /** The sandbox home of the real agy: 'coach' (default) or 'llm' (the warm pool). */
  profile?: AgyProfile
  /** The agent's working directory: kept empty (agy reads files in its workspace without asking). */
  cwd?: string
  idleMs?: number
  /** Called for every permission request (already rejected). */
  onPermission?: (info: { sessionId: string; title?: string; kind?: string; allowed: boolean }) => void
  /**
   * The only requests ever allowed: agy (sandboxed, default settings) asks before each MCP tool call ("Run
   * mcp_app_get_plan"); the coach allows exactly its own app tools. Everything else (files, shell…) is rejected.
   */
  allow?: (info: { title?: string; kind?: string; name?: string }) => boolean
}

export const EMPTY_CWD = path.join(os.tmpdir(), 'english-app-coach', 'empty')

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class AcpClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private listeners = new Map<string, (update: AcpUpdate) => void>()
  /** Sessions this process knows (created or loaded since it started). */
  private live = new Set<string>()
  /** Sessions being loaded: their replayed history is not forwarded. */
  private loading = new Set<string>()
  private running = 0
  private idleTimer: NodeJS.Timeout | null = null
  private generation = 0
  private readonly opts: AcpClientOptions
  /** What `initialize` returned: the agent's capabilities (prompt content types it accepts…). */
  agentCapabilities: { promptCapabilities?: { image?: boolean; embeddedContext?: boolean; audio?: boolean } } | null = null

  constructor(opts: AcpClientOptions = {}) {
    this.opts = opts
  }

  get cwd(): string {
    return this.opts.cwd ?? EMPTY_CWD
  }

  /** The running agent's process id, if any. */
  get pid(): number | undefined {
    return this.child?.pid
  }

  isLive(sessionId: string): boolean {
    return this.live.has(sessionId)
  }

  /** Starts the process and runs `initialize` (once per process). */
  async ensure(): Promise<void> {
    if (this.child) return
    if (this.starting) return this.starting
    this.starting = this.start().finally(() => (this.starting = null))
    return this.starting
  }

  private async start(): Promise<void> {
    mkdirSync(this.cwd, { recursive: true })
    const args = this.opts.args ?? ['acp']
    const run = this.opts.command ? { command: this.opts.command, args } : sandboxedAgy(args, { profile: this.opts.profile ?? 'coach', cwd: this.cwd })
    const child = spawn(run.command, run.args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    const generation = ++this.generation
    this.child = child
    child.stderr.on('data', () => {})
    child.on('error', (error) => this.onExit(generation, `cannot start the agent: ${error.message}`))
    child.on('exit', (code, signal) => this.onExit(generation, `the agent stopped (${signal ?? code})`))
    readline.createInterface({ input: child.stdout }).on('line', (line) => this.onLine(line))
    const init = await this.request<{ agentCapabilities?: AcpClient['agentCapabilities'] }>('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    })
    this.agentCapabilities = init?.agentCapabilities ?? null
  }

  private onExit(generation: number, reason: string) {
    if (generation !== this.generation || !this.child) return
    this.child = null
    this.live.clear()
    this.loading.clear()
    for (const p of this.pending.values()) p.reject(new Error(reason))
    this.pending.clear()
  }

  private send(msg: Record<string, unknown>) {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
  }

  private request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!this.child) return Promise.reject(new Error('the agent is not running'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.send({ id, method, params })
    })
  }

  private onLine(line: string) {
    let msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } }
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.id !== undefined && !msg.method) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      return msg.error ? p.reject(new Error(msg.error.message ?? 'agent error')) : p.resolve(msg.result)
    }
    if (msg.method === 'session/update') {
      const sessionId = String(msg.params?.sessionId ?? '')
      if (this.loading.has(sessionId)) return
      this.listeners.get(sessionId)?.(msg.params?.update as AcpUpdate)
      return
    }
    if (msg.method === 'session/request_permission') {
      const params = msg.params as { sessionId?: string; toolCall?: { title?: string; kind?: string; name?: string }; options?: { optionId: string; kind: string }[] }
      const options = params.options ?? []
      const call = { title: params.toolCall?.title, kind: params.toolCall?.kind, name: params.toolCall?.name }
      const allowOnce = options.find((o) => o.kind === 'allow_once')
      const allowed = Boolean(allowOnce && this.opts.allow?.(call))
      const reject = options.find((o) => o.kind === 'reject_once') ?? options.find((o) => o.kind.startsWith('reject'))
      this.opts.onPermission?.({ sessionId: params.sessionId ?? '', title: call.title, kind: call.kind, allowed })
      const choice = allowed ? allowOnce : reject
      this.send(choice ? { id: msg.id, result: { outcome: { outcome: 'selected', optionId: choice.optionId } } } : { id: msg.id, result: { outcome: { outcome: 'cancelled' } } })
      return
    }
    // File system / terminal requests from the agent: never served.
    if (msg.method && msg.id !== undefined) this.send({ id: msg.id, error: { code: -32601, message: 'Not supported by this client.' } })
  }

  async newSession(mcpServers: AcpMcpServer[]): Promise<string> {
    await this.ensure()
    const result = await this.request<{ sessionId: string }>('session/new', { cwd: this.cwd, mcpServers })
    this.live.add(result.sessionId)
    return result.sessionId
  }

  /** Reopens a session after a restart; false when the agent no longer has it. */
  async loadSession(sessionId: string, mcpServers: AcpMcpServer[]): Promise<boolean> {
    await this.ensure()
    this.loading.add(sessionId)
    try {
      await this.request('session/load', { sessionId, cwd: this.cwd, mcpServers })
      this.live.add(sessionId)
      return true
    } catch {
      return false
    } finally {
      this.loading.delete(sessionId)
    }
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.request('session/set_model', { sessionId, modelId })
  }

  /** Runs one prompt; updates for the session go to `onUpdate` until it returns. */
  async prompt(sessionId: string, prompt: ContentBlock[], onUpdate: (update: AcpUpdate) => void): Promise<AcpPromptResult> {
    await this.ensure()
    this.running++
    this.clearIdle()
    this.listeners.set(sessionId, onUpdate)
    try {
      return await this.request<AcpPromptResult>('session/prompt', { sessionId, prompt })
    } finally {
      this.listeners.delete(sessionId)
      this.running--
      this.armIdle()
    }
  }

  cancel(sessionId: string): void {
    this.send({ method: 'session/cancel', params: { sessionId } })
  }

  /** Best effort: forget the session on the agent's side. */
  async close(sessionId: string): Promise<void> {
    this.live.delete(sessionId)
    if (!this.child) return
    await this.request('session/close', { sessionId }).catch(() => {})
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private armIdle() {
    this.clearIdle()
    if (this.running) return
    this.idleTimer = setTimeout(() => this.stop(), this.opts.idleMs ?? 15 * 60_000)
    this.idleTimer.unref()
  }

  /** Stops the process (its whole group): SIGTERM, then SIGKILL. */
  stop(): void {
    this.clearIdle()
    const child = this.child
    if (!child?.pid) return
    this.onExit(this.generation, 'stopped')
    const kill = (sig: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, sig)
      } catch {
        child.kill(sig)
      }
    }
    kill('SIGTERM')
    setTimeout(() => child.exitCode === null && child.signalCode === null && kill('SIGKILL'), 3000).unref()
  }
}
