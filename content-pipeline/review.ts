import { readFileSync } from 'node:fs'
import path from 'node:path'
import type {
  CollocationLesson,
  Note,
  ReviewCard,
  ReviewCardInput,
  ReviewDeck,
  ReviewDeckFile,
  ReviewIndex,
  VocabIndex,
  VocabLesson,
  VocabWord,
} from '../src/types/content.ts'
import type { Essay, EssayItem } from '../src/types/essays.ts'
import { cardItems, essayCardId } from '../src/types/essays.ts'
import { workPath } from '../src/types/practice.ts'
import { boldSentence } from './essays.ts'
import { asStringArray, listFiles, readJson, slugify, warn, type Output } from './shared.ts'
import { ALL_TOPIC_ID } from './vocabulary.ts'
import { phraseKey } from '../src/lib/wordDrills.ts'

const nonEmpty = <T,>(xs: T[] | undefined) => (xs?.length ? xs : undefined)
const numbered = (items: string[]) => (items.length > 1 ? items.map((t, i) => `${i + 1}. ${t}`).join('\n') : (items[0] ?? ''))

function fromVocabulary(word: VocabWord, origin: string, href: string): ReviewCard {
  return {
    id: `vocab:${word.id}`,
    source: 'vocabulary',
    term: word.word,
    pronunciation: word.pronunciation || undefined,
    part_of_speech: word.part_of_speech,
    meaning_vi: numbered(word.senses.map((s) => s.definition_vi).filter(Boolean)),
    examples: word.senses.flatMap((s) => s.examples).slice(0, 4).map((en) => ({ en })),
    collocations: word.collocations.map((c) => ({ text: c.text, meaning_vi: c.meaning_vi, example: c.examples?.[0] })),
    synonyms: word.synonyms.map((s) => s.text),
    antonyms: word.antonyms.map((s) => s.text),
    usage_note_vi: word.senses.find((s) => s.usage_notes_vi)?.usage_notes_vi,
    mnemonic_vi: word.mnemonic_vi ?? word.word_roots?.mnemonic_vi,
    tags: [],
    image: word.image,
    patterns: nonEmpty([...new Set(word.senses.flatMap((s) => s.patterns))].slice(0, 8)),
    use_prompts: word.use_prompts,
    dictation: word.dictation?.find((d) => d.target === word.word)?.text,
    paraphrase: word.paraphrase,
    origin,
    href,
  }
}

function fromLessonCollocation(word: VocabWord, lesson: CollocationLesson): ReviewCard {
  return {
    ...fromVocabulary(word, lesson.title, `/collocations/${lesson.id}#${word.id}`),
    id: `colloc:${lesson.id}:${word.id}`,
    source: 'collocation',
    part_of_speech: word.collocation_type ? [word.collocation_type] : word.part_of_speech,
  }
}

function fromWordCollocation(word: VocabWord, index: number, href: string): ReviewCard {
  const c = word.collocations[index]
  return {
    id: `wcolloc:${word.id}:${slugify(c.text)}`,
    source: 'word-collocation',
    term: c.text,
    pronunciation: c.pronunciation,
    part_of_speech: c.type ? [c.type] : [],
    meaning_vi: c.meaning_vi ?? '',
    examples: (c.examples ?? []).map((en) => ({ en })),
    collocations: [],
    synonyms: [],
    antonyms: [],
    tags: [],
    origin: `Collocation of: ${word.word}`,
    href,
    patterns: nonEmpty([...new Set(word.senses.flatMap((s) => s.patterns))].filter((p) => phraseKey(p).includes(phraseKey(c.text)))),
    // Only the parent word's questions this collocation fits.
    use_prompts: nonEmpty(word.use_prompts?.filter((p) => p.fits.includes(c.text))),
    dictation: word.dictation?.find((d) => d.target === c.text)?.text,
    paraphrase: nonEmpty(word.paraphrase?.filter((p) => p.target === c.text)),
  }
}

function fromNote(note: Note): ReviewCard {
  return {
    id: `note:${note.id}`,
    source: 'note',
    term: note.title,
    pronunciation: note.type === 'Structure' ? undefined : note.pronunciation,
    image: note.image,
    part_of_speech: [note.type],
    meaning_vi: note.meaning_vi,
    examples: note.examples.map((e) => ({ en: e.en, vi: e.vi || undefined })),
    collocations: note.patterns.map((p) => ({ text: p.pattern, meaning_vi: p.meaning_vi, example: p.examples[0]?.en })),
    synonyms: [],
    antonyms: [],
    usage_note_vi: note.usage_context,
    tags: [],
    formula: note.formula,
    use_prompts: note.use_prompts,
    dictation: note.dictation?.find((d) => d.target === note.title)?.text,
    paraphrase: note.paraphrase,
    origin: `Note · ${note.type}`,
    href: `/notes#${note.id}`,
  }
}

const ESSAY_KIND_LABEL: Record<EssayItem['kind'], string> = {
  collocation: 'collocation',
  vocabulary: 'vocabulary',
  paraphrase: 'paraphrase',
  linking: 'linking word',
  frame: 'sentence frame',
}

/** A phrase from a model essay: its sentence (and the Vietnamese translation) is the example. */
function fromEssayItem(essay: Essay, item: EssayItem): ReviewCard {
  const sentence = essay.sentences[item.sentence]
  const meaning = item.kind === 'paraphrase' && item.source ? `${item.meaning_vi}\n(= paraphrase of "${item.source}")` : item.meaning_vi
  return {
    id: essayCardId(essay.id, item.id),
    source: 'essay',
    term: item.kind === 'frame' && item.frame ? item.frame : item.key,
    part_of_speech: [ESSAY_KIND_LABEL[item.kind], ...(item.function ? [item.function] : [])],
    meaning_vi: meaning,
    examples: sentence ? [{ en: boldSentence(essay, item), vi: sentence.vi || undefined }] : [],
    collocations: [],
    synonyms: [],
    antonyms: [],
    usage_note_vi: item.note_vi,
    tags: [],
    origin: `Essay · ${essay.title}`,
    href: `/practice/essays/${essay.id}#${item.id}`,
  }
}

/* ───────────── Your own cards: content/review/*.json and *.md ───────────── */

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/** Validates one hand-written card against review_card_schema.json; returns problems instead of throwing. */
export function normalizeCustomCard(raw: unknown, deckId: string, deckName: string): { card?: ReviewCard; problem?: string } {
  if (!raw || typeof raw !== 'object') return { problem: 'not an object' }
  const input = raw as ReviewCardInput
  const term = str(input.term)
  if (!term) return { problem: '`term` is missing' }
  const examples = (Array.isArray(input.examples) ? input.examples : [])
    .map((e) => (typeof e === 'string' ? { en: e } : e && typeof e === 'object' ? { en: str(e.en) ?? '', vi: str(e.vi) } : null))
    .filter((e): e is { en: string; vi: string | undefined } => Boolean(e?.en))
  const collocations = (Array.isArray(input.collocations) ? input.collocations : [])
    .map((c) => (typeof c === 'string' ? { text: c } : c && typeof c === 'object' ? { text: str(c.text) ?? '', meaning_vi: str(c.meaning_vi), example: str(c.example) } : null))
    .filter((c): c is { text: string; meaning_vi: string | undefined; example: string | undefined } => Boolean(c?.text))
  const id = slugify(str(input.id) ?? term)
  const m = input.mistake && typeof input.mistake === 'object' ? input.mistake : undefined
  const mistake =
    m && str(m.sentence) && str(m.wrong) && str(m.right)
      ? {
          sentence: str(m.sentence)!,
          wrong: str(m.wrong)!,
          right: str(m.right)!,
          fixed: str(m.fixed),
          why: str(m.why),
          dictionary: asStringArray(m.dictionary),
        }
      : undefined
  const p = input.phrase && typeof input.phrase === 'object' ? input.phrase : undefined
  const phrase =
    p && ['library', 'extra', 'wording'].includes(p.group)
      ? {
          group: p.group,
          verified: Boolean(p.verified),
          ...(p.natural ? { natural: true } : {}),
          dictionary: asStringArray(p.dictionary),
          sources: (Array.isArray(p.sources) ? p.sources : [])
            .filter((s) => s && typeof s === 'object' && str(s.name) && /^https?:\/\//.test(String(s.url ?? '')))
            .map((s) => ({ name: String(s.name), url: String(s.url) })),
        }
      : undefined
  // A card made from a Writing review / Speaking answer links back to it.
  const from = input.from && typeof input.from === 'object' && /^[a-z0-9-]+$/i.test(String(input.from.id ?? '')) ? input.from : undefined
  const href = from ? workPath(from.kind, from.id) : undefined
  return {
    card: {
      id: `custom:${deckId}:${id}`,
      source: 'custom',
      term,
      pronunciation: str(input.pronunciation),
      part_of_speech: asStringArray(input.part_of_speech),
      meaning_vi: str(input.meaning_vi) ?? '',
      meaning_en: str(input.meaning_en),
      examples,
      collocations,
      synonyms: asStringArray(input.synonyms),
      antonyms: asStringArray(input.antonyms),
      usage_note_vi: str(input.usage_note_vi),
      mnemonic_vi: str(input.mnemonic_vi),
      tags: asStringArray(input.tags),
      origin: deckName,
      ...(mistake ? { mistake } : {}),
      ...(phrase ? { phrase } : {}),
      ...(href ? { href } : {}),
    },
  }
}

/**
 * Quick format, one card per line: `term — meaning` (also ` - `, ` | `, ` = ` or a tab). A line with only a
 * term is fine. `# Title` names the deck; blank lines and `//` comments are ignored.
 */
export function parseQuickCards(text: string): { name?: string; cards: ReviewCardInput[] } {
  let name: string | undefined
  const cards: ReviewCardInput[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim()
    if (!line || line.startsWith('//')) continue
    const heading = /^#+\s+(.+)$/.exec(line)
    if (heading) {
      name ??= heading[1].trim()
      continue
    }
    const [term, ...rest] = line.split(/\s+[—–=|-]\s+|\t/)
    cards.push({ term: term.trim(), meaning_vi: rest.join(' — ').trim() || undefined })
  }
  return { name, cards }
}

export function buildCustomCards(dir: string): ReviewIndex {
  const cards: ReviewCard[] = []
  const decks: ReviewDeck[] = []
  const seen = new Set<string>()
  const files = [...listFiles(dir, '.json'), ...listFiles(dir, '.md')].filter((f) => !f.startsWith('_'))
  for (const file of files) {
    const deckId = slugify(file.replace(/\.(json|md)$/, ''))
    let doc: ReviewDeckFile
    if (file.endsWith('.md')) {
      const parsed = parseQuickCards(readFileSync(path.join(dir, file), 'utf8'))
      doc = { name: parsed.name, cards: parsed.cards }
    } else {
      doc = readJson<ReviewDeckFile>(path.join(dir, file), { cards: [] })
      if (!Array.isArray(doc.cards)) {
        warn(`review: ${file} has no "cards" array, skipped`)
        continue
      }
    }
    const name = str(doc.name) ?? file.replace(/\.(json|md)$/, '').replace(/[-_]+/g, ' ')
    const deck: ReviewDeck = { id: `custom:${deckId}`, source: 'custom', group: 'My cards', name, description: str(doc.description), cardIds: [] }
    doc.cards.forEach((raw, i) => {
      const { card, problem } = normalizeCustomCard(raw, deckId, name)
      if (!card) return warn(`review: ${file} card #${i + 1}: ${problem}, skipped`)
      if (deck.cardIds.includes(card.id) || seen.has(card.id)) return warn(`review: ${file} card #${i + 1} ("${card.term}") duplicates another card's id, skipped`)
      seen.add(card.id)
      deck.cardIds.push(card.id)
      cards.push(card)
    })
    decks.push(deck)
  }
  return { cards, decks }
}

/** Builds /data/review/index.json: every reviewable card in the common shape, grouped into decks. */
export function buildReview(
  _root: string,
  out: Output,
  { words, lessons, notes, essays }: { words: VocabWord[]; lessons: CollocationLesson[]; notes: Note[]; essays: Essay[] },
): ReviewIndex {
  const cards: ReviewCard[] = []
  const decks: ReviewDeck[] = []
  const vocabIndex = out.get('vocabulary/index.json') as VocabIndex

  // Vocabulary words and the collocations inside them: one deck per sub-topic (a word's card lives once).
  const placed = new Set<string>()
  for (const topic of vocabIndex.topics) {
    if (topic.id === ALL_TOPIC_ID) continue
    for (const sub of topic.subTopics) {
      const lesson = out.get(`vocabulary/${topic.id}/${sub.id}.json`) as VocabLesson
      const href = `/vocabulary/${topic.id}/${sub.id}`
      const deckName = lesson.title
      const wordDeck: ReviewDeck = { id: `vocab:${topic.id}/${sub.id}`, source: 'vocabulary', group: topic.name, name: deckName, cardIds: [] }
      const collocationDeck: ReviewDeck = { id: `wcolloc:${topic.id}/${sub.id}`, source: 'word-collocation', group: topic.name, name: `${deckName} · collocations`, cardIds: [] }
      for (const word of lesson.words) {
        const wordCard = fromVocabulary(word, lesson.title === topic.name ? topic.name : `${topic.name} › ${sub.name}`, `${href}#${word.id}`)
        const collocationCards = word.collocations.map((_, i) => fromWordCollocation(word, i, `${href}#${word.id}`))
        wordDeck.cardIds.push(wordCard.id)
        collocationDeck.cardIds.push(...collocationCards.map((c) => c.id))
        if (placed.has(word.id)) continue
        placed.add(word.id)
        cards.push(wordCard, ...collocationCards)
      }
      decks.push(wordDeck)
      if (collocationDeck.cardIds.length) decks.push(collocationDeck)
    }
  }
  const unplaced = words.filter((w) => !placed.has(w.id))
  if (unplaced.length) {
    const deck: ReviewDeck = { id: 'vocab:other', source: 'vocabulary', group: 'Vocabulary', name: 'Not in a topic', cardIds: [] }
    for (const word of unplaced) {
      const card = fromVocabulary(word, 'Vocabulary', `/vocabulary/${ALL_TOPIC_ID}/${ALL_TOPIC_ID}#${word.id}`)
      deck.cardIds.push(card.id)
      cards.push(card)
    }
    decks.push(deck)
  }

  // Collocation lessons: one deck per lesson.
  for (const lesson of lessons) {
    const deck: ReviewDeck = { id: `colloc:${lesson.id}`, source: 'collocation', group: lesson.topic.name, name: lesson.title, cardIds: [] }
    for (const word of Object.values(lesson.words)) {
      const card = fromLessonCollocation(word, lesson)
      deck.cardIds.push(card.id)
      cards.push(card)
    }
    decks.push(deck)
  }

  // Notes: one deck per type.
  const byType = new Map<string, ReviewDeck>()
  for (const note of notes) {
    const deck = byType.get(note.type) ?? { id: `note:${slugify(note.type)}`, source: 'note' as const, group: 'Notes', name: note.type, cardIds: [] }
    byType.set(note.type, deck)
    const card = fromNote(note)
    deck.cardIds.push(card.id)
    cards.push(card)
  }
  decks.push(...byType.values())

  // Model essays: one deck per essay (cards are added from the essay page, not all at once).
  for (const essay of essays) {
    const deck: ReviewDeck = { id: `essay:${essay.id}`, source: 'essay', group: 'Model essays', name: essay.title, description: essay.topic, cardIds: [] }
    // The same phrase used twice ("For instance" in two paragraphs) is one card.
    for (const item of cardItems(essay)) {
      const card = fromEssayItem(essay, item)
      deck.cardIds.push(card.id)
      cards.push(card)
    }
    decks.push(deck)
  }

  // Ids must be unique across sources; a clash would merge two cards' progress.
  const seen = new Set<string>()
  const unique = cards.filter((card) => {
    if (seen.has(card.id)) {
      warn(`review: duplicate card id ${card.id}, second copy skipped`)
      return false
    }
    seen.add(card.id)
    return true
  })

  const index: ReviewIndex = { cards: unique, decks }
  out.set('review/index.json', index)
  return index
}
