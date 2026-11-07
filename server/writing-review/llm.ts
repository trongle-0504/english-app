// The model used by Writing review: Claude only, run through the Claude Code CLI on the user's own Claude plan
// (server/llm/claude-code.ts) — no Gemini. JSON Schemas are built from the Zod schemas; every call is logged to the
// usage log and reported to `onCall` for the live token count.
import { z } from 'zod'
import { antigravityAvailable, antigravityJson } from '../llm/antigravity-cli.ts'
import { claudeCodeAvailable, claudeJson, type ClaudeEffort } from '../llm/claude-code.ts'
import type { JsonRequest, JsonResult, LlmProvider } from './llm-types.ts'

export type WritingReviewEngine = 'antigravity' | 'claude'

// Read at call time, not at import: the dev server loads .env after this module is imported.
/** Default engine: WRITING_REVIEW_ENGINE ('antigravity' | 'claude'), default is 'antigravity'. */
export const defaultWritingReviewEngine = (): WritingReviewEngine =>
  process.env.WRITING_REVIEW_ENGINE === 'claude' ? 'claude' : 'antigravity'

/** Antigravity model: WRITING_REVIEW_ANTIGRAVITY_MODEL, else SPEAKING_ANTIGRAVITY_MODEL, else default. */
export const writingReviewAntigravityModel = () =>
  process.env.WRITING_REVIEW_ANTIGRAVITY_MODEL || process.env.SPEAKING_ANTIGRAVITY_MODEL || 'gemini-3.8-flash-medium'

/** Model alias or id for Claude Code ("opus", "sonnet", "claude-opus-5-5"); empty = the plan's default model. */
const claudeModel = () => process.env.WRITING_REVIEW_CLAUDE_MODEL || ''

/** Shown before the first answer tells which model the plan actually ran. */
export const writingReviewModelName = () => {
  if (defaultWritingReviewEngine() === 'antigravity') {
    return writingReviewAntigravityModel()
  }
  return claudeModel() || 'Claude'
}

/** Check if the configured engine is ready/available. */
export const writingReviewEngineAvailable = () =>
  defaultWritingReviewEngine() === 'antigravity' ? antigravityAvailable() : claudeCodeAvailable()

/** Effort for diagnose and every writing-review call that passes no effort of its own: WRITING_REVIEW_EFFORT, default low. */
export const writingReviewEffort = (): ClaudeEffort =>
  (['low', 'medium', 'high', 'xhigh', 'max'] as const).find((l) => l === process.env.WRITING_REVIEW_EFFORT) ?? 'low'

/** Effort for checking calls (retry, plan notes, essay review, wording): WRITING_CHECK_EFFORT, default low. */
export const writingCheckEffort = (): ClaudeEffort =>
  (['low', 'medium', 'high', 'xhigh', 'max'] as const).find((l) => l === process.env.WRITING_CHECK_EFFORT) ?? 'low'

/** Effort for score call: WRITING_SCORE_EFFORT, default low. */
export const writingScoreEffort = (): ClaudeEffort =>
  (['low', 'medium', 'high', 'xhigh', 'max'] as const).find((l) => l === process.env.WRITING_SCORE_EFFORT) ?? 'low'

export interface CallUsage {
  label: string
  model: string
  input: number
  output: number
  thinking: number
  ms?: number
}

function jsonSchema(schema: z.ZodType): unknown {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>
  return rest
}

export function writingReviewModel({
  onStart,
  onCall,
  engine,
}: { onStart?: (label: string) => void; onCall?: (call: CallUsage) => void; engine?: WritingReviewEngine } = {}): LlmProvider {
  const activeEngine = engine ?? defaultWritingReviewEngine()
  return {
    name: activeEngine === 'antigravity' ? 'antigravity' : 'claude-code',
    model: writingReviewModelName(),
    async json<T>({ label, system, prompt, schema, effort = writingReviewEffort() }: JsonRequest<T>): Promise<JsonResult<T>> {
      onStart?.(label)
      if (activeEngine === 'antigravity') {
        const result = await antigravityJson({
          label: `writing-review: ${label}`,
          system,
          prompt,
          jsonSchema: jsonSchema(schema),
          model: writingReviewAntigravityModel(),
          effort,
        })
        const usage = result.usage
        onCall?.({ label, model: result.model, ...usage, ms: result.ms })
        return { value: schema.parse(result.value), model: result.model, usage }
      }

      const tStartClaude = Date.now()
      const result = await claudeJson({
        label: `writing-review: ${label}`,
        system,
        prompt,
        jsonSchema: jsonSchema(schema),
        model: claudeModel() || undefined,
        effort,
      })
      const usage = result.usage
      onCall?.({ label, model: result.model, ...usage, ms: Date.now() - tStartClaude })
      return { value: schema.parse(result.value), model: result.model, usage }
    },
  }
}
