import path from 'node:path'
import type { Essay, EssayDoc, EssayIndex, EssayItem, EssayItemKind, PhraseBank, PhraseBankEntry } from '../src/types/essays.ts'
import { cardItems, ESSAY_ITEM_KINDS, essayCardId } from '../src/types/essays.ts'
import { contentPath, listFiles, looseKey, readJson, warn, type Output } from './shared.ts'

/** The sentence with the item's span in **bold**. */
export function boldSentence(essay: Essay, item: EssayItem): string {
  const s = essay.sentences[item.sentence]?.text ?? ''
  return `${s.slice(0, item.start)}**${s.slice(item.start, item.end)}**${s.slice(item.end)}`
}

/** Builds /data/essays/index.json, /data/essays/<id>.json and /data/essays/phrases.json from content/essays/*.json. */
export function buildEssays(root: string, out: Output): Essay[] {
  const dir = contentPath(root, 'essays')
  const essays: Essay[] = []
  for (const file of listFiles(dir, '.json')) {
    const essay = readJson<Essay | null>(path.join(dir, file), null)
    if (!essay?.id || !Array.isArray(essay.sentences) || !Array.isArray(essay.items)) {
      warn(`essays: ${file} is not an analysed essay, skipped`)
      continue
    }
    essays.push({ ...essay, critique: essay.critique ?? [], tasks: essay.tasks ?? [], paragraphs: essay.paragraphs ?? [] })
  }
  essays.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

  // One bank entry per key across essays (collocations and vocabulary match loosely: "reduce poverty" = "reducing poverty" keys).
  const bank = new Map<string, PhraseBankEntry>()
  for (const essay of essays) {
    for (const item of essay.items) {
      const k = `${item.kind}:${looseKey(item.frame ?? item.key)}`
      const entry = bank.get(k) ?? { key: item.frame ?? item.key, kind: item.kind, meaning_vi: item.meaning_vi, function: item.function, frame: item.frame, occurrences: [] }
      entry.occurrences.push({ essayId: essay.id, title: essay.title, itemId: item.id, text: item.text, sentence: boldSentence(essay, item) })
      bank.set(k, entry)
    }
  }

  for (const essay of essays) {
    const related: EssayDoc['related'] = {}
    for (const item of essay.items) {
      const entry = bank.get(`${item.kind}:${looseKey(item.frame ?? item.key)}`)
      const others = (entry?.occurrences ?? []).filter((o) => o.essayId !== essay.id).map((o) => ({ essayId: o.essayId, title: o.title, sentence: o.sentence }))
      if (others.length) related[item.id] = others.slice(0, 5)
    }
    const doc: EssayDoc = { ...essay, related }
    out.set(`essays/${essay.id}.json`, doc)
  }

  const index: EssayIndex = {
    essays: essays.map((e) => ({
      id: e.id,
      title: e.title,
      topic: e.topic,
      taskType: e.taskType,
      prompt: e.prompt,
      createdAt: e.createdAt,
      ...(e.band ? { band: e.band } : {}),
      words: e.sentences.reduce((n, s) => n + s.text.split(/\s+/).length, 0),
      cardIds: cardItems(e).map((i) => essayCardId(e.id, i.id)),
      counts: Object.fromEntries(ESSAY_ITEM_KINDS.map((k) => [k, e.items.filter((i) => i.kind === k).length])) as Record<EssayItemKind, number>,
    })),
  }
  out.set('essays/index.json', index)
  const phrases: PhraseBank = {
    phrases: [...bank.values()].sort((a, b) => b.occurrences.length - a.occurrences.length || a.key.localeCompare(b.key)),
  }
  out.set('essays/phrases.json', phrases)
  return essays
}
