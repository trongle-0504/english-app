import type { ApiContext } from '../api.ts'
import { contentFile, readJsonFile } from '../files.ts'
import { generate, type GeminiOptions, type GeminiResult } from '../gemini.ts'

/** Gemini's responseSchema is an OpenAPI subset: drop JSON-Schema-only keys such as "$schema". */
function toResponseSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toResponseSchema)
  if (!node || typeof node !== 'object') return node
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !key.startsWith('$'))
      .map(([key, value]) => [key, toResponseSchema(value)]),
  )
}

/** Loads content/schema/<name>.json as a Gemini response schema. */
export async function loadSchema(ctx: ApiContext, name: string): Promise<unknown> {
  const schema = await readJsonFile<unknown>(contentFile(ctx.contentDir, 'schema', `${name}.json`), null)
  if (!schema) throw new Error(`Missing content/schema/${name}.json`)
  return toResponseSchema(schema)
}

/**
 * `generate` with a label for the usage log (e.g. "vocabulary: exchange"); generate() logs every response to
 * logs/gemini-usage.jsonl (server/usage.ts), retries included.
 */
export async function generateLogged<T>(_ctx: ApiContext, label: string, options: GeminiOptions): Promise<GeminiResult<T>> {
  return generate<T>({ ...options, label })
}
