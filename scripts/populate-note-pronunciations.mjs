import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const notesPath = path.join(rootDir, 'content', 'note', 'notes.json')
const dictPath = path.join(rootDir, 'public', 'pronunciation', 'en-gb.tsv')

function cleanTokens(title) {
  return title
    .replace(/\(.*?\)/g, '')
    .replace(/\+.*$/g, '')
    .replace(/\b(somebody|someone|something|sb|sth|one's|oneself|Adj|Adv|SV|S|V|N|A|B)\b/gi, ' ')
    .replace(/[/\\+]/g, ' ')
    .replace(/[^a-zA-Z0-9\s-']/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

async function loadDict() {
  const text = await fs.readFile(dictPath, 'utf8')
  const dict = new Map()
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab > 0) dict.set(line.slice(0, tab), line.slice(tab + 1))
  }
  return dict
}

function getIpaFromDict(title, dict) {
  const cleaned = cleanTokens(title)
  if (!cleaned) return null
  const words = cleaned.toLowerCase().split(/\s+/)
  const ipas = []
  for (const w of words) {
    let hit = dict.get(w)
    if (!hit && w.includes('-')) {
      const parts = w.split('-')
      const pIpas = parts.map((p) => dict.get(p))
      if (pIpas.every(Boolean)) hit = '/' + pIpas.map((p) => p.replace(/^\/|\/$/g, '')).join(' ') + '/'
    }
    if (hit) {
      ipas.push(hit.replace(/^\/|\/$/g, ''))
    } else {
      return null
    }
  }
  return '/' + ipas.join(' ') + '/'
}

async function generateIpaGemini(apiKey, phrase) {
  const prompt = `Provide the standard British/American IPA pronunciation for the English word or phrase: "${phrase}".
Return ONLY a JSON object with a single string field "pronunciation" enclosing the IPA between slashes (e.g. {"pronunciation": "/ˈpʌblɪk ˌrekəɡˈnɪʃn/"}). No other text, markdown or explanation.`
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rawText) return null
    const parsed = JSON.parse(rawText)
    const ipa = parsed.pronunciation?.trim()
    if (ipa && ipa.startsWith('/') && ipa.endsWith('/')) {
      return ipa
    }
    return ipa ? `/${ipa.replace(/^\/+|\/+$/g, '')}/` : null
  } catch {
    return null
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY
  console.log('Gemini API key available:', Boolean(apiKey))

  const dict = await loadDict()
  console.log(`Loaded pronunciation dictionary with ${dict.size} words.`)

  const notesRaw = await fs.readFile(notesPath, 'utf8')
  const notes = JSON.parse(notesRaw)

  let dictCount = 0
  let geminiCount = 0
  let skipped = 0

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]
    if (note.pronunciation && note.pronunciation.trim()) continue

    // For structure with only placeholders or abstract formulas, skip
    if (note.type === 'Structure' && !cleanTokens(note.title)) {
      skipped++
      continue
    }

    // Try dictionary first
    let ipa = getIpaFromDict(note.title, dict)
    if (ipa) {
      note.pronunciation = ipa
      dictCount++
      console.log(`[DICT] ${note.title} -> ${ipa}`)
      continue
    }

    // Try Gemini if available
    if (apiKey) {
      const cleanTitle = cleanTokens(note.title) || note.title
      const aiIpa = await generateIpaGemini(apiKey, cleanTitle)
      if (aiIpa) {
        note.pronunciation = aiIpa
        geminiCount++
        console.log(`[GEMINI] ${note.title} -> ${aiIpa}`)
        continue
      }
    }

    console.log(`[SKIP] Could not find IPA for: ${note.title}`)
    skipped++
  }

  await fs.writeFile(notesPath, JSON.stringify(notes, null, 2), 'utf8')
  console.log(`\nDONE! Summary: Dict resolved: ${dictCount}, Gemini resolved: ${geminiCount}, Skipped: ${skipped}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
