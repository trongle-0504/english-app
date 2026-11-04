import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const notesPath = path.join(rootDir, 'content', 'note', 'notes.json')
const publicDir = path.join(rootDir, 'public', 'note-images')

const UA = 'NeuralSymbolic/1.0 (personal IELTS study app; vocabulary illustrations)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function deriveQueries(note) {
  const queries = []
  let t = note.title
    .replace(/\(.*?\)/g, '')
    .replace(/\+.*$/g, '')
    .replace(/\b(somebody|someone|something|sb|sth|one's|oneself|Adj|Adv|SV|S|V|N|A|B)\b/gi, ' ')
    .replace(/[/\\+]/g, ' ')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

  // remove common filler words
  t = t.replace(/^(to\s+|be\s+|it\s+was\s+|it\s+is\s+|it\s+)/i, '')
  t = t.replace(/\s+(to|for|of|with|that|in|as|on|at|by)$/i, '')
  t = t.trim()

  if (t && t.length > 2) queries.push(t)

  if (t.includes(' vs ')) {
    const parts = t.split(' vs ')
    if (parts[0].trim()) queries.push(parts[0].trim())
  }

  const words = t.split(/\s+/).filter((w) => w.length > 3 && !['that', 'this', 'have', 'make', 'take', 'with', 'from', 'into', 'some', 'come', 'came', 'danger', 'little'].includes(w.toLowerCase()))
  if (words.length > 1) {
    queries.push(words.slice(0, 2).join(' '))
  } else if (words.length === 1 && words[0] !== t) {
    queries.push(words[0])
  }

  // Fallback to key nouns from example if available
  if (note.examples?.[0]?.en) {
    const exWords = note.examples[0].en
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4 && !['always', 'people', 'person', 'because', 'should', 'would', 'could'].includes(w.toLowerCase()))
    if (exWords.length >= 2) {
      queries.push(exWords.slice(0, 2).join(' '))
    }
  }

  return [...new Set(queries.filter(Boolean))]
}

async function searchPixabay(key, q) {
  if (!key) return []
  try {
    const url = `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q.slice(0, 100))}&image_type=photo&safesearch=true&per_page=3&lang=en`
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const d = await res.json()
    return (d.hits ?? []).map((h) => ({
      provider: 'pixabay',
      url: h.webformatURL ?? h.largeImageURL,
      credit: `Pixabay · ${h.user}`,
      source: h.pageURL,
      query: q,
    }))
  } catch {
    return []
  }
}

async function searchWikipedia(q) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=3&prop=pageimages&piprop=thumbnail&pithumbsize=640&gsrsearch=${encodeURIComponent(q)}`
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const d = await res.json()
    return Object.values(d.query?.pages ?? {})
      .filter((p) => p.thumbnail?.source && !/\.svg/i.test(p.thumbnail.source))
      .map((p) => ({
        provider: 'wikipedia',
        url: p.thumbnail.source,
        credit: `Wikipedia · ${p.title}`,
        source: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
        query: q,
      }))
  } catch {
    return []
  }
}

async function searchOpenverse(q) {
  try {
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=3&mature=false`
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const d = await res.json()
    return (d.results ?? []).map((r) => ({
      provider: 'openverse',
      url: r.url ?? r.thumbnail,
      credit: `Openverse · ${r.creator || 'Creator'}`,
      source: r.foreign_landing_url ?? r.url,
      query: q,
    }))
  } catch {
    return []
  }
}

async function findImageCandidate(key, queries) {
  for (const q of queries) {
    const pix = await searchPixabay(key, q)
    if (pix.length > 0) return pix[0]
  }
  for (const q of queries) {
    const wiki = await searchWikipedia(q)
    if (wiki.length > 0) return wiki[0]
    const open = await searchOpenverse(q)
    if (open.length > 0) return open[0]
  }
  return null
}

async function saveWebpImage(url, slug) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const webp = await sharp(buf)
    .rotate()
    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer()

  const filePath = path.join(publicDir, `${slug}.webp`)
  await fs.writeFile(filePath, webp)
  return `/note-images/${slug}.webp`
}

async function main() {
  const pixabayKey = process.env.PIXABAY_API_KEY
  console.log('Pixabay key configured:', Boolean(pixabayKey))

  await fs.mkdir(publicDir, { recursive: true })
  const notesRaw = await fs.readFile(notesPath, 'utf8')
  const notes = JSON.parse(notesRaw)

  const targets = notes.filter((n) => n.type !== 'Structure' && !n.image)
  console.log(`Found ${targets.length} notes to process (excluding Structure, no image).`)

  let success = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < targets.length; i++) {
    const note = targets[i]
    const queries = deriveQueries(note)
    const slug = slugify(note.id || note.title)

    process.stdout.write(`[${i + 1}/${targets.length}] (${note.type}) ${note.title} ... `)

    if (!queries.length) {
      console.log('SKIPPED (no query)')
      skipped++
      continue
    }

    try {
      const candidate = await findImageCandidate(pixabayKey, queries)
      if (!candidate) {
        console.log(`NO IMAGE FOUND (queries: ${queries.join(', ')})`)
        skipped++
        continue
      }

      const imageRelPath = await saveWebpImage(candidate.url, slug)
      note.image = imageRelPath
      note.image_credit = candidate.credit
      note.image_source = candidate.source
      note.image_query = candidate.query

      console.log(`OK -> ${imageRelPath} (${candidate.credit})`)
      success++

      // Save progress to disk every 10 items
      if (success % 10 === 0) {
        await fs.writeFile(notesPath, JSON.stringify(notes, null, 2), 'utf8')
      }

      await sleep(150)
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
      failed++
    }
  }

  // Final save
  await fs.writeFile(notesPath, JSON.stringify(notes, null, 2), 'utf8')
  console.log(`\nDONE! Summary: Success: ${success}, Skipped: ${skipped}, Failed: ${failed}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
