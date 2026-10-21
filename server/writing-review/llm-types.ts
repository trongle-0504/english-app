import type { z } from 'zod'

export interface JsonRequest<T> {
  /** Short name for logs, e.g. "extract". */
  label: string
  system: string
  prompt: string
  schema: z.ZodType<T>
  /** Overrides the configured effort for this call (a small extraction step runs at "low"). */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

export interface JsonResult<T> {
  value: T
  model: string
  /** thinking: reasoning tokens (Gemini 2.5), billed as output but counted separately. */
  usage: { input: number; output: number; thinking?: number }
}

/** A model that returns JSON matching a Zod schema. */
export interface LlmProvider {
  name: string
  model: string
  json<T>(request: JsonRequest<T>): Promise<JsonResult<T>>
}
