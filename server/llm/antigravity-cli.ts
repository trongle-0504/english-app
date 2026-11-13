// Antigravity CLI through the agy command (`agy -p`), running with models like GPT OSS 120B (gpt-oss-120b-medium).
// No saved session, empty working directory, JSON output with --json-schema. The CLI takes no image input, so images are
// written to a temporary folder that is added to the workspace, and the prompt names the files for the model to open.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { appendFileSync } from 'node:fs'
import { ApiError } from '../api.ts'
import { recordUsage } from '../usage.ts'
import { chargeAgyCall } from '../users/quota.ts'
import { currentUserId } from '../users/context.ts'
import { WarmAgentPool, type WarmEvent, type WarmTurn } from './acp-pool.ts'
import { agyBinary, ephemeralProfiles, sandboxedAgy } from './agy-sandbox.ts'

/** The CLI: ANTIGRAVITY_BIN, else the native installer's ~/.local/bin/agy, else `agy` on PATH. */
const bin = agyBinary
const WORKDIR = path.join(os.tmpdir(), 'english-app-antigravity')
const timeoutMs = () => Number(process.env.ANTIGRAVITY_TIMEOUT_MS) || 5 * 60_000
/** ANTIGRAVITY_PARALLEL, else 4: a long Listening transcript is analysed in parts side by side. */
const maxParallel = () => Math.max(1, Number(process.env.ANTIGRAVITY_PARALLEL) || 4)

/** An image for the model, base64 without a data: prefix. */
export interface CliImage {
  mimeType: string
  data: string
}

export interface AntigravityJsonRequest {
  label: string
  system?: string
  prompt: string
  jsonSchema: unknown
  model?: string
  effort?: string
  images?: CliImage[]
  /**
   * Optional check of the parsed answer (e.g. a Zod schema's safeParse). An answer from the warm agent that fails it is
   * run again through `agy -p`. Without it, the schema's top-level "required" keys are checked.
   */
  validate?: (value: unknown) => boolean
}

export interface AntigravityJsonResult {
  value: unknown
  model: string
  usage: { input: number; output: number; thinking: number }
  ms: number
}

export function antigravityAvailable(): boolean {
  return bin() !== 'agy' || process.env.PATH?.split(path.delimiter).some((dir) => existsSync(path.join(dir, 'agy'))) === true
}

const IMAGE_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
}

interface StagedImages {
  /** Extra CLI arguments that add the folder to the workspace. */
  args: string[]
  /** Prompt lines naming the files to open; '' without images. */
  note: string
  cleanup: () => Promise<void>
}

/** Writes the images to a fresh folder under the working directory; cleanup() removes it. */
async function stageImages(images: CliImage[] | undefined): Promise<StagedImages> {
  if (!images?.length) return { args: [], note: '', cleanup: async () => {} }
  mkdirSync(WORKDIR, { recursive: true })
  const dir = await mkdtemp(path.join(WORKDIR, 'images-'))
  const files = await Promise.all(
    images.map(async (image, i) => {
      const file = path.join(dir, `image-${i + 1}${IMAGE_EXT[image.mimeType] ?? '.png'}`)
      await writeFile(file, Buffer.from(image.data.replace(/^data:[^,]*,/, ''), 'base64'))
      return file
    }),
  )
  return {
    args: ['--add-dir', dir],
    note: ['ATTACHED IMAGES — open and look at each of these files before answering:', ...files.map((f) => `- ${f}`)].join('\n'),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

/** Warm-agent start/stop/restart/fallback events, to check the on/off rules: logs/antigravity-warm.jsonl. */
function logWarmEvent(event: WarmEvent) {
  console.log(`[antigravity-warm] ${event.event}: ${event.reason}`)
  try {
    const dir = path.join(process.cwd(), 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(path.join(dir, 'antigravity-warm.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
  } catch {
    // Logging only.
  }
}

// One warm `agy acp` for every one-shot call (server/llm/acp-pool.ts); kept on globalThis like the slots below.
const warm = ((globalThis as { __antigravityWarm?: WarmAgentPool }).__antigravityWarm ??= new WarmAgentPool({ onEvent: logWarmEvent }))

/** Stops the warm agent (server shutdown). */
export function stopWarmAgent(): void {
  warm.stop('server shutdown', true)
}

// Kept on globalThis: the dev server reloads server modules in-process when they change, and calls still running in
// the old instance must keep counting against the limit.
// Waiting calls are queued per account and served round-robin (PLAN-multi-user-v2.md, 4.3): when a slot frees up, the
// next account in turn that has a call waiting gets it, so one learner's long job (a Listening transcript in parts, a
// 30-word library proposal) cannot hold every slot while someone else waits. With one account it is plain FIFO.
interface SlotState {
  running: number
  queues: Map<string, (() => void)[]>
  order: string[]
}
const slots: SlotState = ((globalThis as { __antigravityRoundRobin?: SlotState }).__antigravityRoundRobin ??= {
  running: 0,
  queues: new Map(),
  order: [],
})

function wakeNext() {
  for (let i = 0; i < slots.order.length; i++) {
    const who = slots.order.shift() as string
    const queue = slots.queues.get(who)
    const next = queue?.shift()
    if (queue?.length) slots.order.push(who)
    else slots.queues.delete(who)
    if (next) return next()
  }
}

/** Runs `task` when one of the ANTIGRAVITY_PARALLEL slots is free; `queueMs` = how long it waited for that slot. */
async function inSlot<T>(task: () => Promise<T>): Promise<T & { queueMs: number }> {
  const queued = Date.now()
  if (slots.running >= maxParallel()) {
    const who = currentUserId() ?? 'system'
    await new Promise<void>((resolve) => {
      const queue = slots.queues.get(who)
      if (queue) queue.push(resolve)
      else {
        slots.queues.set(who, [resolve])
        slots.order.push(who)
      }
    })
  }
  const queueMs = Date.now() - queued
  slots.running++
  try {
    return { ...(await task()), queueMs }
  } finally {
    slots.running--
    wakeNext()
  }
}

/** Calls waiting for a slot, in total and for one account (the "waiting for AI" line in the pages). */
export function queueStatus(uid?: string): { running: number; waiting: number; mine: number } {
  let waiting = 0
  for (const q of slots.queues.values()) waiting += q.length
  return { running: slots.running, waiting, mine: uid ? (slots.queues.get(uid)?.length ?? 0) : 0 }
}

/** The whole JSON answer has arrived on stdout (agy prints it in one piece just before it exits). */
function completeJson(stdout: string): boolean {
  const text = stdout.trim()
  if (!text.startsWith('{') || !text.endsWith('}')) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/**
 * agy sometimes hangs while shutting down after it has printed its answer ("Waiting for migrations to complete…"),
 * and then ignores SIGTERM: waiting for it to exit kept a Speaking job "running" for half an hour. So the call ends as
 * soon as the JSON answer is complete, and the process (its whole group) is stopped — SIGTERM, then SIGKILL.
 */
function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  mkdirSync(WORKDIR, { recursive: true })
  const TIMEOUT_MS = timeoutMs()
  return new Promise((resolve, reject) => {
    // Sandboxed (agy-sandbox.ts): agy sees WORKDIR (with the staged images) read-only, never the project.
    let run: { command: string; args: string[]; cleanup: () => void }
    try {
      run = sandboxedAgy(args, { profile: 'llm', cwd: WORKDIR, ephemeral: ephemeralProfiles() })
    } catch (error) {
      reject(new ApiError(503, (error as Error).message))
      return
    }
    // Own process group, so a stop also reaches anything agy started.
    const child = spawn(run.command, run.args, { cwd: WORKDIR, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    child.on('exit', () => run.cleanup())
    let stdout = ''
    let stderr = ''
    let settled = false
    const signal = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig)
      } catch {
        child.kill(sig)
      }
    }
    const stop = () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      signal('SIGTERM')
      setTimeout(() => child.exitCode === null && child.signalCode === null && signal('SIGKILL'), 3000).unref()
    }
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    }
    child.stdout.on('data', (d: Buffer) => {
      stdout += d
      if (completeJson(stdout)) {
        finish(0)
        // Give it a moment to exit by itself before stopping it.
        setTimeout(stop, 2000).unref()
      }
    })
    child.stderr.on('data', (d: Buffer) => (stderr += d))
    const timer = setTimeout(() => {
      stop()
      // Do not wait for a process that will not die: answer with what arrived.
      setTimeout(() => finish(null), 5000).unref()
    }, TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      reject(new ApiError(503, `Cannot start Antigravity CLI (${bin()}): ${error.message}. Ensure 'agy' and bwrap are installed.`))
    })
    child.on('exit', (code) => {
      // stdout may still hold a last chunk: 'close' delivers it; fall back to 'exit' if close never comes.
      setTimeout(() => finish(code), 1000).unref()
    })
    child.on('close', (code) => finish(code))
  })
}

interface CliOutput {
  status?: string
  response?: string
  error?: string
  structured_output?: unknown
  duration_seconds?: number
  usage?: {
    input_tokens?: number
    output_tokens?: number
    thinking_tokens?: number
    cache_read_tokens?: number
    total_tokens?: number
  }
}

/** agy's own working time and the wait for a free slot, for the usage log. */
function cliTimes(out: CliOutput, queueMs: number): { duration_seconds?: number; queueMs: number } {
  return { ...(typeof out.duration_seconds === 'number' ? { duration_seconds: Math.round(out.duration_seconds * 1000) / 1000 } : {}), queueMs }
}

export async function antigravityJson(request: AntigravityJsonRequest): Promise<AntigravityJsonResult> {
  await chargeAgyCall()
  const staged = await stageImages(request.images)
  try {
    return await runJson(request, staged)
  } finally {
    await staged.cleanup()
  }
}

/**
 * JSON whose strings hold quotes the model did not escape (`"why": "bạn nói "a lot" → nói "plenty""`): a quote inside a
 * string ends it only when what follows can follow a string (`,` `}` `]` `:` or the end); any other is escaped.
 */
export function repairQuotes(text: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString && c === '\\') {
      out += c + (text[i + 1] ?? '')
      i++
      continue
    }
    if (c !== '"') {
      // A raw line break inside a string is invalid JSON too.
      out += inString && c === '\n' ? '\\n' : c
      continue
    }
    if (!inString) {
      inString = true
      out += c
      continue
    }
    const next = text.slice(i + 1).match(/^\s*(.)/)?.[1]
    if (next === undefined || ',}]:'.includes(next)) {
      inString = false
      out += c
    } else out += '\\"'
  }
  return out
}

/** The JSON object in a model's text answer: a ```json block, the outermost { … }, then the same with quotes repaired. */
export function parseStructured(response: string | undefined): unknown {
  if (!response) return undefined
  const trimmed = response.trim()
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const candidates = [match ? match[1].trim() : null, trimmed].filter(Boolean) as string[]
  for (const cand of candidates) {
    const objMatch = cand.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    for (const text of [cand, objMatch?.[1], repairQuotes(cand), objMatch && repairQuotes(objMatch[1])]) {
      if (!text) continue
      try {
        return JSON.parse(text)
      } catch {
        // try the next form
      }
    }
  }
  return undefined
}

/** A warm-agent answer is accepted when `validate` passes, or else when it has the schema's top-level required keys. */
export function acceptable(value: unknown, schema: unknown, validate?: (value: unknown) => boolean): boolean {
  if (value == null || typeof value !== 'object') return false
  if (validate) return validate(value)
  const required = (schema as { required?: unknown })?.required
  return !Array.isArray(required) || required.every((key) => typeof key === 'string' && key in (value as Record<string, unknown>))
}

/** The model id for `session/set_model`: effort is its suffix ("gemini-3.8-flash" + low → "gemini-3.8-flash-low"). */
const warmModelId = (model: string, effort: string | undefined) => (effort ? `${model}-${effort}` : model)

/** A warm-agent turn in the usage log, next to the `agy -p` ones (provider "antigravity-acp"). */
function recordWarmUsage(label: string, model: string, effort: string | undefined, turn: WarmTurn, queueMs: number, failed: boolean) {
  const input = turn.usage?.inputTokens ?? 0
  const thinking = turn.usage?.thoughtTokens ?? 0
  const output = turn.usage?.outputTokens ?? 0
  recordUsage({
    at: new Date().toISOString(),
    label,
    model,
    input,
    output,
    thinking,
    total: input + output + thinking,
    ms: turn.ms + queueMs,
    billing: 'subscription',
    provider: 'antigravity-acp',
    ...(effort ? { effort } : {}),
    ...(failed ? { failed: true } : {}),
    queueMs,
  })
}

/** No JSON came back (the model answered in prose or tried a tool): worth one more try. A timeout is not. */
const retryable = (error: unknown) =>
  error instanceof ApiError && /did not return the JSON answer|instead of returning JSON|gave no valid JSON output(?!: timed out)/.test(error.message)

async function runJson(request: AntigravityJsonRequest, staged: StagedImages): Promise<AntigravityJsonResult> {
  try {
    return await runJsonOnce(request, staged)
  } catch (error) {
    if (!retryable(error)) throw error
    console.warn(`[antigravity-cli] '${request.label}': ${(error as Error).message} — retrying once`)
    return runJsonOnce(request, staged)
  }
}

async function runJsonOnce(request: AntigravityJsonRequest, staged: StagedImages): Promise<AntigravityJsonResult> {
  const schemaStr = JSON.stringify(request.jsonSchema)
  // With images the file viewer is the one tool allowed: it is how the model sees them.
  const toolRules = staged.note
    ? ['THE ONLY TOOL YOU MAY USE IS THE FILE VIEWER, TO OPEN THE ATTACHED IMAGE FILES LISTED BELOW. NO terminal, NO commands, NO other files.']
    : [
        'YOU DO NOT HAVE ACCESS TO A TERMINAL, BASH, CODE EXECUTION, OR ANY TOOLS.',
        'DO NOT CALL ANY TOOLS OR RUN ANY COMMANDS (NO RunCommand, NO file tools). Calling tools is strictly forbidden and will fail immediately.',
      ]
  const fullPrompt = [
    'CRITICAL DIRECTIVE: YOU ARE AN AUTOMATED DATA EXTRACTION API ENGINE.',
    ...toolRules,
    'YOU MUST DIRECTLY OUTPUT THE COMPLETE JSON MATCHING THE SCHEMA BELOW AS YOUR FINAL TEXT RESPONSE.',
    '',
    request.system ? `<system_instruction>\n${request.system}\n</system_instruction>\n` : '',
    staged.note,
    request.prompt,
    '',
    `IMPORTANT: You must respond ONLY with a valid JSON object matching this schema. ${staged.note ? 'Apart from opening the attached images, do not call any tools' : 'Do not call any tools'}, do not output explanations outside the JSON code block:`,
    '```json',
    schemaStr,
    '```',
  ]
    .filter(Boolean)
    .join('\n')
  const effortSuffixRegex = /-(low|medium|high|xhigh|max)$/i
  let model = request.model || 'gemini-3.8-flash'
  const match = model.match(effortSuffixRegex)
  if (match) {
    // Strip the -low/-medium/... suffix so the base model can be passed to --model with --effort.
    model = model.replace(effortSuffixRegex, '')
  }
  // Caller's effort wins over global env and model suffix so per-task effort (e.g. 'low' for fast calls) actually applies.
  const effort = request.effort || process.env.ANTIGRAVITY_EFFORT || match?.[1].toLowerCase()

  // Warm agent first (not for calls with images: those need agy's file viewer); anything unusable falls through to agy -p.
  if (!staged.note) {
    const warmTried = Date.now()
    const turn = await inSlot(async () => ({ turn: await warm.run(request.label, fullPrompt, warmModelId(model, effort)) }))
    if (turn.turn) {
      const value = parseStructured(turn.turn.text)
      const ok = acceptable(value, request.jsonSchema, request.validate)
      recordWarmUsage(request.label, model, effort, turn.turn, turn.queueMs, !ok)
      if (ok) {
        return {
          value,
          model,
          usage: { input: turn.turn.usage?.inputTokens ?? 0, output: turn.turn.usage?.outputTokens ?? 0, thinking: turn.turn.usage?.thoughtTokens ?? 0 },
          ms: Date.now() - warmTried,
        }
      }
      console.warn(`[antigravity-warm] '${request.label}': no usable JSON from the warm agent; running it through agy -p`)
    }
  }

  // The schema goes in the prompt only: agy's --json-schema makes the model submit through an extra tool turn (twice
  // the input tokens, ~5 s more per call); a missing JSON answer is retried once instead.
  const args = [
    '-p',
    fullPrompt,
    '--output-format',
    'json',
    '--disable-slash-commands',
    '--model',
    model,
    ...(effort ? ['--effort', effort] : []),
    ...staged.args,
  ]
  const started = Date.now()
  let { code, stdout, stderr, queueMs } = await inSlot(() => runCli(args))
  if (code !== 0 && effort && (stderr.includes('--effort is not supported') || stderr.includes('effort is not supported') || stderr.includes('conflicts with --effort'))) {
    // Retry without --effort flag if CLI complains
    const retryArgs = ['-p', fullPrompt, '--output-format', 'json', '--disable-slash-commands', '--model', model, ...staged.args]
    const retryRes = await inSlot(() => runCli(retryArgs))
    code = retryRes.code
    stdout = retryRes.stdout
    stderr = retryRes.stderr
    queueMs += retryRes.queueMs
  }
  const ms = Date.now() - started

  let out: CliOutput
  try {
    out = JSON.parse(stdout) as CliOutput
  } catch {
    const detail = (stderr || stdout).trim().slice(0, 300) || (code === null ? `timed out after ${timeoutMs() / 1000}s` : `exit code ${code}`)
    throw new ApiError(502, `Antigravity CLI gave no valid JSON output: ${detail}`)
  }

  const u = out.usage ?? {}
  const input = u.input_tokens ?? 0
  const thinking = u.thinking_tokens ?? 0
  const output = (u.output_tokens ?? 0) - thinking

  let structured = out.structured_output
  if (typeof structured === 'string') {
    try {
      structured = JSON.parse(structured)
    } catch {
      // ignore
    }
  }
  if (structured == null) structured = parseStructured(out.response)

  const usable = out.status === 'SUCCESS' && structured != null
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
    provider: 'antigravity',
    ...(effort ? { effort } : {}),
    ...(usable ? {} : { failed: true }),
    // S (CLI start-up and shutdown) ≈ ms − queueMs − duration_seconds × 1000.
    ...cliTimes(out, queueMs),
  })

  if (structured == null) {
    const denied = (out as { denied_actions?: { action?: string; display_name?: string }[] }).denied_actions
      ?.map((a) => a.display_name || a.action)
      .filter(Boolean)
      .join(', ')
    console.error(`[antigravity-cli] '${request.label}' failed. out keys:`, Object.keys(out), 'status:', out.status, 'denied:', denied, 'full out:', JSON.stringify(out).slice(0, 1000))
    // The whole answer, to see what broke (the log line above is cut short).
    try {
      const dir = path.join(process.cwd(), 'logs', 'antigravity-failed')
      mkdirSync(dir, { recursive: true })
      await writeFile(path.join(dir, `${Date.now()}-${request.label.replace(/[^a-z0-9]+/gi, '-')}.txt`), out.response ?? JSON.stringify(out))
    } catch {
      // Logging only.
    }
    if (denied) {
      throw new ApiError(502, `Antigravity CLI attempted to run tool (${denied}) instead of returning JSON. Please retry.`)
    }
    throw new ApiError(502, 'Antigravity CLI did not return the JSON answer.')
  }
  return { value: structured, model, usage: { input, output, thinking }, ms }
}

export interface AntigravityTextRequest {
  label: string
  system?: string
  prompt: string
  model?: string
  effort?: string
  images?: CliImage[]
}

export interface AntigravityTextResult {
  text: string
  model: string
  usage: { input: number; output: number; thinking: number }
  ms: number
}

export async function antigravityText(request: AntigravityTextRequest): Promise<AntigravityTextResult> {
  await chargeAgyCall()
  const staged = await stageImages(request.images)
  try {
    return await runText(request, staged)
  } finally {
    await staged.cleanup()
  }
}

async function runText(request: AntigravityTextRequest, staged: StagedImages): Promise<AntigravityTextResult> {
  const fullPrompt = [request.system ? `<system_instruction>\n${request.system}\n</system_instruction>` : '', staged.note, request.prompt]
    .filter(Boolean)
    .join('\n\n')
  const effortSuffixRegex = /-(low|medium|high|xhigh|max)$/i
  let model = request.model || 'gemini-3.8-flash'
  const match = model.match(effortSuffixRegex)
  if (match) {
    model = model.replace(effortSuffixRegex, '')
  }
  const effort = request.effort || process.env.ANTIGRAVITY_EFFORT || match?.[1].toLowerCase()

  if (!staged.note) {
    const warmTried = Date.now()
    const turn = await inSlot(async () => ({ turn: await warm.run(request.label, fullPrompt, warmModelId(model, effort)) }))
    const text = turn.turn?.text.trim()
    if (turn.turn) recordWarmUsage(request.label, model, effort, turn.turn, turn.queueMs, !text)
    if (turn.turn && text) {
      const u = turn.turn.usage
      return { text, model, usage: { input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0, thinking: u?.thoughtTokens ?? 0 }, ms: Date.now() - warmTried }
    }
  }

  const args = [
    '-p',
    fullPrompt,
    '--output-format',
    'json',
    '--disable-slash-commands',
    '--model',
    model,
    ...(effort ? ['--effort', effort] : []),
    ...staged.args,
  ]
  const started = Date.now()
  let { code, stdout, stderr, queueMs } = await inSlot(() => runCli(args))
  if (code !== 0 && effort && (stderr.includes('--effort is not supported') || stderr.includes('effort is not supported') || stderr.includes('conflicts with --effort'))) {
    const retryArgs = ['-p', fullPrompt, '--output-format', 'json', '--disable-slash-commands', '--model', model, ...staged.args]
    const retryRes = await inSlot(() => runCli(retryArgs))
    code = retryRes.code
    stdout = retryRes.stdout
    stderr = retryRes.stderr
    queueMs += retryRes.queueMs
  }
  const ms = Date.now() - started

  let out: CliOutput
  try {
    out = JSON.parse(stdout) as CliOutput
  } catch {
    const detail = (stderr || stdout).trim().slice(0, 300) || (code === null ? `timed out after ${timeoutMs() / 1000}s` : `exit code ${code}`)
    throw new ApiError(502, `Antigravity CLI gave no valid JSON output: ${detail}`)
  }

  const u = out.usage ?? {}
  const input = u.input_tokens ?? 0
  const thinking = u.thinking_tokens ?? 0
  const output = (u.output_tokens ?? 0) - thinking

  const text = (out.response ?? '').trim()
  const usable = out.status === 'SUCCESS' && Boolean(text)
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
    provider: 'antigravity',
    ...(effort ? { effort } : {}),
    ...(usable ? {} : { failed: true }),
    // S (CLI start-up and shutdown) ≈ ms − queueMs − duration_seconds × 1000.
    ...cliTimes(out, queueMs),
  })

  if (out.status !== 'SUCCESS') throw new ApiError(502, `Antigravity CLI: ${(out.error ?? out.response ?? 'the request failed').slice(0, 400)}`)
  return { text, model, usage: { input, output, thinking }, ms }
}

/** For tests: the slot queue around one task. */
export const inSlotForTests = inSlot
