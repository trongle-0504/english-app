// CoachService: chats, turns, limits and token accounting around one `agy acp` process and the app's MCP server.
// A turn runs in the background; the browser polls its snapshot (GET /api/coach/turn).
import { randomBytes } from 'node:crypto'
import { enWeekday, vnDay, vnTime } from '../../src/features/planner/dates.ts'
import type {
  CoachDayStats,
  CoachLibraryProgress,
  CoachProposal,
  CoachProposalResult,
  CoachSession,
  CoachStatus,
  CoachStep,
  CoachTurn,
  CoachTurnPoll,
  CoachUsage,
} from '../../src/types/coach.ts'
import type { PhraseGroup, WorkKind } from '../../src/types/practice.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { applyMoves, createTasks } from '../planner/actions.ts'
import { mistakeCards } from '../practice/mistakes.ts'
import { phraseCards } from '../practice/recent.ts'
import { recordUsage, type UsageEntry } from '../usage.ts'
import { AcpClient, type AcpMcpServer, type AcpUpdate } from './acp.ts'
import { cut, dayOf, ToolError, type ProposalDraft, type ToolContext } from './data.ts'
import { runLibraryJob, type LibraryItemData, type LibraryWriter } from './library-job.ts'
import { CoachMcpServer } from './mcp.ts'
import { promptBlocks, proposalNews, turnHeader } from './preamble.ts'
import { allSessions, deleteSession, expiredSessions, listSessions, newSessionId, readSession, updateSession, validSessionId } from './store.ts'
import { appToolName, COACH_TOOLS, overview, toolByName } from './tools/index.ts'

export interface CoachConfig {
  enabled: boolean
  model: string
  turnTimeoutMs: number
  maxTurnsPerHour: number
  maxRunning: number
  maxTurnsPerSession: number
  retentionDays: number
  maxQuestionChars: number
}

const num = (value: string | undefined, fallback: number) => (value && Number.isFinite(Number(value)) ? Number(value) : fallback)

export function coachConfig(env = process.env): CoachConfig {
  return {
    enabled: env.COACH_ENABLED !== '0',
    model: env.COACH_MODEL || 'gemini-3.8-flash-low',
    turnTimeoutMs: num(env.COACH_TURN_TIMEOUT_MS, 180_000),
    maxTurnsPerHour: num(env.COACH_MAX_TURNS_PER_HOUR, 40),
    maxRunning: num(env.COACH_MAX_RUNNING, 2),
    maxTurnsPerSession: 30,
    retentionDays: num(env.COACH_RETENTION_DAYS, 30),
    // A pasted word list for the library ("thêm các từ này") needs room.
    maxQuestionChars: 8000,
  }
}

interface LiveTurn {
  sessionId: string
  turn: CoachTurn
  done: boolean
  acpSessionId?: string
  timedOut?: boolean
}

export interface CoachServiceOptions {
  rootDir: string
  contentDir: string
  config?: Partial<CoachConfig>
  acp?: AcpClient
  mcp?: CoachMcpServer
  /** Fixed clock for tests and the eval. */
  now?: () => Date
  /** Usage log writer (default: logs/gemini-usage.jsonl). */
  record?: (entry: UsageEntry) => void
  /** Writes one library entry (default: the Admin generator); tests pass a fake. */
  writeLibrary?: LibraryWriter
}

const BUSY = 'Nova Agent could not answer — try again in a moment.'
const MAX_PROPOSALS_PER_TURN = 3

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * A permission request agy sends before an MCP call: allowed only for the coach's own tools, by exact name
 * ("Run mcp_app_get_plan", "Run mcp_app_82aaed4d_get_plan" or the bare tool name). Pure (tested).
 */
export function allowAppTool(call: { title?: string; kind?: string; name?: string }): boolean {
  const names = [call.name ?? '', /^Run (\S+)$/.exec(call.title ?? '')?.[1] ?? '']
  return names.some((n) => /^mcp_app_/.test(n) && Boolean(toolByName(appToolName(n))))
}

/** The card's "Done" line of a library proposal, from its items' progress. Pure (tested). */
export function libraryResult(proposal: Pick<CoachProposal, 'items'>, progress: CoachLibraryProgress[]): CoachProposalResult {
  const done = progress.filter((r) => r.status === 'done')
  const skipped = progress.filter((r) => r.status === 'skipped')
  const failed = progress.filter((r) => r.status === 'error').map((r) => `${cut(String(proposal.items[r.index]?.label ?? ''), 60)}: ${cut(r.error || 'failed', 120)}`)
  return {
    summary: `${plural(done.length, 'entry', 'entries')} saved to your library${skipped.length ? ` · ${skipped.length} already there` : ''}`,
    links: done
      .filter((r) => typeof r.href === 'string' && r.href.startsWith('/') && !r.href.startsWith('//'))
      .slice(0, 5)
      .map((r) => ({ label: cut(r.label || proposal.items[r.index]?.label, 80), href: cut(r.href, 300) })),
    ...(failed.length ? { failed } : {}),
  }
}

export class CoachService {
  readonly config: CoachConfig
  private readonly opts: CoachServiceOptions
  private readonly acp: AcpClient
  private readonly mcp: CoachMcpServer
  private readonly now: () => Date
  private live = new Map<string, LiveTurn>()
  private runningBySession = new Map<string, string>()
  private tokens = new Map<string, string>()
  private recent: number[] = []
  private running = 0
  private waiters: (() => void)[] = []
  private sweptAt = 0
  private applying = new Set<string>()
  /** Library proposals whose entries are being written right now (by this process). */
  private libraryJobs = new Set<string>()

  constructor(opts: CoachServiceOptions) {
    this.opts = opts
    this.config = { ...coachConfig(), ...opts.config }
    this.now = opts.now ?? (() => new Date())
    this.acp =
      opts.acp ??
      new AcpClient({
        allow: allowAppTool,
        onPermission: (p) => !p.allowed && console.warn(`[coach] refused agent permission: ${p.kind ?? '?'} ${p.title ?? ''}`),
      })
    this.mcp =
      opts.mcp ?? new CoachMcpServer({ tools: COACH_TOOLS, context: (binding) => ({ ...this.toolContext(), propose: (draft) => this.addProposal(binding.sessionId, draft) }) })
  }

  toolContext(): ToolContext {
    return { rootDir: this.opts.rootDir, contentDir: this.opts.contentDir, now: this.now() }
  }

  status(): CoachStatus {
    return { enabled: this.config.enabled, model: this.config.model, retentionDays: this.config.retentionDays }
  }

  /* ───────────── Chats ───────────── */

  async createSession(): Promise<string> {
    await this.sweepIfDue()
    const id = newSessionId()
    const at = this.now().toISOString()
    const doc: CoachSession = { version: 1, id, title: 'New chat', model: this.config.model, createdAt: at, updatedAt: at, turns: [] }
    await updateSession(this.opts.rootDir, id, doc, () => {})
    return id
  }

  async listSessions() {
    await this.sweepIfDue()
    return listSessions(this.opts.rootDir)
  }

  async getSession(id: string): Promise<CoachSession> {
    const session = await readSession(this.opts.rootDir, id)
    if (!session) throw new ApiError(404, 'Chat not found.')
    if (await this.settleOrphans(session)) return this.getSession(id)
    // A turn still running shows its live state.
    return { ...session, turns: session.turns.map((t) => this.live.get(t.id)?.turn ?? t) }
  }

  /** One proposal, for the card polling a library job. */
  async getProposal(sessionId: string, proposalId: string): Promise<CoachProposal> {
    if (!validSessionId(sessionId)) throw new ApiError(404, 'Chat not found.')
    const proposal = (await this.getSession(sessionId)).turns.flatMap((t) => t.proposals ?? []).find((p) => p.id === proposalId)
    if (!proposal) throw new ApiError(404, 'Proposal not found.')
    return proposal
  }

  /** A library job cut off by a server restart: its unfinished items are reported as interrupted. True if it changed. */
  private async settleOrphans(session: CoachSession): Promise<boolean> {
    const orphans = session.turns.flatMap((t) => t.proposals ?? []).filter((p) => p.status === 'applying' && !this.libraryJobs.has(p.id))
    if (!orphans.length) return false
    const ids = new Set(orphans.map((p) => p.id))
    await this.changeProposals(session.id, (p) => ids.has(p.id) && p.status === 'applying' && !this.libraryJobs.has(p.id), (p) => {
      const progress = (p.progress ?? []).map((r) => (r.status === 'queued' || r.status === 'running' ? { ...r, status: 'error' as const, error: 'interrupted by a server restart — ask again' } : r))
      p.progress = progress
      p.status = 'applied'
      p.result = libraryResult(p, progress)
      p.reported = false
    })
    return true
  }

  async deleteSession(id: string): Promise<void> {
    const session = await readSession(this.opts.rootDir, id)
    if (!session) throw new ApiError(404, 'Chat not found.')
    const turnId = this.runningBySession.get(id)
    if (turnId) this.cancelTurn(id, turnId)
    if (session.acpSessionId) await this.acp.close(session.acpSessionId)
    this.mcp.revokeSession(id)
    this.tokens.delete(id)
    await deleteSession(this.opts.rootDir, id)
  }

  /** Deletes chats older than the retention period (at most once an hour; also on a daily timer). */
  async sweep(): Promise<number> {
    this.sweptAt = Date.now()
    const old = await expiredSessions(this.opts.rootDir, this.config.retentionDays, this.now())
    for (const s of old) {
      if (this.runningBySession.has(s.id)) continue
      if (s.acpSessionId) await this.acp.close(s.acpSessionId)
      this.mcp.revokeSession(s.id)
      this.tokens.delete(s.id)
      await deleteSession(this.opts.rootDir, s.id)
    }
    return old.length
  }

  private async sweepIfDue() {
    if (Date.now() - this.sweptAt > 3_600_000) await this.sweep().catch((e) => console.warn('[coach] sweep failed:', e))
  }

  /* ───────────── Turns ───────────── */

  async startTurn(sessionId: string, question: string, page?: string): Promise<string> {
    if (!validSessionId(sessionId)) throw new ApiError(404, 'Chat not found.')
    const text = question.trim()
    if (!text) throw new ApiError(400, 'Type a question.')
    if (text.length > this.config.maxQuestionChars) throw new ApiError(400, `At most ${this.config.maxQuestionChars} characters.`)
    const session = await readSession(this.opts.rootDir, sessionId)
    if (!session) throw new ApiError(404, 'Chat not found.')
    if (this.runningBySession.has(sessionId)) throw new ApiError(409, 'Nova Agent is still answering in this chat.')
    if (session.turns.length >= this.config.maxTurnsPerSession) throw new ApiError(409, 'This chat is full — start a new chat.')
    const hourAgo = Date.now() - 3_600_000
    this.recent = this.recent.filter((t) => t > hourAgo)
    if (this.recent.length >= this.config.maxTurnsPerHour) throw new ApiError(429, 'Too many questions this hour — try again later.')
    this.recent.push(Date.now())

    const turn: CoachTurn = { id: randomBytes(8).toString('hex'), at: this.now().toISOString(), question: text, ...(page ? { page: cut(page, 200) } : {}), answer: '', steps: [], status: 'queued' }
    await updateSession(this.opts.rootDir, sessionId, null, (s) => {
      if (!s.turns.length) s.title = cut(text, 60)
      s.turns.push(turn)
      s.updatedAt = turn.at
    })
    const live: LiveTurn = { sessionId, turn, done: false }
    this.live.set(turn.id, live)
    this.runningBySession.set(sessionId, turn.id)
    void this.run(live, session)
    return turn.id
  }

  async getTurn(sessionId: string, turnId: string): Promise<CoachTurnPoll> {
    const live = this.live.get(turnId)
    if (live && live.sessionId === sessionId) return { sessionId, turn: live.turn, done: live.done }
    const session = await readSession(this.opts.rootDir, sessionId)
    const turn = session?.turns.find((t) => t.id === turnId)
    if (!turn) throw new ApiError(404, 'Turn not found.')
    // A turn left "running" by a server restart is over.
    const over = turn.status === 'running' || turn.status === 'queued' ? { ...turn, status: 'error' as const, error: 'Interrupted — ask again.' } : turn
    return { sessionId, turn: over, done: true }
  }

  cancelTurn(sessionId: string, turnId: string): void {
    const live = this.live.get(turnId)
    if (!live || live.sessionId !== sessionId || live.done) return
    live.turn.status = 'cancelled'
    if (live.acpSessionId) this.acp.cancel(live.acpSessionId)
  }

  private async slot() {
    if (this.running >= this.config.maxRunning) await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.running++
  }

  private release() {
    this.running--
    this.waiters.shift()?.()
  }

  private mcpToken(sessionId: string): string {
    let token = this.tokens.get(sessionId)
    if (!token) {
      token = this.mcp.register({ sessionId })
      this.tokens.set(sessionId, token)
    }
    return token
  }

  private onUpdate(live: LiveTurn, update: AcpUpdate) {
    const turn = live.turn
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type !== 'image') {
      turn.answer += update.content?.text ?? ''
      return
    }
    if (update.sessionUpdate === 'tool_call') {
      const name = appToolName(update.name ?? '')
      const args = update.rawInput ?? update.args ?? {}
      const tool = toolByName(name)
      const step: CoachStep = {
        id: update.toolCallId ?? `s${turn.steps.length}`,
        tool: tool ? name : update.name || update.title || 'tool',
        label: tool ? tool.label(args) : `Tried “${cut(update.title || update.name, 40)}” (not an app tool)`,
        status: update.status === 'failed' ? 'failed' : update.status === 'completed' ? 'done' : 'running',
        args: cut(JSON.stringify(Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'toolSummary'))), 200),
      }
      turn.steps.push(step)
      turn.toolCalls = turn.steps.length
      return
    }
    if (update.sessionUpdate === 'tool_call_update' && update.toolCallId) {
      const step = turn.steps.find((s) => s.id === update.toolCallId)
      if (step && (update.status === 'completed' || update.status === 'failed')) step.status = update.status === 'completed' ? 'done' : 'failed'
    }
  }

  private async run(live: LiveTurn, session: CoachSession) {
    const { turn, sessionId } = live
    const started = Date.now()
    let timer: NodeJS.Timeout | null = null
    await this.slot()
    try {
      if (turn.status === 'cancelled') return
      turn.status = 'running'
      const mcpServers: AcpMcpServer[] = [
        { type: 'http', name: 'app', url: await this.mcp.start(), headers: [{ name: 'Authorization', value: `Bearer ${this.mcpToken(sessionId)}` }] },
      ]
      let acpId = session.acpSessionId
      let first = false
      if (acpId && !this.acp.isLive(acpId) && !(await this.acp.loadSession(acpId, mcpServers))) acpId = undefined
      if (!acpId) {
        acpId = await this.acp.newSession(mcpServers)
        first = true
        const id = acpId
        await updateSession(this.opts.rootDir, sessionId, null, (s) => void (s.acpSessionId = id))
      }
      live.acpSessionId = acpId
      await this.acp.setModel(acpId, this.config.model)

      const ctx = this.toolContext()
      const today = vnDay(ctx.now)
      const pending = session.turns.flatMap((t) => (t.proposals ?? []).filter((p) => !p.reported))
      const header = turnHeader({ nowLabel: `${today} (${enWeekday(today)}) ${vnTime(ctx.now)}`, page: turn.page, overview: await overview(ctx), news: proposalNews(pending) })
      const told = new Set(pending.filter((p) => p.status === 'applied' || p.status === 'dismissed').map((p) => p.id))
      if (told.size)
        await this.changeProposals(sessionId, (p) => told.has(p.id), (p) => void (p.reported = true))
      // A chat whose agy session was lost gets its last exchanges back as context.
      const earlier = first ? session.turns.filter((t) => t.id !== turn.id && t.answer).slice(-3) : []
      const recap = earlier.length ? `[app] earlier in this chat:\n${earlier.map((t) => `Q: ${cut(t.question, 200)}\nA: ${cut(t.answer, 400)}`).join('\n')}\n\n` : ''
      const blocks = promptBlocks({ first, header, question: `${recap}${turn.question}` })

      timer = setTimeout(() => {
        live.timedOut = true
        this.acp.cancel(acpId!)
      }, this.config.turnTimeoutMs)
      if (turn.status !== 'running') return // cancelled while the session was being prepared
      const result = await this.acp.prompt(acpId, blocks, (u) => this.onUpdate(live, u))
      turn.stopReason = result.stopReason
      const u = result.usage
      turn.usage = u
        ? { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, thinking: u.thoughtTokens ?? 0, cacheRead: u.cachedReadTokens ?? 0, total: u.totalTokens ?? 0 }
        : null
      if (live.timedOut) {
        turn.status = 'error'
        turn.error = 'Nova Agent took too long — try a shorter question.'
      } else turn.status = result.stopReason === 'cancelled' ? 'cancelled' : 'done'
      for (const step of turn.steps) if (step.status === 'running') step.status = turn.status === 'done' ? 'done' : 'failed'
    } catch (error) {
      console.error('[coach] turn failed:', (error as Error).message)
      if (turn.status !== 'cancelled') {
        turn.status = 'error'
        turn.error = BUSY
      }
    } finally {
      if (timer) clearTimeout(timer)
      turn.ms = Date.now() - started
      turn.toolCalls = turn.steps.length
      live.done = true
      this.release()
      this.runningBySession.delete(sessionId)
      if (turn.usage) this.logUsage(turn.usage, turn.ms)
      await updateSession(this.opts.rootDir, sessionId, null, (s) => {
        const i = s.turns.findIndex((t) => t.id === turn.id)
        if (i >= 0) s.turns[i] = { ...turn }
        s.updatedAt = this.now().toISOString()
      }).catch((e) => console.error('[coach] could not save the turn:', e))
      setTimeout(() => this.live.delete(turn.id), 10 * 60_000).unref()
    }
  }

  /* ───────────── Proposals (Phase 2) ───────────── */

  /** Called by a propose_* tool during a turn: the proposal joins the running turn (and shows up in the next poll). */
  addProposal(sessionId: string, draft: ProposalDraft): CoachProposal {
    const live = this.live.get(this.runningBySession.get(sessionId) ?? '')
    if (!live || live.done) throw new ToolError('No question is running in this chat.')
    const list = (live.turn.proposals ??= [])
    if (list.length >= MAX_PROPOSALS_PER_TURN) throw new ToolError(`At most ${MAX_PROPOSALS_PER_TURN} proposals per answer.`)
    const proposal: CoachProposal = { id: `p${randomBytes(5).toString('hex')}`, ...draft, status: 'open', createdAt: this.now().toISOString() }
    list.push(proposal)
    return proposal
  }

  /** Runs `change` on every copy of the matching proposals: the live turn (if any) and the saved chat. */
  private async changeProposals(sessionId: string, match: (p: CoachProposal) => boolean, change: (p: CoachProposal) => void) {
    for (const live of this.live.values()) if (live.sessionId === sessionId) for (const p of live.turn.proposals ?? []) if (match(p)) change(p)
    await updateSession(this.opts.rootDir, sessionId, null, (s) => {
      for (const t of s.turns) for (const p of t.proposals ?? []) if (match(p)) change(p)
    })
  }

  private async findProposal(sessionId: string, proposalId: string): Promise<CoachProposal> {
    if (!validSessionId(sessionId)) throw new ApiError(404, 'Chat not found.')
    const session = await this.getSession(sessionId)
    const proposal = session.turns.flatMap((t) => t.proposals ?? []).find((p) => p.id === proposalId)
    if (!proposal) throw new ApiError(404, 'Proposal not found.')
    if (proposal.status !== 'open')
      throw new ApiError(409, proposal.status === 'applied' ? 'Already applied.' : proposal.status === 'applying' ? 'Already being applied.' : 'This proposal was dismissed.')
    if (this.applying.has(proposalId)) throw new ApiError(409, 'Already being applied.')
    return proposal
  }

  /**
   * The learner's Confirm: applies the kept items through the same code as the app's own buttons, once.
   * `authorized`: the admin-token check of the card / library routes (cards and library entries need it).
   * Library entries take minutes: the proposal turns "applying" at once and a background job writes them (the card
   * polls GET /coach/proposal until it is "applied").
   */
  async applyProposal(
    ctx: ApiContext,
    sessionId: string,
    proposalId: string,
    keepRaw: unknown,
    opts: { authorized: boolean },
  ): Promise<CoachProposal> {
    const proposal = await this.findProposal(sessionId, proposalId)
    const all = proposal.items.map((_, i) => i)
    const keep = keepRaw === undefined ? all : Array.isArray(keepRaw) ? [...new Set(keepRaw)].filter((i): i is number => Number.isInteger(i) && i >= 0 && i < proposal.items.length) : null
    if (!keep || (Array.isArray(keepRaw) && keep.length !== new Set(keepRaw).size)) throw new ApiError(400, '`keep` must list item numbers of this proposal.')
    if (!keep.length) throw new ApiError(400, 'Tick at least one item.')
    if ((proposal.kind === 'review-cards' || proposal.kind === 'library') && !opts.authorized) throw new ApiError(401, 'This server requires an admin token.')
    keep.sort((a, b) => a - b)
    const items = keep.map((i) => proposal.items[i])
    const now = this.now().toISOString()

    this.applying.add(proposalId)
    try {
      let result: CoachProposalResult
      if (proposal.kind === 'tasks') {
        const created = await createTasks(ctx, items.map((i) => ({ ...i.data, source: 'coach' })), now)
        result = { summary: `${plural(created.length, 'task')} added`, links: [{ label: 'Open the planner', href: '/planner' }] }
      } else if (proposal.kind === 'moves') {
        const { moved } = await applyMoves(ctx, items.map((i) => i.data), [], now)
        result = {
          summary: `${plural(moved, 'task')} moved`,
          links: [{ label: 'Open the planner', href: '/planner' }],
          ...(moved < items.length ? { failed: [`${plural(items.length - moved, 'task')} no longer in the plan`] } : {}),
        }
      } else if (proposal.kind === 'review-cards') {
        let added = 0
        const keys = items.filter((i) => i.data.type === 'mistake').map((i) => String(i.data.key))
        if (keys.length) added += (await mistakeCards(ctx, keys)).ids.length
        const phrases = items.filter((i) => i.data.type === 'phrase')
        const groups = new Map<string, typeof phrases>()
        for (const p of phrases) {
          const key = JSON.stringify(p.data.from ?? null)
          groups.set(key, [...(groups.get(key) ?? []), p])
        }
        for (const [key, group] of groups) {
          // Library phrases use their library card; `from` is only stored on a new phrase card.
          const from = (JSON.parse(key) as { kind: WorkKind; id: string; title: string } | null) ?? { kind: 'writing' as WorkKind, id: 'coach', title: 'Nova Agent' }
          const rows = group.map((p) => ({
            term: String(p.data.term),
            group: 'extra' as PhraseGroup,
            ...(p.data.meaning_vi ? { meaning_vi: String(p.data.meaning_vi) } : {}),
            ...(p.data.example ? { example: String(p.data.example) } : {}),
          }))
          added += (await phraseCards(ctx, rows, from)).ids.length
        }
        result = { summary: `${plural(added, 'card')} added to your reviews`, links: [{ label: 'Open Review', href: '/review' }] }
      } else {
        const progress: CoachLibraryProgress[] = keep.map((index) => ({ index, status: 'queued' }))
        await this.changeProposals(sessionId, (p) => p.id === proposalId, (p) => {
          p.status = 'applying'
          p.kept = keep
          p.progress = progress.map((r) => ({ ...r }))
        })
        this.libraryJobs.add(proposalId)
        void this.runLibrary(ctx, sessionId, proposal, keep.map((i) => proposal.items[i].data as unknown as LibraryItemData), progress)
        return { ...proposal, status: 'applying', kept: keep, progress }
      }
      await this.changeProposals(sessionId, (p) => p.id === proposalId, (p) => {
        p.status = 'applied'
        p.kept = keep
        p.result = result
        p.reported = false
      })
      return { ...proposal, status: 'applied', kept: keep, result }
    } finally {
      this.applying.delete(proposalId)
    }
  }

  /** The background half of a library Confirm: writes the entries, then marks the proposal applied. Never throws. */
  private async runLibrary(ctx: ApiContext, sessionId: string, proposal: CoachProposal, items: LibraryItemData[], progress: CoachLibraryProgress[]) {
    const mine = (p: CoachProposal) => p.id === proposal.id
    const save = () => this.changeProposals(sessionId, mine, (p) => void (p.progress = progress.map((r) => ({ ...r }))))
    try {
      await runLibraryJob(ctx, items, progress, save, this.opts.writeLibrary)
    } catch (error) {
      console.error('[coach] library job failed:', error)
    } finally {
      for (const r of progress) if (r.status === 'queued' || r.status === 'running') Object.assign(r, { status: 'error', error: 'stopped' })
      await this.changeProposals(sessionId, mine, (p) => {
        p.progress = progress.map((r) => ({ ...r }))
        p.status = 'applied'
        p.result = libraryResult(p, progress)
        p.reported = false
      }).catch((e) => console.error('[coach] could not save the library job:', e))
      this.libraryJobs.delete(proposal.id)
    }
  }

  async dismissProposal(sessionId: string, proposalId: string): Promise<void> {
    await this.findProposal(sessionId, proposalId)
    await this.changeProposals(sessionId, (p) => p.id === proposalId, (p) => {
      p.status = 'dismissed'
      p.reported = false
    })
  }

  /* ───────────── Admin stats (Phase 3) ───────────── */

  /** Coach use per VN day, newest first (chats live 30 days, so this covers at most that). */
  async stats(days = 14): Promise<CoachDayStats[]> {
    const byDay = new Map<string, CoachTurn[]>()
    for (const s of await allSessions(this.opts.rootDir)) for (const t of s.turns) byDay.set(dayOf(t.at), [...(byDay.get(dayOf(t.at)) ?? []), t])
    return [...byDay]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, days)
      .map(([day, turns]) => {
        const proposals = turns.flatMap((t) => t.proposals ?? [])
        return {
          day,
          turns: turns.length,
          errors: turns.filter((t) => t.status === 'error').length,
          medianMs: median(turns.filter((t) => t.status === 'done' && t.ms).map((t) => t.ms!)),
          tokens: turns.reduce((sum, t) => sum + (t.usage?.total ?? 0), 0),
          proposals: proposals.length,
          applied: proposals.filter((p) => p.status === 'applied' || p.status === 'applying').length,
        }
      })
  }

  private logUsage(usage: CoachUsage | null, ms: number) {
    const entry: UsageEntry = {
      at: new Date().toISOString(),
      label: 'coach',
      model: this.config.model,
      input: usage?.input ?? 0,
      output: usage?.output ?? 0,
      thinking: usage?.thinking ?? 0,
      total: usage?.total ?? 0,
      ms,
      provider: 'antigravity',
    }
    ;(this.opts.record ?? recordUsage)(entry)
  }

  async stop(): Promise<void> {
    this.acp.stop()
    await this.mcp.stop()
  }
}

/* ───────────── The server's one instance ───────────── */

const holder = globalThis as { __coach?: CoachService; __coachTimer?: NodeJS.Timeout }

export function getCoach(ctx: { rootDir: string; contentDir: string }): CoachService {
  if (!holder.__coach) {
    holder.__coach = new CoachService({ rootDir: ctx.rootDir, contentDir: ctx.contentDir })
    holder.__coachTimer = setInterval(() => void holder.__coach?.sweep().catch(() => {}), 24 * 3_600_000)
    holder.__coachTimer.unref()
  }
  return holder.__coach
}

export async function stopCoach(): Promise<void> {
  if (holder.__coachTimer) clearInterval(holder.__coachTimer)
  await holder.__coach?.stop()
  holder.__coach = undefined
}
