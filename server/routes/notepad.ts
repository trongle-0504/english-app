import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ApiError, type ApiContext, type ApiHandler } from '../api.ts'
import { contentFile } from '../files.ts'
import { antigravityJson } from '../llm/antigravity-cli.ts'
import { isObject, jsonBody, queryParam } from '../admin/input.ts'
import { readJsonDoc, updateJsonDoc } from '../admin/store.ts'

export interface NotepadNote {
  id: string
  title: string
  content: string
  pinned?: boolean
  created_at: string
  updated_at: string
}

const notepadFile = (ctx: ApiContext) => contentFile(ctx.contentDir, 'notepad', 'notes.json')

function sortNotes(notes: NotepadNote[]): NotepadNote[] {
  return [...notes].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    return (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at)
  })
}



const FORMAT_PROMPT = `You are a smart Notepad formatting assistant.
Your job is to take the user's raw free-form note and format it cleanly using standard Markdown so it is easy to read and well-structured.

STRICT RULES:
1. KEEP ALL INFORMATION AND LANGUAGE:
   - Never delete, summarize away, or translate the user's content (Vietnamese stays Vietnamese, English stays English, mixed stays mixed).
   - Keep every detail, example, vocabulary item, number, personal note, and any Markdown image links ![...](...) intact in their exact place.
2. IMPROVE FORMATTING & READABILITY:
   - Fix obvious typos, missing Vietnamese diacritics, or broken punctuation/spacing.
   - Break long run-on text into logical paragraphs.
   - Use ### Headings for clear sections when appropriate.
   - Use **bold** for key terms, labels, English vocabulary/structures, or important takeaways.
   - Use *italics* for subtle emphasis or example sentences when helpful.
   - Convert enumerated items or messy lines into clean bullet points (- item) or numbered lists (1. item).
3. TITLE:
   - If the user already provided a good title, keep it (with minor typo fixes if needed).
   - If the title is empty, generate a concise, natural title (3–8 words) matching the note's language.`

export const notepadRoutes: Record<string, ApiHandler> = {
  'GET /notepad': async (_req, ctx) => {
    const doc = await readJsonDoc<NotepadNote[]>(notepadFile(ctx), [])
    return { json: { notes: sortNotes(doc.value) } }
  },

  'PUT /notepad': async (req, ctx) => {
    const body = jsonBody(req)
    if (!isObject(body)) throw new ApiError(400, 'Invalid request body.')

    const rawId = typeof body.id === 'string' ? body.id.trim() : ''
    const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
    const rawContent = typeof body.content === 'string' ? body.content.replace(/\r\n/g, '\n') : ''
    const pinned = typeof body.pinned === 'boolean' ? body.pinned : undefined

    if (!rawTitle && !rawContent.trim()) {
      throw new ApiError(400, 'Vui lòng nhập tiêu đề hoặc nội dung ghi chú.')
    }

    const fallbackTitle = rawContent.trim().replace(/^[#*>-]+\s*/, '').split('\n')[0]?.slice(0, 80) || 'Ghi chú không tiêu đề'
    const title = rawTitle || fallbackTitle
    const now = new Date().toISOString()

    const saved = await updateJsonDoc<NotepadNote[], NotepadNote>(notepadFile(ctx), [], (notes) => {
      const idx = rawId ? notes.findIndex((n) => n.id === rawId) : -1
      if (idx >= 0) {
        const existing = notes[idx]
        const updated: NotepadNote = {
          ...existing,
          title,
          content: rawContent,
          pinned: pinned ?? existing.pinned ?? false,
          updated_at: now,
        }
        notes[idx] = updated
        return updated
      }
      const created: NotepadNote = {
        id: rawId || randomUUID(),
        title,
        content: rawContent,
        pinned: Boolean(pinned),
        created_at: now,
        updated_at: now,
      }
      notes.unshift(created)
      return created
    })

    return { json: { note: saved } }
  },

  'POST /notepad/format': async (req) => {
    const body = jsonBody(req)
    if (!isObject(body)) throw new ApiError(400, 'Invalid request body.')
    const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
    const rawContent = typeof body.content === 'string' ? body.content.trim() : ''
    if (!rawContent) throw new ApiError(400, 'Chưa có nội dung để AI format.')

    const generated = await antigravityJson({
      label: `notepad-format: ${(rawTitle || rawContent).slice(0, 40)}`,
      system: FORMAT_PROMPT,
      prompt: `--- CURRENT TITLE ---\n${rawTitle || '(empty)'}\n\n--- RAW NOTE CONTENT ---\n${rawContent}`,
      jsonSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          formattedContent: { type: 'string' },
        },
        required: ['title', 'formattedContent'],
      },
      model: process.env.WRITING_REVIEW_ANTIGRAVITY_MODEL || process.env.SPEAKING_ANTIGRAVITY_MODEL || 'gemini-3.8-flash-medium',
      effort: 'low',
    })
    const val = (generated.value ?? {}) as { title?: string; formattedContent?: string }
    const formattedContent = val.formattedContent?.trim() || rawContent
    const suggestedTitle = rawTitle || val.title?.trim() || ''

    return {
      json: {
        title: suggestedTitle,
        content: formattedContent,
      },
    }
  },


  'POST /notepad/images': async (req, ctx) => {
    const body = jsonBody(req)
    if (!isObject(body) || !Array.isArray(body.files) || !body.files.length) {
      throw new ApiError(400, 'Vui lòng chọn ít nhất 1 hình ảnh.')
    }
    if (body.files.length > 10) {
      throw new ApiError(400, 'Tối đa 10 ảnh mỗi lần tải lên.')
    }

    const sharp = (await import('sharp')).default
    const publicDir = path.join(ctx.rootDir, 'public', 'notepad-images')
    await mkdir(publicDir, { recursive: true })

    const uploaded: { name: string; url: string }[] = []
    for (let i = 0; i < body.files.length; i++) {
      const item = body.files[i]
      if (!isObject(item) || typeof item.data !== 'string' || typeof item.mimeType !== 'string') {
        throw new ApiError(400, 'Dữ liệu ảnh không hợp lệ.')
      }
      if (!/^image\/(png|jpe?g|webp|gif)$/i.test(item.mimeType)) {
        throw new ApiError(400, 'Chỉ hỗ trợ ảnh PNG, JPG, WebP và GIF.')
      }
      const buffer = Buffer.from(item.data.replace(/^data:[^,]*,/, ''), 'base64')
      if (!buffer.length || buffer.length > 15 * 1024 * 1024) {
        throw new ApiError(400, 'Kích thước mỗi ảnh tối đa 15 MB.')
      }
      const rawName = typeof item.name === 'string' ? path.parse(item.name).name : 'image'
      const safeBase =
        rawName
          .normalize('NFD')
          .replace(/\p{M}/gu, '')
          .replace(/đ/gi, 'd')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'image'

      const isGif = /gif$/i.test(item.mimeType)
      const webp = await sharp(buffer, { animated: isGif })
        .resize({ width: 1600, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer()

      const stamp = Date.now().toString(36)
      let fileName = `${stamp}-${safeBase}.webp`
      for (let n = 1; existsSync(path.join(publicDir, fileName)); n++) {
        fileName = `${stamp}-${safeBase}-${n}.webp`
      }
      await writeFile(path.join(publicDir, fileName), webp)
      uploaded.push({ name: rawName || 'Hình ảnh', url: `/notepad-images/${fileName}` })
    }

    return { json: { images: uploaded } }
  },

  'DELETE /notepad': async (req, ctx) => {
    const id = queryParam(req, 'id')
    await updateJsonDoc<NotepadNote[], void>(notepadFile(ctx), [], (notes) => {
      const idx = notes.findIndex((n) => n.id === id)
      if (idx < 0) throw new ApiError(404, 'Không tìm thấy ghi chú này.')
      notes.splice(idx, 1)
    })
    return { json: { ok: true, id } }
  },
}
