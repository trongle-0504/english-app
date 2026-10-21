import type { ApiHandler } from '../api.ts'
import { geminiConfigured } from '../gemini.ts'
import { guarded, isAuthorized, tokenRequired } from '../admin/auth.ts'
import * as blog from '../admin/blog.ts'
import * as grammar from '../admin/grammar.ts'
import * as notes from '../admin/notes.ts'
import * as usage from '../admin/usage.ts'
import * as vocabulary from '../admin/vocabulary.ts'

/**
 * Admin editor endpoints (served under /api). Reads are open; every write goes through `guarded`,
 * which enforces ADMIN_TOKEN when it is set (see server/admin/auth.ts).
 */
export const adminRoutes: Record<string, ApiHandler> = {
  'GET /admin/session': (req) => ({
    json: { tokenRequired: tokenRequired(), authorized: isAuthorized(req), gemini: geminiConfigured() },
  }),

  'GET /admin/vocabulary': vocabulary.listVocabulary,
  'GET /admin/vocabulary/word': vocabulary.getWord,
  'POST /admin/vocabulary/topics': guarded(vocabulary.createTopic),
  'POST /admin/vocabulary/sub-topics': guarded(vocabulary.createSubTopic),
  'POST /admin/vocabulary/generate': guarded(vocabulary.generateWord),
  'PUT /admin/vocabulary/word': guarded(vocabulary.saveWord),
  'GET /admin/vocabulary/images': guarded(vocabulary.searchWordImages),
  'POST /admin/vocabulary/image': guarded(vocabulary.setWordImage),

  'GET /admin/grammar': grammar.listGrammar,
  'GET /admin/grammar/lesson': grammar.getLesson,
  'POST /admin/grammar/topics': guarded(grammar.createTopic),
  'POST /admin/grammar/generate': guarded(grammar.generateLesson),
  'PUT /admin/grammar/lesson': guarded(grammar.saveLesson),

  'GET /admin/notes': notes.listNotes,
  'POST /admin/notes/generate': guarded(notes.generateNote),
  'PUT /admin/notes': guarded(notes.saveNote),
  'DELETE /admin/notes': guarded(notes.deleteNote),
  'GET /admin/notes/images': guarded(notes.searchNoteImages),
  'POST /admin/notes/image': guarded(notes.setNoteImage),

  'GET /admin/usage': guarded(usage.getUsage),
  'PUT /admin/usage/pricing': guarded(usage.savePricing),

  'GET /admin/blog': blog.listBlog,
  'GET /admin/blog/post': blog.getPost,
  'POST /admin/blog/topics': guarded(blog.createTopic),
  'POST /admin/blog/sub-topics': guarded(blog.createSubTopic),
  'PUT /admin/blog/post': guarded(blog.savePost),
  'DELETE /admin/blog/post': guarded(blog.deletePost),
  'POST /admin/blog/images': guarded(blog.uploadImages),
}
