import { readFile } from 'node:fs/promises'
import { ApiError, type ApiContext, type ApiHandler } from '../api.ts'
import { contentFile, readJsonFile, writeJsonFile } from '../files.ts'
import { generate, geminiConfigured } from '../gemini.ts'

/** Cached analyses keyed by input text (see `historyKey`), in insertion order. */
type History = Record<string, string>

const MAX_LENGTH = 4000

/** Without this, flash models (seen with gemini-2.5-flash-lite) tend to echo the whole instruction file before their answer. */
const ANSWER_ONLY = 'Trả lời ngay bằng bản phân tích (Markdown) cho INPUT TEXT ở trên. KHÔNG lặp lại phần hướng dẫn.'

const historyFile = (ctx: ApiContext) => contentFile(ctx.contentDir, 'grammar/history.json')
const readHistory = (ctx: ApiContext) => readJsonFile<History>(historyFile(ctx), {})

/** Cache key: trimmed text with whitespace runs collapsed, so re-pasted text still hits the cache. */
function historyKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/** Entries written before keys were normalised may still contain line breaks or double spaces. */
function findEntry(history: History, key: string): [string, string] | undefined {
  if (key in history) return [key, history[key]]
  const stored = Object.keys(history).find((k) => historyKey(k) === key)
  return stored === undefined ? undefined : [stored, history[stored]]
}

/** Serialises read-modify-write cycles on history.json within this process. */
let pendingWrite: Promise<unknown> = Promise.resolve()

/** Applies `update` to the latest history; it returns false to skip the write. */
function updateHistory(ctx: ApiContext, update: (history: History) => boolean): Promise<boolean> {
  const run = async () => {
    // Re-read right before writing so edits made since the request started are kept.
    const history = await readHistory(ctx)
    if (!update(history)) return false
    await writeJsonFile(historyFile(ctx), history)
    ctx.onContentChange()
    return true
  }
  const result = pendingWrite.then(run)
  pendingWrite = result.catch(() => {})
  return result
}

/** Identical requests arriving while Gemini is still working share one call. */
const inFlight = new Map<string, Promise<string>>()

async function analyze(ctx: ApiContext, key: string, text: string): Promise<string> {
  const template = await readFile(contentFile(ctx.contentDir, 'grammar/analyze-prompt.md'), 'utf8')
  const prompt = `**INPUT TEXT:**\n"""\n${text}\n"""\n\n${ANSWER_ONLY}`
  const { value } = await generate<string>({ system: template.trim(), prompt, temperature: 0.1, label: 'analyze' })
  const raw = value.trim()
  await updateHistory(ctx, (history) => {
    history[key] = raw
    return true
  })
  return raw
}


/** Grammar analyzer endpoints. */
export const analyzeRoutes: Record<string, ApiHandler> = {
  /** Body `{ text }` → `{ raw, cached }` (markdown analysis). */
  'POST /analyze': async (req, ctx) => {
    const value = (req.body as { text?: unknown } | undefined)?.text
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text) throw new ApiError(400, 'Please enter a sentence or paragraph to analyze.')
    if (text.length > MAX_LENGTH) throw new ApiError(400, `Text is too long (max ${MAX_LENGTH} characters).`)

    const key = historyKey(text)
    const hit = findEntry(await readHistory(ctx), key)
    if (hit) return { json: { raw: hit[1], cached: true } }

    let pending = inFlight.get(key)
    if (!pending) {
      pending = analyze(ctx, key, text).finally(() => inFlight.delete(key))
      inFlight.set(key, pending)
    }
    return { json: { raw: await pending, cached: false } }
  },

  /** → `{ items, gemini }`: analysed texts, newest first; `gemini` tells whether new analyses are possible. */
  'GET /analyze/history': async (_req, ctx) => {
    const items = Object.keys(await readHistory(ctx)).reverse()
    return { json: { items, gemini: geminiConfigured() } }
  },

  /** `?text=` → removes that entry. */
  'DELETE /analyze/history': async (req, ctx) => {
    const text = req.query.get('text')?.trim()
    if (!text) throw new ApiError(400, 'Missing "text" query parameter.')
    const removed = await updateHistory(ctx, (history) => {
      const entry = findEntry(history, historyKey(text))
      if (entry) delete history[entry[0]]
      return Boolean(entry)
    })
    if (!removed) throw new ApiError(404, 'Entry not found.')
    return { json: { ok: true } }
  },
}
