// Claude through the Claude Code CLI (`claude -p`), signed in with the user's own Claude plan: no API key, the calls
// count against the plan's usage limits instead of being billed per token. Used where a feature is meant to run on
// Claude only (Writing Review).
//
// Each call is kept lean (~1.2k tokens of overhead instead of Claude Code's ~28k agent context): the app's own system
// prompt replaces Claude Code's (--system-prompt), no tools (--tools ""), an empty working directory (no CLAUDE.md or
// project settings), no saved session, and the answer is validated against a JSON Schema by the CLI (--json-schema).
// Every call is logged to the usage log like the Gemini ones (billing "subscription": 0 USD in Admin → Usage).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ApiError } from '../api.ts'
import { recordUsage } from '../usage.ts'

// Settings are read at call time, not at import: the dev server loads .env after this module is imported.
/** The CLI: CLAUDE_BIN, else the native installer's ~/.local/bin/claude, else `claude` on PATH. */
const bin = () => process.env.CLAUDE_BIN || [path.join(os.homedir(), '.local', 'bin', 'claude')].find((p) => existsSync(p)) || 'claude'
/** No CLAUDE.md, no project settings: the call only sees what the app sends. */
const WORKDIR = path.join(os.tmpdir(), 'english-app-claude')
const timeoutMs = () => Number(process.env.CLAUDE_CODE_TIMEOUT_MS) || 5 * 60_000
/** Calls running at once (several Writing Reviews can run together); the rest wait their turn. */
const maxParallel = () => Math.max(1, Number(process.env.CLAUDE_CODE_PARALLEL) || 2)

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ClaudeJsonRequest {
  /** For the usage log, e.g. "writing-review: judge". */
  label: string
  system: string
  prompt: string
  /** JSON Schema the answer must match (checked by the CLI). */
  jsonSchema: unknown
  /** Model alias or id ("opus", "sonnet", "claude-opus-5-5"); the plan's default when missing. */
  model?: string
  effort?: ClaudeEffort
}

export interface ClaudeJsonResult {
  value: unknown
  model: string
  /** output excludes thinking; both count against the plan's limits. */
  usage: { input: number; output: number; thinking: number }
  ms: number
}

/** The CLI is installed (signing in is checked by the first call, which then fails with Claude Code's own message). */
export function claudeCodeAvailable(): boolean {
  // Multi-user app: AI runs only through the sandboxed agy (no Claude Code on the server for learners).
  if (process.env.MULTI_USER === '1') return false
  return bin() !== 'claude' || process.env.PATH?.split(path.delimiter).some((dir) => existsSync(path.join(dir, 'claude'))) === true
}

// Kept on globalThis: the dev server reloads server modules in-process when they change, and calls still running in
// the old instance must keep counting against the limit.
const slots = ((globalThis as { __claudeCodeSlots?: { running: number; queue: (() => void)[] } }).__claudeCodeSlots ??= {
  running: 0,
  queue: [],
})

async function inSlot<T>(task: () => Promise<T>): Promise<T> {
  if (slots.running >= maxParallel()) await new Promise<void>((resolve) => slots.queue.push(resolve))
  slots.running++
  try {
    return await task()
  } finally {
    slots.running--
    slots.queue.shift()?.()
  }
}

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  mkdirSync(WORKDIR, { recursive: true })
  const BIN = bin()
  const TIMEOUT_MS = timeoutMs()
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, args, { cwd: WORKDIR, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d))
    child.stderr.on('data', (d: Buffer) => (stderr += d))
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      // A CLI that ignores SIGTERM must not keep the job waiting forever.
      setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill('SIGKILL'), 5000).unref()
    }, TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new ApiError(503, `Cannot start Claude Code (${BIN}): ${error.message}. Install it and sign in once with \`claude\`.`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

interface CliOutput {
  is_error?: boolean
  result?: string
  structured_output?: unknown
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    /** Thinking tokens, included in output_tokens. */
    output_tokens_details?: { thinking_tokens?: number }
  }
  modelUsage?: Record<string, unknown>
}

export async function claudeJson(request: ClaudeJsonRequest): Promise<ClaudeJsonResult> {
  const args = [
    '-p',
    request.prompt,
    '--system-prompt',
    request.system,
    '--tools',
    '',
    '--no-session-persistence',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(request.jsonSchema),
    ...(request.model ? ['--model', request.model] : []),
    ...(request.effort ? ['--effort', request.effort] : []),
  ]
  const started = Date.now()
  const { code, stdout, stderr } = await inSlot(() => runCli(args))
  const ms = Date.now() - started

  let out: CliOutput
  try {
    out = JSON.parse(stdout) as CliOutput
  } catch {
    const detail = (stderr || stdout).trim().slice(0, 300) || (code === null ? `timed out after ${timeoutMs() / 1000}s` : `exit code ${code}`)
    throw new ApiError(502, `Claude Code gave no answer: ${detail}`)
  }

  const u = out.usage ?? {}
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  const thinking = Math.min(u.output_tokens_details?.thinking_tokens ?? 0, u.output_tokens ?? 0)
  const output = (u.output_tokens ?? 0) - thinking
  const model = Object.keys(out.modelUsage ?? {})[0] ?? request.model ?? 'claude'
  const usable = !out.is_error && out.structured_output != null
  recordUsage({
    at: new Date().toISOString(),
    label: request.label,
    model,
    input,
    output,
    thinking,
    total: input + output + thinking,
    ms,
    billing: 'subscription',
    provider: 'claude',
    ...(request.effort ? { effort: request.effort } : {}),
    ...(usable ? {} : { failed: true }),
  })
  // Not signed in, plan limit reached, schema not met…: Claude Code's own message.
  if (out.is_error) throw new ApiError(502, `Claude: ${(out.result ?? 'the request failed').slice(0, 400)}`)
  if (out.structured_output == null) throw new ApiError(502, 'Claude did not return the JSON answer.')
  return { value: out.structured_output, model, usage: { input, output, thinking }, ms }
}
