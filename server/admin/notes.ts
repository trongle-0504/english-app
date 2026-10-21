// Note admin: content/note/notes.json (id = slugify(title), created_at ISO).
import { slugify } from '../../content-pipeline/shared.ts'
import type { Note, NoteExample, NoteType } from '../../src/types/content.ts'
import { ApiError, type ApiContext, type ApiHandler } from '../api.ts'
import { contentFile } from '../files.ts'
import { cleanDrills } from '../../src/lib/wordDrills.ts'
import { generateLogged, loadSchema } from './ai.ts'
import { DRILL_FIELDS, drillsPrompt, drillsSchema, type DrillSubject } from './drills.ts'
import { CORRECTIONS_PROPERTY, corrections, noteLemma, ozdicNotePrompt, ozdicReference } from './ozdic-grounding.ts'
import { isObject, jsonBody, optionalText, queryParam, requiredObject, requiredText, stringList, type JsonObject } from './input.ts'
import { readJsonDoc, updateJsonDoc } from './store.ts'
import { autoAddFromAdmin } from '../review/progress.ts'
import { searchImages, storeImage, type ImageCandidate } from './images.ts'

const NOTE_TYPES: NoteType[] = ['Structure', 'Idiom', 'Collocation', 'Vocabulary', 'Other']

const notesFile = (ctx: ApiContext) => contentFile(ctx.contentDir, 'note', 'notes.json')

/** Prompt ported verbatim from the previous app (app/[locale]/api/admin/note/route.ts). */
export function notePrompt(input: string): string {
  return `
  You are an expert English teacher.

  I will give you:
  - a word, phrase, idiom, or structure
  - OR sometimes TWO similar words/phrases to compare (e.g., "affect vs effect", "price and rate")

  Your task:
  Return ONLY a valid JSON object that strictly follows the provided schema.

  IMPORTANT RULES:

  1. PRIORITY OF INFORMATION (VERY IMPORTANT):
  - You MUST prioritize ALL information provided in the "Input to process" section.
  - Extract AS MUCH as possible directly from the input — do NOT skip or summarize away details.
  - If the input contains patterns (e.g., "adequate for + N", "adequate to do sth"), extract EACH pattern into the "patterns" array with its own formula, explanation, and examples.
  - Read the ENTIRE input carefully before writing any output. Do not stop scanning after the first match — a pattern's real example may appear a few lines below its definition, not immediately next to it.
  - ONLY when the input does NOT provide enough information may you add minimal necessary knowledge to complete the schema.

  2. If the input contains ONLY ONE item:
  - Explain it normally based primarily on the input.
  - If the input lists multiple usage patterns, put each one in the "patterns" array.

  3. If the input contains TWO items (comparison case):
  - Set "title" as: "A vs B"
  - In "meaning_vi": give short meanings of BOTH (based on input first)
  - In "usage_context": MUST clearly explain the DIFFERENCE between them
  - In "examples": include EXACTLY 2 examples total (1 for A and 1 for B)
  - In "related_notes": include both words and similar/contrast words if useful

  4. Keep explanations:
  - concise, clear, easy to understand
  - Use Markdown formatting (e.g., **bold**, *italic*, bullet points) in "meaning_vi" and "usage_context" fields.

  5. DO NOT add any text outside the JSON object.
  6. DO NOT change the schema structure.
  7. For "type", choose: "Structure", "Idiom", "Collocation", "Vocabulary", or "Other".

  8. PATTERN EXTRACTION RULE (CRITICAL):
  - If the input explicitly lists patterns (e.g., "Pattern 1: ...", "adequate for + N/V-ing", "adequate to do sth", or bullet blocks like "student exchanges", "cultural exchanges"), you MUST include ALL of them in the "patterns" array.
  - For each pattern, search the input thoroughly and copy its real example sentence(s) directly into that pattern's "examples" field.
  - Do NOT merge all pattern examples into the top-level "examples" field — keep them scoped to their own pattern.

  8b. EXAMPLE QUALITY RULE (STRICT — PREVENTS DUPLICATE/FAKE EXAMPLES):
  - An "example" MUST be a natural, complete sentence (at least 6 words) that demonstrates the pattern actually being used in context.
  - An example is INVALID if it is just the pattern phrase itself followed by its Vietnamese meaning, with no real sentence around it.
    - INVALID: "cultural exchanges - giao lưu văn hóa"
    - VALID: "The two countries have promoted cultural exchanges for decades. - Hai nước đã thúc đẩy giao lưu văn hóa trong nhiều thập kỷ."
  - NEVER copy the "title" or "formula" field verbatim as the entire English text of an example.
  - If the input provides a real example sentence for a pattern anywhere in the text, you MUST use it — do not discard it or replace it with a shortened restatement.
  - If, after a careful and complete search of the input, NO real example sentence exists for a given pattern, you MUST generate a new, natural sentence yourself (do not leave it as a bare restatement of the meaning).

  8c. SELF-CHECK BEFORE OUTPUT (MANDATORY):
  - Before returning the final JSON, review every single example in every pattern.
  - Test: if you remove the pattern phrase from the English sentence, are there still at least 3 other meaningful words left?
    - If NO → the example is invalid. Fix it by either (a) finding the real example elsewhere in the input, or (b) generating a proper new sentence per rule 8b.
  - Also check: does every pattern that had an example in the input still have that example in the output? If any were dropped, restore them.
  - Do not output the JSON until this check passes for all patterns.

  9. PRONUNCIATION RULE:
  - For Vocabulary, Collocation, and Idiom: always provide the standard British or American IPA phonetic transcription between slashes (e.g., /ˈpʌblɪk ˌrekəɡˈnɪʃn/, /ˈædɪkwət/).
  - For multi-word collocations, idioms, or phrases, provide the IPA for the complete phrase (e.g., "public recognition" → "/ˈpʌblɪk ˌrekəɡˈnɪʃn/", "break the ice" → "/breɪk ðiː aɪs/").
  - For Structure notes (sentence grammar structures / formulas): DO NOT provide pronunciation (always set "pronunciation" to "").

  Input to process: ${input}
`
}

const IMAGE_PROMPT = `

### IMAGE
Set "image_query" to 3–7 plain English search words for a stock PHOTO that shows the phrase, idiom, or collocation meaning in a concrete, photographable scene
("potted plant" → "potted green house plant on desk interior",
"take something for granted" → "clean fresh tap water glass kitchen",
"behind the scenes" → "film crew cameras studio backstage production",
"face the music" → "person looking guilty at boss office meeting",
"break the ice" → "friendly people laughing conversation coffee table").
For abstract grammar structures with no natural photo scene, set "image_query" to "".
No abstract words, no text or letters in the picture.`

type RawNote = Partial<Note> & JsonObject

function examples(value: unknown, where: string): NoteExample[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new ApiError(400, `"${where}" must be an array of { en, vi }.`)
  return value.map((item, i) => {
    const en = isObject(item) ? optionalText(item, 'en') : ''
    if (!en) throw new ApiError(400, `"${where}[${i}]" must be { en, vi } with a non-empty "en".`)
    return { en, vi: optionalText(item as JsonObject, 'vi') }
  })
}

/** Validates a note and puts its fields in the file's usual order. id and created_at are set by `commitNote`. */
function parseNote(raw: JsonObject): Omit<Note, 'id' | 'created_at'> {
  const type = raw.type as NoteType
  if (!NOTE_TYPES.includes(type)) throw new ApiError(400, `"type" must be one of ${NOTE_TYPES.join(', ')}.`)
  const patterns = raw.patterns == null ? [] : raw.patterns
  if (!Array.isArray(patterns)) throw new ApiError(400, '"patterns" must be an array.')
  const optional = (key: 'pronunciation' | 'formula' | 'usage_context' | 'image' | 'image_credit' | 'image_source' | 'image_query') => {
    const value = optionalText(raw, key)
    return value ? { [key]: value } : {}
  }
  return {
    title: requiredText(raw, 'title', { max: 200, collapse: true }),
    type,
    ...(type !== 'Structure' ? optional('pronunciation') : {}),
    ...optional('formula'),
    ...optional('image'),
    ...optional('image_credit'),
    ...optional('image_source'),
    ...optional('image_query'),
    meaning_vi: optionalText(raw, 'meaning_vi'),
    ...optional('usage_context'),
    patterns: patterns.map((p, i) => {
      if (!isObject(p) || !optionalText(p, 'pattern')) throw new ApiError(400, `"patterns[${i}]" must be an object with a "pattern".`)
      return {
        pattern: optionalText(p, 'pattern'),
        meaning_vi: optionalText(p, 'meaning_vi'),
        examples: examples(p.examples, `patterns[${i}].examples`),
      }
    }),
    examples: examples(raw.examples, 'examples'),
    related_notes: stringList(raw.related_notes, 'related_notes'),
    // Review drills are kept (and cleaned) on every save, so editing a note in Admin never drops them.
    ...cleanDrills(
      raw,
      requiredText(raw, 'title', { max: 200, collapse: true }),
      patterns.flatMap((p) => (isObject(p) && typeof p.pattern === 'string' ? [p.pattern.trim()] : [])),
    ),
  }
}

/** Upserts by id; `originalId` renames (the old id is replaced and keeps its created_at). */
function commitNote(ctx: ApiContext, fields: Omit<Note, 'id' | 'created_at'>, originalId?: string, onlyNew = false) {
  const id = slugify(fields.title)
  if (!id) throw new ApiError(400, 'The title must contain letters or digits.')
  return updateJsonDoc<RawNote[], { action: 'created' | 'updated'; note: RawNote }>(notesFile(ctx), [], (notes) => {
    const index = notes.findIndex((n) => n.id === (originalId || id))
    if (index >= 0 && onlyNew) throw new ApiError(409, `"${notes[index].title}" is already in Notes.`)
    if (originalId && originalId !== id && notes.some((n) => n.id === id)) {
      throw new ApiError(409, `A note with id "${id}" already exists. Edit that note instead.`)
    }
    const note: RawNote = { id, created_at: (index >= 0 && notes[index].created_at) || new Date().toISOString(), ...fields }
    if (index >= 0) notes[index] = note
    else notes.push(note)
    return { action: index >= 0 ? 'updated' : 'created', note }
  })
}

export const listNotes: ApiHandler = async (_req, ctx) => {
  const { value } = await readJsonDoc<RawNote[]>(notesFile(ctx), [])
  const notes = [...value].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
  return { json: { notes } }
}

const NOTE_DRILLS: DrillSubject = { item: 'note title', partners: 'patterns' }

export const generateNote: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const prompt = requiredText(body, 'prompt', { max: 20_000 })
  const type = optionalText(body, 'type') || 'auto'
  if (type !== 'auto' && !NOTE_TYPES.includes(type as NoteType)) {
    throw new ApiError(400, `"type" must be "auto" or one of ${NOTE_TYPES.join(', ')}.`)
  }
  // Speaking ideas adds phrases with one click: never replace a note that already exists.
  const onlyNew = body.onlyNew === true
  // 1. The item in base form + headwords, 2. their Oxford Collocations entries on OZDIC, 3. the note grounded on them.
  const lemmaStep = await noteLemma(ctx, prompt)
  if (onlyNew) {
    const known = (await readJsonDoc<RawNote[]>(notesFile(ctx), [])).value.find((n) => n.id === slugify(lemmaStep.result.lemma))
    if (known) throw new ApiError(409, `"${known.title}" is already in Notes.`)
  }
  // Notes get the combinations only: dictionary example sentences tempt Gemini to copy unrelated ones.
  const ozdic = await ozdicReference(lemmaStep.result.headwords, { examples: false })
  const grounded = Boolean(ozdic.text)
  const baseSchema = (await loadSchema(ctx, 'note_schema')) as JsonObject
  const schema = {
    ...baseSchema,
    properties: {
      ...(baseSchema.properties as JsonObject),
      ...drillsSchema(NOTE_DRILLS),
      ...(grounded ? { ozdic_corrections: CORRECTIONS_PROPERTY } : {}),
    },
    required: [...((baseSchema.required as string[]) ?? []), ...DRILL_FIELDS, ...(grounded ? ['ozdic_corrections'] : [])],
  }
  const generated = await generateLogged<unknown>(ctx, `note: ${prompt.slice(0, 60)}`, {
    prompt: notePrompt(prompt) + (lemmaStep.error ? '' : ozdicNotePrompt(ozdic.text, lemmaStep.result.lemma)) + drillsPrompt(NOTE_DRILLS) + IMAGE_PROMPT,
    schema,
    temperature: 0.1,
  })
  if (!isObject(generated.value)) throw new ApiError(502, 'Gemini did not return a JSON object.')
  const raw = { ...generated.value, type: type === 'auto' ? generated.value.type : type } as JsonObject
  if (!NOTE_TYPES.includes(raw.type as NoteType)) raw.type = 'Other'

  // Look for image candidates based on image_query
  const imageQuery = optionalText(generated.value as JsonObject, 'image_query')
  let imageCandidates: ImageCandidate[] = []
  if (imageQuery) {
    const searchRes = await searchImages(imageQuery)
    imageCandidates = searchRes.candidates
    const candidate = imageCandidates[0]
    if (candidate) {
      try {
        raw.image = await storeImage(ctx, String(raw.title || prompt.slice(0, 30)), candidate.url, 'note-images')
        raw.image_credit = candidate.credit
        raw.image_source = candidate.source
        raw.image_query = imageQuery
      } catch {
        // If downloading the first candidate fails, the picker still offers the rest.
      }
    }
  }

  const result = await commitNote(ctx, parseNote(raw), undefined, onlyNew)
  ctx.onContentChange()
  if (result.action === 'created') await autoAddFromAdmin(ctx, [`note:${result.note.id}`])
  return {
    json: {
      ...result,
      lemma: lemmaStep.result,
      lemmaError: lemmaStep.error,
      ozdic: { sources: ozdic.sources, corrections: grounded ? corrections(generated.value.ozdic_corrections) : [] },
      model: generated.model,
      usage: generated.usage,
      lemmaUsage: lemmaStep.usage,
      image: { query: imageQuery, candidates: imageCandidates },
    },
  }
}

export const saveNote: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const fields = parseNote(requiredObject(body, 'note'))
  const originalId = optionalText(body, 'originalId') || undefined
  const result = await commitNote(ctx, fields, originalId)
  ctx.onContentChange()
  if (result.action === 'created') await autoAddFromAdmin(ctx, [`note:${result.note.id}`])
  return { json: result }
}

export const deleteNote: ApiHandler = async (req, ctx) => {
  const id = queryParam(req, 'id')
  await updateJsonDoc<RawNote[], void>(notesFile(ctx), [], (notes) => {
    const index = notes.findIndex((n) => n.id === id)
    if (index < 0) throw new ApiError(404, `No note with id "${id}".`)
    notes.splice(index, 1)
  })
  ctx.onContentChange()
  return { json: { ok: true, id } }
}

/** GET /admin/notes/images?q=…: picture candidates for the picker. */
export const searchNoteImages: ApiHandler = async (req) => {
  const q = queryParam(req, 'q').slice(0, 120)
  return { json: await searchImages(q) }
}

/** POST /admin/notes/image { id, url, credit, source } stores a picture for a note; { id, remove: true } drops it. */
export const setNoteImage: ApiHandler = async (req, ctx) => {
  const body = jsonBody(req)
  const id = requiredText(body, 'id', { max: 200, collapse: true })
  const remove = body.remove === true
  const url = remove ? '' : requiredText(body, 'url', { max: 2000 })
  const image = remove ? '' : await storeImage(ctx, id, url, 'note-images')
  const note = await updateJsonDoc<RawNote[], RawNote>(notesFile(ctx), [], (notes) => {
    const found = notes.find((n) => n.id === id || slugify(String(n.title ?? '')) === id)
    if (!found) throw new ApiError(404, `No note with id "${id}".`)
    if (remove) {
      delete found.image
      delete found.image_credit
      delete found.image_source
    } else {
      found.image = image
      found.image_credit = optionalText(body, 'credit', { max: 200 })
      found.image_source = optionalText(body, 'source', { max: 2000 })
    }
    return found
  })
  ctx.onContentChange()
  return { json: { note } }
}
