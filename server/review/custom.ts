// Your own cards: content/review/<deck>.json in the shape of content/schema/review_card_schema.json.
import { existsSync } from 'node:fs'
import { normalizeCustomCard, parseQuickCards } from '../../content-pipeline/review.ts'
import { slugify } from '../../content-pipeline/shared.ts'
import type { ReviewCardInput, ReviewDeckFile } from '../../src/types/content.ts'
import { generateLogged, loadSchema } from '../admin/ai.ts'
import { updateJsonDoc } from '../admin/store.ts'
import { ApiError, type ApiContext } from '../api.ts'
import { contentFile } from '../files.ts'
import { addCards } from './progress.ts'

export function deckSlug(name: string): string {
  const slug = slugify(name)
  if (!slug) throw new ApiError(400, 'Deck name is required.')
  return slug
}

function deckFile(ctx: ApiContext, slug: string) {
  if (existsSync(contentFile(ctx.contentDir, 'review', `${slug}.md`))) {
    throw new ApiError(409, `Deck "${slug}" is a .md file (content/review/${slug}.md); edit that file directly.`)
  }
  return contentFile(ctx.contentDir, 'review', `${slug}.json`)
}

const cardKey = (card: ReviewCardInput) => slugify(card.id || card.term)

/** Drops empty fields so hand-edited files stay readable. */
function clean(input: ReviewCardInput): ReviewCardInput {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue
    out[key] = value
  }
  return out as unknown as ReviewCardInput
}

function validate(raw: unknown, slug: string): ReviewCardInput {
  const { card, problem } = normalizeCustomCard(raw, slug, slug)
  if (!card) throw new ApiError(400, `Invalid card: ${problem}.`)
  return clean(raw as ReviewCardInput)
}

/**
 * Appends cards to a deck file (created when missing) and adds them to reviews.
 * Cards whose id already exists are replaced when `replace` is set, otherwise skipped.
 */
export async function saveCards(
  ctx: ApiContext,
  deckName: string,
  inputs: unknown[],
  { replace = false }: { replace?: boolean } = {},
): Promise<{ deck: string; saved: string[]; skipped: string[] }> {
  const slug = deckSlug(deckName)
  const cards = inputs.map((raw) => validate(raw, slug))
  const file = deckFile(ctx, slug)
  const saved: string[] = []
  const skipped: string[] = []
  await updateJsonDoc<ReviewDeckFile, ReviewDeckFile>(file, { name: deckName, cards: [] }, (doc) => {
    doc.cards = Array.isArray(doc.cards) ? doc.cards : []
    doc.name ||= deckName
    for (const card of cards) {
      const index = doc.cards.findIndex((c) => cardKey(c) === cardKey(card))
      if (index >= 0 && !replace) {
        skipped.push(card.term)
        continue
      }
      if (index >= 0) doc.cards[index] = card
      else doc.cards.push(card)
      saved.push(`custom:${slug}:${cardKey(card)}`)
    }
    return doc
  })
  ctx.onContentChange()
  await addCards(ctx, saved)
  return { deck: slug, saved, skipped }
}

export async function deleteCard(ctx: ApiContext, slug: string, key: string): Promise<void> {
  const file = deckFile(ctx, deckSlug(slug))
  if (!existsSync(file)) throw new ApiError(404, 'Deck not found.')
  await updateJsonDoc<ReviewDeckFile, ReviewDeckFile>(file, { cards: [] }, (doc) => {
    const before = doc.cards.length
    doc.cards = doc.cards.filter((c) => cardKey(c) !== key)
    if (doc.cards.length === before) throw new ApiError(404, 'Card not found.')
    return doc
  })
  ctx.onContentChange()
}

/* ───────────── Gemini ───────────── */

const INSTRUCTIONS = `Bạn là giáo viên IELTS. Tạo thẻ học từ vựng cho người Việt học IELTS (band 6.0–7.5).
Quy tắc:
- pronunciation: IPA giọng Anh–Anh (British), đặt giữa hai dấu "/".
- meaning_vi: nghĩa tiếng Việt ngắn gọn, chính xác; nếu có nhiều nghĩa thông dụng thì đánh số mỗi nghĩa một dòng.
- examples: 2 câu ví dụ tự nhiên, phù hợp ngữ cảnh IELTS, in đậm **từ/cụm từ** trong câu, kèm bản dịch "vi".
- collocations: tối đa 3 collocation thông dụng nhất (nếu có), mỗi cái có meaning_vi và 1 example.
- usage_note_vi: 1–2 câu lưu ý cách dùng hoặc lỗi thường gặp (nếu cần).
- Giữ nguyên "term" đúng như người dùng nhập. Nếu người dùng đã cho nghĩa hoặc ghi chú, hãy tôn trọng nó.`

type Draft = ReviewCardInput

/** Fills in cards with Gemini, 15 terms per request. `hint` = what the user already wrote. */
export async function generateCards(ctx: ApiContext, drafts: Draft[]): Promise<ReviewCardInput[]> {
  const cardSchema = await loadSchema(ctx, 'review_card_schema')
  const result: ReviewCardInput[] = []
  for (let i = 0; i < drafts.length; i += 15) {
    const batch = drafts.slice(i, i + 15)
    const list = batch.map((d, n) => `${n + 1}. ${d.term}${d.meaning_vi ? ` — nghĩa người dùng ghi: ${d.meaning_vi}` : ''}`).join('\n')
    const { value } = await generateLogged<ReviewCardInput[]>(ctx, `review: ${batch.map((d) => d.term).join(', ').slice(0, 80)}`, {
      system: INSTRUCTIONS,
      prompt: `Tạo đúng ${batch.length} thẻ, theo đúng thứ tự sau:\n${list}`,
      schema: { type: 'array', items: cardSchema },
      temperature: 0.3,
    })
    batch.forEach((draft, n) => {
      const generated = Array.isArray(value) ? value[n] : undefined
      // Keep what the user wrote; Gemini only fills the gaps.
      result.push({ ...generated, ...clean(draft), term: draft.term } as ReviewCardInput)
    })
  }
  return result
}

/** Parses pasted text: a JSON array/object of cards, or one `term — meaning` per line. */
export function parseImport(text: string): ReviewCardInput[] {
  const trimmed = text.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new ApiError(400, 'The pasted JSON is not valid.')
    }
    const list = Array.isArray(parsed) ? parsed : (parsed as ReviewDeckFile).cards
    if (!Array.isArray(list)) throw new ApiError(400, 'JSON must be an array of cards or { "cards": [...] }.')
    return list as ReviewCardInput[]
  }
  return parseQuickCards(trimmed).cards
}
