import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ApiError, type ApiHandler } from '../api.ts'

const memCache = new Map<string, Buffer>()
const MAX_MEM_ITEMS = 250

function getCached(cacheDir: string, key: string): Buffer | null {
  const mem = memCache.get(key)
  if (mem) return mem
  const filePath = join(cacheDir, `${key}.mp3`)
  if (existsSync(filePath)) {
    try {
      const buf = readFileSync(filePath)
      if (buf.length > 100) {
        if (memCache.size >= MAX_MEM_ITEMS) {
          const oldest = memCache.keys().next().value
          if (oldest) memCache.delete(oldest)
        }
        memCache.set(key, buf)
        return buf
      }
    } catch {
      // ignore read errors
    }
  }
  return null
}

function setCached(cacheDir: string, key: string, buf: Buffer): void {
  if (memCache.size >= MAX_MEM_ITEMS) {
    const oldest = memCache.keys().next().value
    if (oldest) memCache.delete(oldest)
  }
  memCache.set(key, buf)
  try {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, `${key}.mp3`), buf)
  } catch {
    // ignore disk cache write errors
  }
}

export const ttsRoutes: Record<string, ApiHandler> = {
  /**
   * GET /api/tts?q=...
   * Returns British English (en-GB, Google UK English Female) MP3 audio so mobile devices
   * (Android / iOS) and browsers without built-in UK cloud voices get the exact same
   * "Best British voice" as Chrome Desktop.
   */
  'GET /tts': async (req, ctx) => {
    const raw = (req.query.get('q') ?? '').replace(/\s+/g, ' ').trim()
    if (!raw) throw new ApiError(400, 'Missing text parameter "q".')
    const text = raw.slice(0, 260)
    const key = createHash('sha1').update(`en-GB:${text}`).digest('hex')
    const cacheDir = join(ctx.rootDir, 'cache', 'tts')

    const cached = getCached(cacheDir, key)
    if (cached) {
      return {
        body: cached,
        contentType: 'audio/mpeg',
        headers: { 'Cache-Control': 'private, max-age=86400' },
      }
    }

    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en-GB&q=${encodeURIComponent(text)}`
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.8',
      },
    })

    if (!response.ok) {
      throw new ApiError(502, `TTS upstream returned HTTP ${response.status}`)
    }

    const arrayBuf = await response.arrayBuffer()
    const buf = Buffer.from(arrayBuf)
    if (buf.length < 100) {
      throw new ApiError(502, 'Empty audio returned from TTS upstream.')
    }

    setCached(cacheDir, key, buf)
    return {
      body: buf,
      contentType: 'audio/mpeg',
      headers: { 'Cache-Control': 'private, max-age=86400' },
    }
  },
}
