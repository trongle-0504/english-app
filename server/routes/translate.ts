import { ApiError, type ApiHandler } from '../api.ts'

export const translateRoutes: Record<string, ApiHandler> = {
  /**
   * POST /api/translate
   * Body: { text: string, from?: string, to?: string }
   * Translates selected English text into Vietnamese using Google Translate.
   */
  'POST /translate': async (req) => {
    const body = (req.body ?? {}) as { text?: unknown; from?: unknown; to?: unknown }
    const raw = String(body.text ?? '').trim()
    if (!raw) throw new ApiError(400, 'Missing "text" field.')

    const text = raw.slice(0, 1500)
    const sl = String(body.from || 'en')
    const tl = String(body.to || 'vi')

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    })

    if (!res.ok) {
      throw new ApiError(502, `Translate service returned HTTP ${res.status}`)
    }

    const data = (await res.json()) as unknown
    let translated = ''
    if (Array.isArray(data) && Array.isArray(data[0])) {
      for (const item of data[0]) {
        if (Array.isArray(item) && typeof item[0] === 'string') {
          translated += item[0]
        }
      }
    }

    if (!translated) {
      throw new ApiError(502, 'Could not parse translation output.')
    }

    return {
      json: {
        original: text,
        translated,
        from: sl,
        to: tl,
      },
    }
  },
}
