// Downloads again the vocabulary and note pictures a minimal data archive leaves out (node scripts/data.ts restore …).
//   node scripts/fetch-images.ts [--dry-run] [--limit N]
// Each word / note keeps where its picture came from (image_source): the same picture is fetched again and saved
// under the same name (image), resized like Admin does (640 px WebP). Pixabay pictures need PIXABAY_API_KEY in .env;
// Wikipedia ones are the page's picture. A picture that cannot be found again (Flickr, a deleted photo) is replaced
// by the first Pixabay result for its image_query, and its credit and source are updated; with no result it is left
// out and listed (pick one in Admin). Pictures already present are skipped, so it can run again after an
// interruption. Pixabay is called once every 1.2 s (~16 min for 800 pictures); when it refuses (429, Cloudflare's
// "Just a moment" page) the run stops at once — try again in 15–60 minutes.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { projectRoot } from './lib/data-paths.ts'

if (existsSync(path.join(projectRoot, '.env'))) process.loadEnvFile(path.join(projectRoot, '.env'))
const { readJsonDoc, writeJsonDoc } = await import('../server/admin/store.ts')

const UA = 'LinearThinking/1.0 (personal IELTS study app; vocabulary illustrations)'
const SETS = [
  { file: 'content/vocabulary/words.json', name: (item: Item) => String(item.word) },
  { file: 'content/note/notes.json', name: (item: Item) => String(item.title) },
]

interface Item {
  image?: string
  image_source?: string
  image_query?: string
  image_credit?: string
  [key: string]: unknown
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limit = Number(args[args.indexOf('--limit') + 1]) || Infinity
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The source refuses us for now (429, or Cloudflare's "Just a moment" page after many calls): stop, try later. */
class Blocked extends Error {}

// Well under Pixabay's 100 API calls a minute: a fast run of ~800 calls got this machine challenged by Cloudflare.
// Wikimedia answers 429 to bursts.
const spacing = { pixabay: 1200, wikipedia: 1500 }
const last = { pixabay: 0, wikipedia: 0 }
async function api(kind: keyof typeof spacing, url: string): Promise<any> {
  const wait = last[kind] + spacing[kind] - Date.now()
  if (wait > 0) await sleep(wait)
  last[kind] = Date.now()
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  const json = (res.headers.get('content-type') ?? '').includes('json')
  if (res.status === 429 || res.status === 403 || (res.ok && !json)) throw new Blocked(`${new URL(url).hostname} is refusing requests for now (HTTP ${res.status})`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** The original picture's URL from its source page, or null when it cannot be found again. */
async function originalUrl(source: string): Promise<string | null> {
  const pixabayId = /pixabay\.com\/.*?-(\d+)\/?$/.exec(source)?.[1]
  if (pixabayId) {
    const key = process.env.PIXABAY_API_KEY
    if (!key) throw new Error('PIXABAY_API_KEY is not set in .env: Pixabay pictures cannot be fetched again.')
    const d = await api('pixabay', `https://pixabay.com/api/?key=${encodeURIComponent(key)}&id=${pixabayId}`)
    return d.hits?.[0]?.webformatURL ?? null
  }
  const wikiTitle = /wikipedia\.org\/wiki\/(.+)$/.exec(source)?.[1]
  if (wikiTitle) {
    const d = await api(
      'wikipedia',
      `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=thumbnail&pithumbsize=640&titles=${encodeURIComponent(decodeURIComponent(wikiTitle))}`,
    )
    const page = Object.values(d.query?.pages ?? {})[0] as { thumbnail?: { source: string } } | undefined
    return page?.thumbnail?.source ?? null
  }
  return null
}

/** A stand-in for a picture that cannot be found again: the first Pixabay result for the same scene, or null. */
async function searchPixabay(query: string): Promise<{ url: string; credit: string; source: string } | null> {
  const key = process.env.PIXABAY_API_KEY
  if (!key) return null
  const d = await api('pixabay', `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query.slice(0, 100))}&image_type=photo&safesearch=true&per_page=3&lang=en`)
  const hit = d.hits?.[0]
  return hit ? { url: hit.webformatURL, credit: `Pixabay · ${hit.user}`, source: hit.pageURL } : null
}

/** Same processing as Admin's storeImage (server/admin/images.ts): at most 640 px, WebP quality 78. */
async function save(url: string, target: string): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
  if (res.status === 429 || res.status === 403) throw new Blocked(`${new URL(url).hostname} is refusing downloads for now (HTTP ${res.status})`)
  if (!res.ok) throw new Error(`download HTTP ${res.status}`)
  const webp = await sharp(Buffer.from(await res.arrayBuffer()))
    .rotate()
    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer()
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, webp)
}

const publicDir = path.join(projectRoot, 'public')
let fetched = 0
let present = 0
const replaced: string[] = []
const failed: string[] = []
let todo = 0
let blocked: string | null = null

for (const set of SETS) {
  if (blocked) break
  const file = path.join(projectRoot, set.file)
  const doc = await readJsonDoc<Item[]>(file, [])
  // Keyed by the picture path: words have no id, and every word or note has its own picture file.
  const changed = new Map<string, Partial<Item>>()
  for (const item of doc.value) {
    if (!item.image?.startsWith('/')) continue
    const target = path.join(publicDir, item.image.split('?')[0])
    if (!target.startsWith(publicDir + path.sep)) continue
    if (existsSync(target)) {
      present++
      continue
    }
    if (todo >= limit) continue
    todo++
    const label = `${set.name(item)} (${item.image.split('?')[0]})`
    if (dryRun) {
      console.log(`missing: ${label} ← ${item.image_source ?? '?'}`)
      continue
    }
    try {
      const url = item.image_source ? await originalUrl(item.image_source) : null
      if (url) {
        await save(url, target)
        fetched++
        console.log(`ok        ${label}`)
      } else {
        // The original cannot be found again: the first search result for the same scene.
        const candidate = await searchPixabay(item.image_query || set.name(item))
        if (!candidate) throw new Error('original not found again and no Pixabay result: pick one in Admin')
        await save(candidate.url, target)
        changed.set(item.image, { image_credit: candidate.credit, image_source: candidate.source })
        replaced.push(`${label}: ${candidate.credit}`)
        console.log(`replaced  ${label}: ${candidate.credit}`)
      }
    } catch (error) {
      // Blocked: stop rather than wait, and never swap in a search result for a picture that still exists at its source.
      if (error instanceof Blocked) {
        blocked = error.message
        break
      }
      failed.push(`${label}: ${(error as Error).message}`)
      console.log(`failed    ${label}: ${(error as Error).message}`)
      if ((error as Error).message.includes('PIXABAY_API_KEY')) break
    }
  }
  // A replaced picture gets its own credit and source; the file name (image) stays the same.
  if (changed.size) {
    const fresh = await readJsonDoc<Item[]>(file, [])
    await writeJsonDoc(file, fresh.value.map((item) => (item.image && changed.has(item.image) ? { ...item, ...changed.get(item.image) } : item)), fresh.style)
  }
}

if (dryRun) console.log(`${todo} picture(s) missing, ${present} present.`)
else {
  // Stopped early, the count of pictures already present is incomplete: left out.
  console.log(`Fetched ${fetched} picture(s) again${blocked ? '' : `, ${present} already present`}, ${replaced.length} replaced, ${failed.length} failed.`)
  if (blocked) console.log(`Stopped: ${blocked}. The pictures fetched so far are kept; run this again in 15–60 minutes to get the rest.`)
  if (failed.length || blocked) process.exitCode = 1
}
