import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ApiError, type ApiContext, type ApiHandler } from '../api.ts'
import { contentFile, readJsonFile, writeJsonFile } from '../files.ts'
import { generate, geminiConfigured } from '../gemini.ts'
import { userPath, withUserLock } from '../paths.ts'

/** Per-user history keyed by normalized input text, in insertion order. */
type History = Record<string, string>

const MAX_LENGTH = 4000

/** Without this, flash models tend to echo the whole instruction file before their answer. */
const ANSWER_ONLY = 'Tr\u1ea3 l\u1eddi ngay b\u1eb1ng b\u1ea3n ph\u00e2n t\u00edch (Markdown) cho INPUT TEXT \u1edf tr\u00ean. KH\u00d4NG l\u1eb7p l\u1ea1i ph\u1ea7n h\u01b0\u1edbng d\u1eabn.'

const userHistoryFile = (ctx: ApiContext) => userPath(ctx, 'grammar-history.json')
const sharedLegacyHistoryFile = (ctx: ApiContext) => contentFile(ctx.contentDir, 'grammar/history.json')
const cacheFile = (ctx: ApiContext, key: string) =>
  path.join(ctx.rootDir, 'cache', 'analyze', `${createHash('sha1').update(key).digest('hex')}.md`)

async function readUserHistory(ctx: ApiContext): Promise<History> {
  const raw = await readJsonFile<History | string[]>(userHistoryFile(ctx), {})
  if (Array.isArray(raw)) {
    const out: History = {}
    for (const k of raw) if (typeof k === 'string') out[k] = ''
    return out
  }
  return raw && typeof raw === 'object' ? raw : {}
}

/** Cache key: trimmed text with whitespace runs collapsed, so re-pasted text still hits the cache. */
function historyKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function findEntry(history: History, key: string): [string, string] | undefined {
  if (key in history) return [key, history[key]]
  const stored = Object.keys(history).find((k) => historyKey(k) === key)
  return stored === undefined ? undefined : [stored, history[stored]]
}

async function readSharedCache(ctx: ApiContext, key: string): Promise<string | undefined> {
  try {
    const cached = await readFile(cacheFile(ctx, key), 'utf8')
    if (cached.trim()) return cached
  } catch {
    // not in cache/analyze yet
  }
  const legacy = await readJsonFile<History>(sharedLegacyHistoryFile(ctx), {})
  const hit = findEntry(legacy, key)
  return hit?.[1] || undefined
}

async function writeSharedCache(ctx: ApiContext, key: string, markdown: string): Promise<void> {
  const file = cacheFile(ctx, key)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, markdown, 'utf8')
}

function updateUserHistory(ctx: ApiContext, update: (history: History) => boolean): Promise<boolean> {
  return withUserLock(ctx.user.id, 'grammar-history', async () => {
    const history = await readUserHistory(ctx)
    if (!update(history)) return false
    await writeJsonFile(userHistoryFile(ctx), history)
    return true
  })
}

/** Identical requests arriving while Gemini is still working share one call. */
const inFlight = new Map<string, Promise<string>>()

async function runAnalyze(ctx: ApiContext, key: string, text: string): Promise<string> {
  const template = await readFile(contentFile(ctx.contentDir, 'grammar/analyze-prompt.md'), 'utf8')
  const prompt = `**INPUT TEXT:**\n"""\n${text}\n"""\n\n${ANSWER_ONLY}`
  const { value } = await generate<string>({ system: template.trim(), prompt, temperature: 0.1, label: 'analyze' })
  const raw = value.trim()
  await writeSharedCache(ctx, key, raw).catch(() => {})
  return raw
}

/** Grammar analyzer endpoints. History is isolated per user; markdown results are cached by content hash. */
export const analyzeRoutes: Record<string, ApiHandler> = {
  /** Body `{ text }` ? `{ raw, cached }` (markdown analysis). */
  'POST /analyze': async (req, ctx) => {
    const value = (req.body as { text?: unknown } | undefined)?.text
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text) throw new ApiError(400, 'Please enter a sentence or paragraph to analyze.')
    if (text.length > MAX_LENGTH) throw new ApiError(400, `Text is too long (max ${MAX_LENGTH} characters).`)

    const key = historyKey(text)
    const userHit = findEntry(await readUserHistory(ctx), key)
    if (userHit && userHit[1]) return { json: { raw: userHit[1], cached: true } }

    const cachedRaw = await readSharedCache(ctx, key)
    if (cachedRaw) {
      await updateUserHistory(ctx, (history) => {
        history[key] = cachedRaw
        return true
      })
      return { json: { raw: cachedRaw, cached: true } }
    }

    let pending = inFlight.get(key)
    if (!pending) {
      pending = runAnalyze(ctx, key, text).finally(() => inFlight.delete(key))
      inFlight.set(key, pending)
    }
    const raw = await pending
    await updateUserHistory(ctx, (history) => {
      history[key] = raw
      return true
    })
    return { json: { raw, cached: false } }
  },

  /** ? `{ items, gemini }`: this user's analysed texts, newest first; `gemini` tells whether new analyses are possible. */
  'GET /analyze/history': async (_req, ctx) => {
    const items = Object.keys(await readUserHistory(ctx)).reverse()
    return { json: { items, gemini: geminiConfigured() } }
  },

  /** `?text=` ? removes that entry from this user's history. */
  'DELETE /analyze/history': async (req, ctx) => {
    const text = req.query.get('text')?.trim()
    if (!text) throw new ApiError(400, 'Missing "text" query parameter.')
    const removed = await updateUserHistory(ctx, (history) => {
      const entry = findEntry(history, historyKey(text))
      if (entry) delete history[entry[0]]
      return Boolean(entry)
    })
    if (!removed) throw new ApiError(404, 'Entry not found.')
    return { json: { ok: true } }
  },
}
