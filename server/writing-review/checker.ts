// Deterministic check of one word combination against OZDIC data. The AI never decides whether a collocation is
// "in the dictionary" — this code does, by string matching on the dictionary's own lists.
import type { CollocationGroup, OzdicEntry } from './ozdic.ts'

export type Pattern =
  | 'verb + noun'
  | 'adjective + noun'
  | 'noun + verb'
  | 'noun + noun'
  | 'preposition'
  | 'adverb'
  | 'quantifier'
  | 'phrase'

/** One combination found in the essay (from the extraction step). */
export interface Usage {
  id: string
  sentence: string
  /** The words as written in the essay, e.g. "make a lot of research". */
  phrase: string
  /** Word whose dictionary entry lists this combination (lemma): the noun for verb+noun / adj+noun, the verb for verb+prep. */
  base: string
  basePos: string
  /** The other word (lemma), e.g. "make", "about", "big". */
  collocate: string
  pattern: Pattern
}

export type Status =
  /** Listed in the Oxford Collocations Dictionary data under the expected category. */
  | 'confirmed'
  /** Listed in the Oxford data, but under another category or sense — usually fine. */
  | 'listed_elsewhere'
  /** The entry has Oxford data, and this collocate is not in it — suspicious (the dictionary is not exhaustive). */
  | 'not_listed'
  /** The entry exists but its collocations are machine-mined (not Oxford) — too unreliable to judge with. */
  | 'unreliable_data'
  /** No OZDIC entry for the base word. */
  | 'no_entry'
  /** OZDIC could not be reached right now (rate limit / bot protection) — no evidence either way. */
  | 'unavailable'

export interface Evidence {
  status: Status
  /** Which dictionary the evidence comes from (default OZDIC). */
  source?: 'ozdic' | 'longman'
  base: string
  url: string
  /** Matching line when found, e.g. `VERB + RESEARCH: carry out`. */
  matched?: { sense: string; category: string; item: string }
  /** Dictionary lists relevant to this usage (expected category, every sense) — the only allowed suggestions. */
  relevant: { sense: string; category: string; items: string[]; examples: string[]; source?: 'ozdic' | 'longman' }[]
}

const CATEGORY: Record<Pattern, RegExp> = {
  'verb + noun': /^VERB \+/i,
  'adjective + noun': /^ADJ/i,
  'noun + verb': /\+ VERB$/i,
  'noun + noun': /NOUN/i,
  preposition: /^PREP/i,
  adverb: /^ADV/i,
  quantifier: /^QUANT/i,
  phrase: /^PHRASES?/i,
}

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[.,;:!?"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Every plain form of a dictionary item: "~ into/on" → ["into", "on"]; "present (sb with)" → ["present", "present with"];
 * "be able/unable to" → ["be able to", "be unable to"]. Placeholders (~, sb, sth) are dropped.
 */
export function itemForms(item: string): string[] {
  const withParens = item.replace(/[()]/g, ' ')
  const withoutParens = item.replace(/\([^)]*\)/g, ' ')
  const out = new Set<string>()
  for (const variant of [withParens, withoutParens]) {
    const tokens = normalise(variant)
      .split(' ')
      .filter((t) => t && !/^(~|sb|sth|sb\/sth|one's|your|a|an|the)$/.test(t))
    let combos: string[][] = [[]]
    for (const token of tokens) {
      const options = token.split('/').filter(Boolean)
      combos = combos.flatMap((c) => options.map((o) => [...c, o])).slice(0, 32)
    }
    for (const c of combos) if (c.length) out.add(c.join(' '))
  }
  return [...out]
}

/** True when the collocate (a lemma or short phrase) is one of the item's forms, or the item's head word. */
function matches(item: string, collocate: string): boolean {
  const target = normalise(collocate)
  return itemForms(item).some((form) => form === target || form.split(' ')[0] === target || form.startsWith(`${target} `))
}

function groupsOf(entry: OzdicEntry): { sense: string; group: CollocationGroup }[] {
  return entry.senses.flatMap((s) => s.groups.map((group) => ({ sense: s.gloss, group })))
}

const PHRASES = /^PHRASES?/i

export function check(usage: Usage, entry: OzdicEntry): Evidence {
  const base = { base: entry.word, url: entry.url }
  const all = groupsOf(entry)
  const expected = all.filter(({ group }) => CATEGORY[usage.pattern].test(group.category))
  const phrases = all.filter(({ group }) => PHRASES.test(group.category) && !expected.some((e) => e.group === group))
  // Fixed phrases are evidence and a source of suggestions ("pay attention to" lives under PHRASES, not PREP), but never
  // confirm a usage on their own: "force your attentions on sb" must not make "pay attention on" correct.
  const relevant = [...expected, ...phrases].map(({ sense, group }) => ({ sense, category: group.category, items: group.items, examples: group.examples }))
  if (entry.unavailable) return { status: 'unavailable', ...base, relevant: [] }
  if (!entry.found || !all.length) return { status: 'no_entry', ...base, relevant: [] }
  if (!entry.oxford) return { status: 'unreliable_data', ...base, relevant }

  const find = (list: typeof all) => {
    for (const { sense, group } of list) {
      const item = group.items.find((i) => matches(i, usage.collocate))
      if (item) return { sense, category: group.category, item }
    }
    return undefined
  }
  const inExpected = find(expected)
  if (inExpected) return { status: 'confirmed', ...base, matched: inExpected, relevant }
  const elsewhere = find(all)
  if (elsewhere) return { status: 'listed_elsewhere', ...base, matched: elsewhere, relevant }
  return { status: 'not_listed', ...base, relevant }
}

/**
 * Everything the dictionary offers for this usage — used to reject AI suggestions that are not in OZDIC. Words inside
 * fixed phrases count too, so "to" is allowed when the entry lists "pay little/no attention to sth".
 */
export function allowedSuggestions(evidence: Evidence): Set<string> {
  const allowed = new Set<string>()
  for (const r of evidence.relevant) {
    for (const form of r.items.flatMap(itemForms)) {
      allowed.add(form)
      if (/^PHRASES?/i.test(r.category)) for (const word of form.split(' ')) allowed.add(word)
    }
  }
  return allowed
}
