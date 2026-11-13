// A warm `agy acp` process for one-shot AI calls (antigravityJson / antigravityText), so the calls after the first skip
// the CLI start-up an `agy -p` spawn costs (S ≈ 3 s measured on this machine). Rules (admin-generate-speed plan, 5.3):
// - It starts on the first real AI call only — never when a page opens, a field is typed into, or the server starts.
//   That first call itself still runs through `agy -p` while the process starts in the background.
// - Every call opens a fresh session, sets its own model + effort ("gemini-3.8-flash-low"), sends one prompt and closes
//   the session: nothing carries over between tasks. The session's folder is empty, no MCP server is attached and every
//   permission request is refused; agy runs in the bubblewrap sandbox (agy-sandbox.ts, profile "llm"). Coach keeps its
//   own process (it needs MCP tools).
// - One process serves parallel sessions (measured: 3 at once fine); the ANTIGRAVITY_PARALLEL queue around the call
//   still caps how many run together.
// - It stops after ANTIGRAVITY_WARM_IDLE_MS (30 min) with no call, never while a call runs; restarts when idle after
//   ~200 turns or 6 h; a crash, hang or unusable answer makes the caller fall back to `agy -p`, and the process is replaced.
// - ANTIGRAVITY_WARM=off turns the whole thing off.
import os from 'node:os'
import path from 'node:path'
import { AcpClient, type AcpUsage } from '../coach/acp.ts'

export interface WarmEvent {
  event: 'start' | 'stop' | 'restart' | 'fallback'
  reason: string
  turns?: number
  ageMs?: number
}

export interface WarmPoolOptions {
  /** Agent command and args (tests pass a fake agent). */
  command?: string
  args?: string[]
  cwd?: string
  idleMs?: () => number
  maxTurns?: number
  maxAgeMs?: number
  timeoutMs?: () => number
  enabled?: () => boolean
  onEvent?: (event: WarmEvent) => void
}

export interface WarmTurn {
  text: string
  usage?: AcpUsage
  ms: number
}

export const warmEnabled = () => (process.env.ANTIGRAVITY_WARM ?? 'on').toLowerCase() !== 'off'
export const warmIdleMs = () => Number(process.env.ANTIGRAVITY_WARM_IDLE_MS) || 30 * 60_000

/** Agent text that is really an error report ("⚠ API error (attempt 3/3)…"): treated as a failed turn. */
const AGENT_ERROR = /^\s*⚠\s*(API error|Error)\b/i

export class WarmAgentPool {
  private client: AcpClient | null = null
  private starting: Promise<void> | null = null
  private startedAt = 0
  private turns = 0
  private active = 0
  private idleTimer: NodeJS.Timeout | null = null
  private readonly opts: WarmPoolOptions

  constructor(opts: WarmPoolOptions = {}) {
    this.opts = opts
  }

  private get enabled() {
    return (this.opts.enabled ?? warmEnabled)()
  }

  /** The process is up and initialised: a call can go through it. */
  get ready(): boolean {
    return Boolean(this.client?.pid) && !this.starting
  }

  get running(): boolean {
    return Boolean(this.client?.pid) || Boolean(this.starting)
  }

  private event(e: WarmEvent) {
    this.opts.onEvent?.(e)
  }

  /** Starts the process in the background (no-op when it runs or is starting). */
  private startInBackground(reason: string) {
    if (!this.enabled || this.running) return
    const client = new AcpClient({
      command: this.opts.command,
      args: this.opts.args,
      cwd: this.opts.cwd ?? path.join(os.tmpdir(), 'english-app-antigravity-warm', 'empty'),
      profile: 'llm',
      // The pool keeps its own idle clock; this only guards against a forgotten process.
      idleMs: 24 * 60 * 60_000,
      onPermission: (p) => console.warn(`[antigravity-warm] refused agent permission: ${p.kind ?? '?'} ${p.title ?? ''}`),
    })
    this.client = client
    this.turns = 0
    this.startedAt = Date.now()
    this.starting = client
      .ensure()
      .then(() => {
        this.event({ event: 'start', reason })
        this.armIdle()
      })
      .catch((error: Error) => {
        console.warn('[antigravity-warm] could not start agy acp:', error.message)
        if (this.client === client) this.client = null
        client.stop()
      })
      .finally(() => {
        this.starting = null
      })
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  /** The idle clock restarts after every call; it never fires while a call runs. */
  private armIdle() {
    this.clearIdle()
    if (this.active || !this.client) return
    this.idleTimer = setTimeout(() => this.stop(`idle ${Math.round((this.opts.idleMs ?? warmIdleMs)() / 60_000)} min`), (this.opts.idleMs ?? warmIdleMs)())
    this.idleTimer.unref?.()
  }

  /** Stops the process (when no call runs, unless `force`). */
  stop(reason: string, force = false): void {
    if (!this.client || (this.active && !force)) return
    const client = this.client
    this.event({ event: 'stop', reason, turns: this.turns, ageMs: Date.now() - this.startedAt })
    this.client = null
    this.clearIdle()
    client.stop()
  }

  /** A failed or hung turn: drop the process and start a fresh one in the background. */
  private replace(reason: string) {
    const client = this.client
    if (!client) return
    this.event({ event: 'restart', reason, turns: this.turns, ageMs: Date.now() - this.startedAt })
    this.client = null
    this.clearIdle()
    client.stop()
    this.startInBackground(`replaced after: ${reason}`)
  }

  /**
   * Runs one prompt through the warm process. Returns null when it is not used — off, not started yet (it is started
   * now, for the next call) or failed — and the caller then runs `agy -p` as before.
   */
  async run(label: string, prompt: string, modelId: string): Promise<WarmTurn | null> {
    if (!this.enabled) return null
    if (!this.ready) {
      this.startInBackground(`first AI call (${label})`)
      return null
    }
    const client = this.client!
    this.active++
    this.clearIdle()
    const started = Date.now()
    let sessionId = ''
    let timer: NodeJS.Timeout | undefined
    try {
      sessionId = await client.newSession([])
      await client.setModel(sessionId, modelId)
      let text = ''
      const timeoutMs = (this.opts.timeoutMs ?? (() => Number(process.env.ANTIGRAVITY_TIMEOUT_MS) || 5 * 60_000))()
      const result = await Promise.race([
        client.prompt(sessionId, [{ type: 'text', text: prompt }], (u) => {
          if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type !== 'image' && typeof u.content?.text === 'string') text += u.content.text
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`no answer after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs)
          timer.unref?.()
        }),
      ])
      if (result.stopReason !== 'end_turn') throw new Error(`stopped: ${result.stopReason}`)
      if (AGENT_ERROR.test(text)) throw new Error(text.trim().slice(0, 160))
      this.turns++
      return { text, usage: result.usage, ms: Date.now() - started }
    } catch (error) {
      const reason = (error as Error).message
      console.warn(`[antigravity-warm] '${label}' failed (${reason}); running it through agy -p`)
      this.event({ event: 'fallback', reason: `${label}: ${reason}` })
      if (sessionId) client.cancel(sessionId)
      // A crash or a hang replaces the process; an answer that was simply not usable (agent-side API error, a refused
      // model id) keeps it.
      if (this.client === client && (!client.pid || /no answer after/.test(reason))) this.replace(reason)
      return null
    } finally {
      clearTimeout(timer)
      if (sessionId) void client.close(sessionId)
      this.active--
      if (this.client === client) this.maybeRecycle()
      this.armIdle()
    }
  }

  /** After ~200 turns or 6 h, restart while idle (a call in flight is never cut). */
  private maybeRecycle() {
    if (this.active) return
    const maxTurns = this.opts.maxTurns ?? 200
    const maxAgeMs = this.opts.maxAgeMs ?? 6 * 60 * 60_000
    const age = Date.now() - this.startedAt
    if (this.turns >= maxTurns || age >= maxAgeMs) this.replace(this.turns >= maxTurns ? `${this.turns} turns` : `${Math.round(age / 3_600_000)} h old`)
  }
}
