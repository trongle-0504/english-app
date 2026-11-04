// For hand-picking pictures: searches every source for each "index|query" line and writes a contact sheet with numbered
// candidates (thumbnails inlined) plus a JSON of the candidates. Usage: node scripts/pick-sheet.ts <queries.txt> <out-prefix>
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
process.loadEnvFile(path.join(import.meta.dirname, '..', '.env'))
const { searchImages } = await import('../server/admin/images.ts')
const sharp = createRequire(import.meta.url)('sharp')
const words = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'content', 'vocabulary', 'words.json'), 'utf8'))
const lines = readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => l.split('|'))
const out: Record<string, unknown> = {}
const rows: string[] = []
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
for (const [i, q] of lines) {
  const { candidates } = await searchImages(q)
  out[i] = { query: q, candidates }
  const cells: string[] = []
  for (const [n, c] of candidates.entries()) {
    let src = ''
    try {
      const res = await fetch(c.thumb, { headers: { 'User-Agent': 'NeuralSymbolic/1.0 (personal study app)' }, signal: AbortSignal.timeout(15000) })
      src = `data:image/webp;base64,${(await sharp(Buffer.from(await res.arrayBuffer())).resize(150, 110, { fit: 'cover' }).webp({ quality: 60 }).toBuffer()).toString('base64')}`
    } catch {}
    cells.push(`<figure>${src ? `<img src="${src}">` : '<div class="x">×</div>'}<figcaption>${n} · ${c.provider}</figcaption></figure>`)
  }
  rows.push(`<section><h3>${i}. ${esc(words[Number(i)]?.word)} <small>${esc(q)}</small></h3><div>${cells.join('')}</div></section>`)
  console.log(i, candidates.length)
}
writeFileSync(`${process.argv[3]}.json`, JSON.stringify(out))
writeFileSync(`${process.argv[3]}.html`, `<!doctype html><meta charset="utf-8"><style>body{font:12px system-ui;margin:12px}section{margin-bottom:6px}h3{margin:4px 0;font-size:13px}small{color:#7c3aed;font-weight:400}section div{display:flex;gap:4px}figure{margin:0}img,.x{width:150px;height:110px;object-fit:cover;display:block;border-radius:4px;background:#eee}figcaption{font-size:11px;color:#475569}</style>${rows.join('')}`)
