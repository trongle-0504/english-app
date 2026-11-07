// Engine caller for Speaking ideas: supports Claude (via Claude Code CLI) and Antigravity (via Antigravity CLI / agy).
// Settings are read at call time (the dev server loads .env after this module is imported).
import { z } from 'zod'
import { antigravityJson } from '../llm/antigravity-cli.ts'
import { claudeJson, type ClaudeEffort } from '../llm/claude-code.ts'
import type { SpeakingEngine } from '../../src/types/speaking.ts'

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const effortOf = (value: string | undefined, fallback: ClaudeEffort): ClaudeEffort => EFFORTS.find((l) => l === value) ?? fallback

/** SPEAKING_CLAUDE_MODEL, else Writing Review's model, else the plan's default. */
export const speakingModel = () => process.env.SPEAKING_CLAUDE_MODEL || process.env.WRITING_REVIEW_CLAUDE_MODEL || ''
/** Default engine: SPEAKING_ENGINE ('antigravity' | 'claude'), default is 'antigravity' from env. */
export const defaultSpeakingEngine = (): SpeakingEngine => (process.env.SPEAKING_ENGINE === 'claude' ? 'claude' : 'antigravity')
/** Antigravity CLI model: default is gemini-3.8-flash-medium. */
export const antigravityModel = () => process.env.SPEAKING_ANTIGRAVITY_MODEL || 'gemini-3.8-flash-medium'
/** Effort of the suggestion call (the answer writing); the question analysis always runs at low. */
export const speakingEffort = () => effortOf(process.env.SPEAKING_EFFORT, 'medium')
/**
 * Effort of the editing pass that makes the answers precise and natural: SPEAKING_POLISH_EFFORT, else the same as the
 * answer call. (A fixed "medium" made Gemini Flash think ~18k tokens here: two minutes, most of a run's time.)
 */
export const polishEffort = () => effortOf(process.env.SPEAKING_POLISH_EFFORT, speakingEffort())
/** Effort of the tagging calls in a sync (a simple classification). */
export const tagEffort = () => effortOf(process.env.SPEAKING_TAG_EFFORT, 'low')
/**
 * Effort of Speaking review calls: SPEAKING_REVIEW_EFFORT, default 'low' (at 'medium', thinking tokens of 5k–20k
 * drove review times to 1–4 min on a 1-minute recording).
 */
export const speakingReviewEffort = () => effortOf(process.env.SPEAKING_REVIEW_EFFORT, 'low')
/** Effort of Call A (score + criteria) in Speaking review: SPEAKING_REVIEW_SCORE_EFFORT, else speakingReviewEffort(). */
export const speakingScoreEffort = () => effortOf(process.env.SPEAKING_REVIEW_SCORE_EFFORT, speakingReviewEffort())

export interface SpeakingCall<T> {
  label: string
  system: string
  prompt: string
  schema: z.ZodType<T>
  effort: ClaudeEffort
  engine?: SpeakingEngine
}

export async function speakingJson<T>({ label, system, prompt, schema, effort, engine }: SpeakingCall<T>) {
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>
  const activeEngine = engine ?? defaultSpeakingEngine()
  if (activeEngine === 'antigravity') {
    const result = await antigravityJson({
      label,
      system,
      prompt,
      jsonSchema,
      model: antigravityModel(),
      effort,
    })
    return { value: schema.parse(result.value), model: result.model, usage: result.usage }
  }
  const result = await claudeJson({ label, system, prompt, jsonSchema, model: speakingModel() || undefined, effort })
  return { value: schema.parse(result.value), model: result.model, usage: result.usage }
}
