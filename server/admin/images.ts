// Pictures for vocabulary words (Admin → Vocabulary). Search: Pixabay first (free key PIXABAY_API_KEY — the best photos,
// also for abstract words), then Wikipedia search and Openverse (no key). The query should describe a SCENE that shows
// the meaning ("person climbing mountain summit success" for "ambitious"); Gemini writes it as `image_query` when a word is
// generated. The chosen picture is downloaded and stored in public/vocab-images/ (Pixabay links may not be hot-linked
// permanently), shrunk to 640px WebP. Research and comparison: ../image-lab.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { slugify } from '../../content-pipeline/shared.ts'
import { ApiError, type ApiContext } from '../api.ts'

export interface ImageCandidate {
  provider: 'pixabay' | 'wikipedia' | 'openverse'
  /** Small preview for the picker. */
  thumb: string
  /** What is downloaded when the candidate is chosen (~640px). */
  url: string
  title: string
  /** "Pixabay · Hans", "Wikipedia · Basil", "Openverse · CC BY 2.0 · Jane Doe". */
  credit: string
  /** Page to open for the source and licence. */
  source: string
}

const UA = 'LinearThinking/1.0 (personal IELTS study app; vocabulary illustrations)'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let lastWiki = 0
async function getJson(url: string, { wiki = false } = {}): Promise<any> {
  // Wikimedia answers 429 to bursts: one request every 1.5 s.
  if (wiki) {
    const wait = lastWiki + 1500 - Date.now()
    if (wait > 0) await sleep(wait)
    lastWiki = Date.now()
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export const pixabayConfigured = () => Boolean(process.env.PIXABAY_API_KEY)

async function pixabay(q: string, limit: number): Promise<ImageCandidate[]> {
  const key = process.env.PIXABAY_API_KEY
  if (!key) return []
  const d = await getJson(
    `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q.slice(0, 100))}&image_type=photo&safesearch=true&per_page=${Math.max(3, limit)}&lang=en`,
  )
  return (d.hits ?? []).slice(0, limit).map((h: any) => ({
    provider: 'pixabay' as const,
    thumb: h.webformatURL ?? h.previewURL,
    url: h.webformatURL ?? h.largeImageURL,
    title: String(h.tags ?? ''),
    credit: `Pixabay · ${h.user}`,
    source: h.pageURL,
  }))
}

async function wikipedia(q: string, limit: number): Promise<ImageCandidate[]> {
  const d = await getJson(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=6&prop=pageimages&piprop=thumbnail&pithumbsize=640&gsrsearch=${encodeURIComponent(q)}`,
    { wiki: true },
  )
  return Object.values<any>(d.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .filter((p) => p.thumbnail?.source && !/\.svg/i.test(p.thumbnail.source))
    .slice(0, limit)
    .map((p) => ({
      provider: 'wikipedia' as const,
      thumb: p.thumbnail.source,
      url: p.thumbnail.source,
      title: p.title,
      credit: `Wikipedia · ${p.title}`,
      source: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
    }))
}

async function openverse(q: string, limit: number): Promise<ImageCandidate[]> {
  const d = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=${limit + 2}&mature=false`)
  return (d.results ?? []).slice(0, limit).map((r: any) => ({
    provider: 'openverse' as const,
    thumb: r.thumbnail ?? r.url,
    url: r.url ?? r.thumbnail,
    title: String(r.title ?? ''),
    credit: `Openverse · ${String(r.license ?? '').toUpperCase()} ${r.license_version ?? ''}${r.creator ? ` · ${r.creator}` : ''}`.replace(/\s+/g, ' ').trim(),
    source: r.foreign_landing_url ?? r.url,
  }))
}

/** Candidates from every source (a failing source is skipped): Pixabay 4, Wikipedia 3, Openverse 2. */
export async function searchImages(query: string): Promise<{ candidates: ImageCandidate[]; errors: string[] }> {
  const q = query.trim().replace(/\s+/g, ' ')
  if (!q) throw new ApiError(400, 'Empty image query.')
  const errors: string[] = []
  const safe = async (name: string, run: () => Promise<ImageCandidate[]>) => {
    try {
      return await run()
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`)
      return []
    }
  }
  const [a, b, c] = await Promise.all([safe('Pixabay', () => pixabay(q, 4)), safe('Wikipedia', () => wikipedia(q, 3)), safe('Openverse', () => openverse(q, 2))])
  const seen = new Set<string>()
  const candidates = [...a, ...b, ...c].filter((x) => x.url && !seen.has(x.url) && seen.add(x.url))
  return { candidates, errors }
}

/** One good picture fast (bulk updates): Pixabay, then Wikipedia, then Openverse — the next source only when one is empty. */
export async function firstImages(query: string, limit = 3): Promise<ImageCandidate[]> {
  for (const run of [pixabay, wikipedia, openverse]) {
    try {
      const found = await run(query, limit)
      if (found.length) return found
    } catch {
      // next source
    }
  }
  return []
}

export async function storeImage(ctx: ApiContext, word: string, url: string, folder = 'vocab-images'): Promise<string> {
  if (!/^https:\/\//.test(url)) throw new ApiError(400, 'Only https image URLs can be saved.')
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new ApiError(502, `Could not download the picture (HTTP ${res.status}).`)
  if (!/^image\//.test(res.headers.get('content-type') ?? 'image/')) throw new ApiError(502, 'The link is not a picture.')
  let sharp: typeof import('sharp').default
  try {
    sharp = (await import('sharp')).default
  } catch {
    throw new ApiError(503, 'Saving pictures needs the "sharp" package (npm install).')
  }
  const webp = await sharp(Buffer.from(await res.arrayBuffer()))
    .rotate()
    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer()
  const name = slugify(word) || 'item'
  const dir = path.join(ctx.rootDir, 'public', folder)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${name}.webp`), webp)
  // The version query busts browser caches when an item's picture is replaced.
  return `/${folder}/${name}.webp?v=${Date.now().toString(36)}`
}
