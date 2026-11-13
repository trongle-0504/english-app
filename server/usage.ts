// AI token usage: every Gemini response (also a retried attempt whose JSON was broken — its tokens are billed too) is
// appended to logs/gemini-usage.jsonl by server/gemini.ts, and every Claude Code call by server/llm/claude-code.ts
// (billing "subscription": runs on the user's Claude plan, 0 USD). Older entries from logs/gemini_usage.json are read as well.
// Prices: config/gemini-pricing.json (USD per 1M tokens), editable in Admin → Usage.
import { appendFileSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const LOG_DIR = path.join(ROOT, 'logs')
const LOG = path.join(LOG_DIR, 'gemini-usage.jsonl')
const LEGACY_LOG = path.join(LOG_DIR, 'gemini_usage.json')
const PRICING = path.join(ROOT, 'config', 'gemini-pricing.json')

export type UsageProvider = 'antigravity' | 'antigravity-acp' | 'claude' | 'gemini_api'

export interface UsageEntry {
  /** ISO time of the response. */
  at: string
  /** "vocabulary: decision", "writing-review: judge", "analyze"… */
  label: string
  model: string
  input: number
  output: number
  /** Thinking tokens: billed at the output price. */
  thinking: number
  total: number
  ms: number
  /** The response was not usable (empty or broken JSON) and the call was retried. */
  failed?: boolean
  /** "subscription": Claude through the user's Claude plan (Claude Code) — no per-token bill. */
  billing?: 'subscription'
  /** Provider: 'antigravity', 'claude', or 'gemini_api'. */
  provider?: UsageProvider
  /** Effort passed to the CLI (--effort), when there was one. */
  effort?: string
  /** `agy -p` only: the CLI's own working time as it reports it. ms − queueMs − this = CLI start-up and shutdown. */
  duration_seconds?: number
  /** Antigravity: time spent waiting for a free ANTIGRAVITY_PARALLEL slot (included in `ms`). */
  queueMs?: number
}

export function providerOf(e: UsageEntry): UsageProvider {
  if (e.provider) return e.provider
  if (e.model.startsWith('claude')) return 'claude'
  if (e.billing === 'subscription') return 'antigravity'
  return 'gemini_api'
}

/** Called by generate() for every response that carries usage metadata. Never throws. */
export function recordUsage(entry: UsageEntry): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    appendFileSync(LOG, `${JSON.stringify(entry)}\n`)
  } catch (error) {
    console.warn('[usage] could not write:', (error as Error).message)
  }
}

interface LegacyEntry {
  label: string
  model: string
  duration_seconds: number
  prompt_token_count: number
  candidates_token_count: number
  total_token_count: number
  timestamp: string
}

export async function readUsage(): Promise<UsageEntry[]> {
  const entries: UsageEntry[] = []
  try {
    const legacy = JSON.parse(await readFile(LEGACY_LOG, 'utf8')) as LegacyEntry[]
    for (const e of Array.isArray(legacy) ? legacy : []) {
      const input = e.prompt_token_count ?? 0
      const output = e.candidates_token_count ?? 0
      const total = e.total_token_count ?? input + output
      // The old log had no thinking count; the API's total includes it.
      entries.push({ at: e.timestamp, label: e.label, model: e.model, input, output, thinking: Math.max(0, total - input - output), total, ms: Math.round((e.duration_seconds ?? 0) * 1000) })
    }
  } catch {
    // no legacy log
  }
  try {
    for (const line of (await readFile(LOG, 'utf8')).split('\n')) {
      if (!line.trim()) continue
      try {
        entries.push(JSON.parse(line) as UsageEntry)
      } catch {
        // a torn last line is skipped
      }
    }
  } catch {
    // no log yet
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at))
}

export interface ModelPrice {
  input: number
  output: number
  inputLong?: number
  outputLong?: number
  longAbove?: number
}

export interface Pricing {
  source?: string
  updated?: string
  usdToVnd: number
  models: Record<string, ModelPrice>
}

export async function readPricing(): Promise<Pricing> {
  try {
    const p = JSON.parse(await readFile(PRICING, 'utf8')) as Pricing
    return { ...p, usdToVnd: Number(p.usdToVnd) || 0, models: p.models ?? {} }
  } catch {
    return { usdToVnd: 0, models: {} }
  }
}

export async function writePricing(pricing: Pricing): Promise<void> {
  const current = JSON.parse(await readFile(PRICING, 'utf8').catch(() => '{}')) as Record<string, unknown>
  await writeFile(PRICING, `${JSON.stringify({ ...current, ...pricing }, null, 2)}\n`)
}

/** Price of a model: exact name, else the longest known name it starts with ("gemini-2.5-flash-preview-09" → 2.5 flash). */
export function priceOf(pricing: Pricing, model: string): ModelPrice | undefined {
  if (pricing.models[model]) return pricing.models[model]
  const match = Object.keys(pricing.models)
    .filter((m) => model.startsWith(m))
    .sort((a, b) => b.length - a.length)[0]
  return match ? pricing.models[match] : undefined
}

/** USD cost of one call; null when the model has no price. */
export function costOf(pricing: Pricing, e: UsageEntry): number | null {
  if (e.billing === 'subscription') return 0
  const p = priceOf(pricing, e.model)
  if (!p) return null
  const long = p.longAbove != null && e.input > p.longAbove
  const inPrice = long && p.inputLong != null ? p.inputLong : p.input
  const outPrice = long && p.outputLong != null ? p.outputLong : p.output
  return (e.input * inPrice + (e.output + e.thinking) * outPrice) / 1_000_000
}

/** "writing-review: judge" → "writing-review"; feature names shown in Admin → Usage. */
// Display names by label prefix ("vocabulary: exchange" → "vocabulary"). A new generateLogged label needs a line here;
// an unknown prefix is still counted, just shown under its raw key.
export const FEATURES: Record<string, string> = {
  'writing-review': 'Writing Review',
  speaking: 'Speaking ideas',
  'speaking-sync': 'Speaking ideas · Sync',
  analyze: 'Grammar Analyze',
  vocabulary: 'Admin · Vocabulary',
  'vocabulary lemma': 'Admin · Vocabulary',
  note: 'Admin · Notes',
  'note lemma': 'Admin · Notes',
  grammar: 'Admin · Grammar',
  practice: 'Admin · Practice questions',
  essay: 'Admin · Essays',
  'essay item': 'Admin · Essays',
  'essay rebuild': 'Model essays · Rebuild',
  'essay transfer': 'Model essays · Use it',
  review: 'Review · My cards',
  coach: 'Nova Agent',
  'review produce': 'Review · Viết câu (Viết lại câu / Tự dùng)',
  selftest: 'Test',
  test: 'Test',
}

export function featureOf(label: string): string {
  const key = label.split(':')[0].trim()
  return FEATURES[key] ?? key ?? 'Other'
}
