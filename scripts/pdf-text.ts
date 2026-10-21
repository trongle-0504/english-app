// Reads a PDF back the way a PDF reader copies its text (for scripts/check-reports.ts): each page in order, each
// font's glyphs through its ToUnicode map, and the glyphs drawn as .notdef (a letter the font lacks: a box).
import { inflateSync } from 'node:zlib'

/**
 * The text a PDF shows, read back through each font's ToUnicode map (as a PDF reader copies it), and the glyphs drawn
 * with id 0 (.notdef: a letter the embedded font does not have, shown as a box).
 */
export function readPdf(pdf: Buffer): { pages: number; text: string; pageTexts: string[]; missing: number } {
  const raw = pdf.toString('latin1')
  // Objects in order; a stream's bytes are cut by its /Length (font files are binary and may hold "endobj").
  const objects = new Map<number, { dict: string; data?: Buffer }>()
  const at = /(\d+) 0 obj/g
  for (let m = at.exec(raw); m; m = at.exec(raw)) {
    const start = m.index + m[0].length
    const end = raw.indexOf('endobj', start)
    const streamAt = raw.indexOf('stream', start)
    if (streamAt < 0 || streamAt > end) {
      objects.set(Number(m[1]), { dict: raw.slice(start, end) })
      at.lastIndex = end
      continue
    }
    const dict = raw.slice(start, streamAt)
    let from = streamAt + 'stream'.length
    if (raw[from] === '\r') from++
    if (raw[from] === '\n') from++
    const length = Number(/\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)?.[1])
    const to = Number.isFinite(length) ? from + length : raw.indexOf('endstream', from)
    const bytes = Buffer.from(raw.slice(from, to), 'latin1')
    objects.set(Number(m[1]), { dict, data: /\/FlateDecode/.test(dict) ? inflateSync(bytes) : bytes })
    at.lastIndex = to
  }
  const ref = (dict: string, key: string) => Number(new RegExp(`/${key}\\s+(\\d+) 0 R`).exec(dict)?.[1])
  // Each font's glyph id → text, from its ToUnicode CMap.
  const maps = new Map<number, Map<number, string>>()
  for (const [id, o] of objects) {
    const cmap = objects.get(ref(o.dict, 'ToUnicode'))?.data?.toString('latin1')
    if (!/\/Type\s*\/Font/.test(o.dict) || !cmap) continue
    const map = new Map<number, string>()
    const hex = (h: string) => Buffer.from(h, 'hex').swap16().toString('utf16le')
    for (const b of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const c of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(c[1], 16), hex(c[2]))
    for (const b of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const r of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
        const [from, to] = [parseInt(r[1], 16), parseInt(r[2], 16)]
        const dest = [...r[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1])
        for (let g = from; g <= to; g++) map.set(g, dest.length > 1 ? hex(dest[g - from]) : String.fromCodePoint(parseInt(dest[0], 16) + g - from))
      }
    }
    maps.set(id, map)
  }
  let text = ''
  const pageTexts: string[] = []
  let missing = 0
  let pages = 0
  for (const [, page] of objects) {
    if (!/\/Type\s*\/Page\b/.test(page.dict)) continue
    pages++
    const before = text.length
    const resources = /\/Resources\s*<<([\s\S]*)>>/.exec(page.dict)?.[1] ?? objects.get(ref(page.dict, 'Resources'))?.dict ?? ''
    const fontDict = /\/Font\s*<<([\s\S]*?)>>/.exec(resources)?.[1] ?? objects.get(ref(resources, 'Font'))?.dict ?? ''
    const fonts = new Map([...fontDict.matchAll(/\/(\w+)\s+(\d+) 0 R/g)].map((m) => [m[1], Number(m[2])]))
    const contents = [...(/\/Contents\s*\[([^\]]*)\]/.exec(page.dict)?.[1] ?? `${ref(page.dict, 'Contents')} 0 R`).matchAll(/(\d+) 0 R/g)]
    for (const c of contents) {
      const ops = objects.get(Number(c[1]))?.data?.toString('latin1') ?? ''
      let map = new Map<number, string>()
      for (const op of ops.matchAll(/\/(\w+)\s+[\d.]+\s+Tf|(\[[^\]]*\])\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
        if (op[1]) {
          map = maps.get(fonts.get(op[1]) ?? -1) ?? new Map()
          continue
        }
        for (const h of (op[2] ?? `<${op[3]}>`).matchAll(/<([0-9a-fA-F]*)>/g)) {
          for (let i = 0; i + 4 <= h[1].length; i += 4) {
            const gid = parseInt(h[1].slice(i, i + 4), 16)
            if (gid === 0) missing++
            text += map.get(gid) ?? ''
          }
        }
        text += ' '
      }
    }
    pageTexts.push(text.slice(before))
  }
  return { pages, text, pageTexts, missing }
}

