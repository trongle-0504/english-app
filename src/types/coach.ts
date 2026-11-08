// Study Coach: the in-app chat assistant (agy over ACP + the app's own MCP tools). Shared by the server and the client.

/** Tokens of one turn, as agy reports them on `session/prompt`. */
export interface CoachUsage {
  input: number
  output: number
  thinking: number
  cacheRead: number
  total: number
}

export type CoachStepStatus = 'running' | 'done' | 'failed'

/** One tool call of a turn, shown as "Reading your Writing mistakes… ✓". */
export interface CoachStep {
  id: string
  tool: string
  label: string
  status: CoachStepStatus
  /** The arguments the model sent (JSON, cut to 200 characters) — for the eval and the report. */
  args?: string
}

export type CoachTurnStatus = 'queued' | 'running' | 'done' | 'cancelled' | 'error'

/** One question and its answer. */
export interface CoachTurn {
  id: string
  /** ISO time the question was asked. */
  at: string
  question: string
  /** The page the learner was on (route + query), when the client sent it. */
  page?: string
  /** Markdown, grows while the turn runs. */
  answer: string
  steps: CoachStep[]
  status: CoachTurnStatus
  error?: string
  ms?: number
  usage?: CoachUsage | null
  /** App tool calls (MCP) and other tool attempts (agy built-ins, all refused or unused). */
  toolCalls?: number
  stopReason?: string
}

/** progress/coach/sessions/<id>.json */
export interface CoachSession {
  version: 1
  id: string
  /** The first question, cut to 60 characters. */
  title: string
  model: string
  /** agy's session id (ACP); missing until the first turn. */
  acpSessionId?: string
  createdAt: string
  /** Last message; the retention sweep deletes sessions older than COACH_RETENTION_DAYS. */
  updatedAt: string
  turns: CoachTurn[]
  /** Reserved for PLAN-multi-user Phase 2. */
  userId?: string
}

export interface CoachSessionSummary {
  id: string
  title: string
  updatedAt: string
  turns: number
}

/** GET /coach/status */
export interface CoachStatus {
  enabled: boolean
  model: string
  retentionDays: number
}

/** GET /coach/turn */
export interface CoachTurnPoll {
  sessionId: string
  turn: CoachTurn
  done: boolean
}
