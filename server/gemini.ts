import { ApiError } from './api.ts'
import { antigravityAvailable, antigravityJson, antigravityText } from './llm/antigravity-cli.ts'
import { recordUsage } from './usage.ts'

export interface GeminiOptions {
  prompt: string
  /** Instructions sent as systemInstruction, kept apart from the user content. */
  system?: string
  /** Inline images as base64 (no data: prefix). */
  images?: { mimeType: string; data: string }[]
  /** Gemini responseSchema (OpenAPI subset). When set, the response is parsed as JSON. */
  schema?: unknown
  /** Full JSON Schema (responseJsonSchema), e.g. from zod's toJSONSchema. The response is parsed as JSON. */
  jsonSchema?: unknown
  model?: string
  /**
   * How much the model may "think". Gemini 3 models take a level; 2.5 models only take a token budget, so a level is
   * mapped to one (they reject thinkingLevel). Omit for the model's default (dynamic thinking).
   */
  thinking?: ThinkingLevel
  temperature?: number
  retries?: number
  /** Feature and item, for the usage log ("vocabulary: decision"). */
  label?: string
}

export interface GeminiResult<T> {
  value: T
  model: string
  /** thoughtsTokenCount: "thinking" tokens of 2.5 models — billed as output, not included in candidatesTokenCount. */
  usage?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number }
}

export type ThinkingLevel = 'low' | 'medium' | 'high'

/** Every feature uses this model unless GEMINI_MODEL (or a feature's own override) says otherwise. */
export const DEFAULT_MODEL = 'gemini-3-flash-preview'

/** GEMINI_THINKING=low|medium|high; low by default (Gemini 3's own default is high: slower, many more tokens). */
export function defaultThinking(): ThinkingLevel {
  return (['low', 'medium', 'high'] as const).find((l) => l === process.env.GEMINI_THINKING) ?? 'low'
}

/** Token budgets used for 2.5 models (gemini-2.5-flash allows 0–24576). */
const THINKING_BUDGET: Record<ThinkingLevel, number> = { low: 1024, medium: 8192, high: 24576 }

function thinkingConfig(model: string, level: ThinkingLevel | undefined): object {
  if (!level) return {}
  return { thinkingConfig: /^gemini-2\./.test(model) ? { thinkingBudget: THINKING_BUDGET[level] } : { thinkingLevel: level } }
}

export type LlmEngine = 'antigravity' | 'gemini'

/** Default engine: LLM_ENGINE ('antigravity' | 'gemini'), default is 'antigravity'. */
export function defaultLlmEngine(): LlmEngine {
  return process.env.LLM_ENGINE === 'gemini' ? 'gemini' : 'antigravity'
}

/** Antigravity model used when LLM_ENGINE=antigravity: LLM_ANTIGRAVITY_MODEL, else default. */
export function llmAntigravityModel(): string {
  return process.env.LLM_ANTIGRAVITY_MODEL || process.env.SPEAKING_ANTIGRAVITY_MODEL || 'gemini-3.8-flash-medium'
}

export function geminiConfigured(): boolean {
  if (defaultLlmEngine() === 'antigravity') {
    return antigravityAvailable()
  }
  return Boolean(process.env.GEMINI_API_KEY)
}

/** Calls Gemini generateContent with retries. Returns text, or parsed JSON when `schema` is given. */
export async function generate<T = string>(options: GeminiOptions): Promise<GeminiResult<T>> {
  if (defaultLlmEngine() === 'antigravity') {
    const model = options.model || llmAntigravityModel()
    const effort = options.thinking ?? defaultThinking()
    const schema = options.jsonSchema ?? options.schema

    if (schema) {
      const res = await antigravityJson({
        label: options.label ?? 'general',
        system: options.system,
        prompt: options.prompt,
        jsonSchema: schema,
        model,
        effort,
        images: options.images,
      })
      return {
        value: res.value as T,
        model: res.model,
        usage: {
          promptTokenCount: res.usage.input,
          candidatesTokenCount: res.usage.output,
          thoughtsTokenCount: res.usage.thinking,
          totalTokenCount: res.usage.input + res.usage.output + res.usage.thinking,
        },
      }
    }

    const res = await antigravityText({
      label: options.label ?? 'general',
      system: options.system,
      prompt: options.prompt,
      model,
      effort,
      images: options.images,
    })
    return {
      value: res.text as T,
      model: res.model,
      usage: {
        promptTokenCount: res.usage.input,
        candidatesTokenCount: res.usage.output,
        thoughtsTokenCount: res.usage.thinking,
        totalTokenCount: res.usage.input + res.usage.output + res.usage.thinking,
      },
    }
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new ApiError(503, 'GEMINI_API_KEY is not set. Add it to .env and restart the server.')
  const model = options.model || process.env.GEMINI_MODEL || DEFAULT_MODEL
  const thinking = options.thinking ?? defaultThinking()
  const retries = options.retries ?? 3
  const parts: unknown[] = [{ text: options.prompt }]
  for (const image of options.images ?? []) parts.push({ inlineData: image })

  let lastError = 'unknown error'
  for (let attempt = 0; attempt < retries; attempt++) {
    const started = Date.now()
    let usage: GeminiResult<T>['usage']
    // Every billed response is logged, also one that is retried because its text was empty or broken.
    const log = (failed: boolean) => {
      if (!usage) return
      const input = usage.promptTokenCount ?? 0
      const output = usage.candidatesTokenCount ?? 0
      const thinking = usage.thoughtsTokenCount ?? 0
      recordUsage({
        at: new Date().toISOString(),
        label: options.label ?? 'other',
        model,
        input,
        output,
        thinking,
        total: usage.totalTokenCount ?? input + output + thinking,
        ms: Date.now() - started,
        provider: 'gemini_api',
        ...(failed ? { failed: true } : {}),
      })
    }
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
          contents: [{ role: 'user', parts }],
          generationConfig: {
            // Gemini 3 is meant to run at its default temperature (1.0), so per-feature temperatures only apply to 2.x models.
            ...(/^gemini-2\./.test(model) ? { temperature: (options.temperature ?? 0.1) + attempt * 0.05 } : {}),
            ...thinkingConfig(model, thinking),
            // Gemini 3 with the OpenAPI-style responseSchema sometimes breaks its own JSON at low thinking (an apostrophe
            // closes a string, then it loops); the JSON Schema mode stays valid. Our schemas are plain JSON Schema.
            ...(options.schema
              ? /^gemini-2\./.test(model)
                ? { responseMimeType: 'application/json', responseSchema: options.schema }
                : { responseMimeType: 'application/json', responseJsonSchema: options.schema }
              : {}),
            ...(options.jsonSchema ? { responseMimeType: 'application/json', responseJsonSchema: options.jsonSchema } : {}),
          },
        }),
      })
      const payload = (await res.json()) as {
        error?: { message?: string }
        candidates?: { content?: { parts?: { text?: string }[] } }[]
        usageMetadata?: GeminiResult<T>['usage']
      }
      if (!res.ok) throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      usage = payload.usageMetadata
      const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
      if (!text) throw new Error('Empty response')
      const value = (options.schema || options.jsonSchema ? JSON.parse(text) : text) as T
      log(false)
      return { value, model, usage: payload.usageMetadata }
    } catch (error) {
      log(true)
      lastError = (error as Error).message
    }
  }
  throw new ApiError(502, `Gemini request failed after ${retries} attempts: ${lastError}`)
}
