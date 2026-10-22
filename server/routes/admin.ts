import { ApiError, type ApiHandler } from '../api.ts'
import { guarded, isAuthorized, tokenRequired } from '../admin/auth.ts'
import * as blog from '../admin/blog.ts'
import * as grammar from '../admin/grammar.ts'
import { jsonBody, requiredText } from '../admin/input.ts'
import * as notes from '../admin/notes.ts'
import * as usage from '../admin/usage.ts'
import * as vocabulary from '../admin/vocabulary.ts'
import { MIN_PASSWORD_LENGTH } from '../auth/password.ts'
import { deleteUserSessions } from '../auth/sessions.ts'
import { createUser, findById, listUsers, normalizeEmail, setDisabled, setPassword, setRole, type UserRole } from '../auth/users.ts'
import { geminiConfigured } from '../gemini.ts'

/**
 * Admin editor endpoints (served under /api). Every endpoint under /admin/* is guarded by admin role check.
 */
export const adminRoutes: Record<string, ApiHandler> = {
  'GET /admin/session': (req, ctx) => ({
    json: { tokenRequired: tokenRequired(), authorized: isAuthorized(req, ctx), gemini: geminiConfigured() },
  }),

  'GET /admin/vocabulary': guarded(vocabulary.listVocabulary),
  'GET /admin/vocabulary/word': guarded(vocabulary.getWord),
  'POST /admin/vocabulary/topics': guarded(vocabulary.createTopic),
  'POST /admin/vocabulary/sub-topics': guarded(vocabulary.createSubTopic),
  'POST /admin/vocabulary/generate': guarded(vocabulary.generateWord),
  'PUT /admin/vocabulary/word': guarded(vocabulary.saveWord),
  'GET /admin/vocabulary/images': guarded(vocabulary.searchWordImages),
  'POST /admin/vocabulary/image': guarded(vocabulary.setWordImage),

  'GET /admin/grammar': guarded(grammar.listGrammar),
  'GET /admin/grammar/lesson': guarded(grammar.getLesson),
  'POST /admin/grammar/topics': guarded(grammar.createTopic),
  'POST /admin/grammar/generate': guarded(grammar.generateLesson),
  'PUT /admin/grammar/lesson': guarded(grammar.saveLesson),

  'GET /admin/notes': guarded(notes.listNotes),
  'POST /admin/notes/generate': guarded(notes.generateNote),
  'PUT /admin/notes': guarded(notes.saveNote),
  'DELETE /admin/notes': guarded(notes.deleteNote),
  'GET /admin/notes/images': guarded(notes.searchNoteImages),
  'POST /admin/notes/image': guarded(notes.setNoteImage),

  'GET /admin/usage': guarded(usage.getUsage),
  'PUT /admin/usage/pricing': guarded(usage.savePricing),

  'GET /admin/blog': guarded(blog.listBlog),
  'GET /admin/blog/post': guarded(blog.getPost),
  'POST /admin/blog/topics': guarded(blog.createTopic),
  'POST /admin/blog/sub-topics': guarded(blog.createSubTopic),
  'PUT /admin/blog/post': guarded(blog.savePost),
  'DELETE /admin/blog/post': guarded(blog.deletePost),
  'POST /admin/blog/images': guarded(blog.uploadImages),

  /* ????????????? Admin ? Users Management ????????????? */

  'GET /admin/users': guarded(async () => {
    const users = await listUsers()
    return {
      json: {
        users: users.map(({ id, email, role, disabled, createdAt }) => ({
          id,
          email,
          role,
          disabled: Boolean(disabled),
          createdAt,
        })),
      },
    }
  }),

  'POST /admin/users': guarded(async (req) => {
    const body = jsonBody(req)
    const email = normalizeEmail(requiredText(body, 'email', { max: 160 }))
    if (!email.includes('@')) throw new ApiError(400, 'Invalid email address.')
    const password = typeof body.password === 'string' ? body.password : ''
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    }
    const role: UserRole = body.role === 'admin' ? 'admin' : 'learner'
    try {
      const user = await createUser(email, password, role)
      return {
        status: 201,
        json: {
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            disabled: Boolean(user.disabled),
            createdAt: user.createdAt,
          },
        },
      }
    } catch (error) {
      throw new ApiError(409, (error as Error).message)
    }
  }),

  'POST /admin/users/role': guarded(async (req, ctx) => {
    const body = jsonBody(req)
    const id = requiredText(body, 'id', { max: 80 })
    const role: UserRole = body.role === 'admin' ? 'admin' : 'learner'
    const target = await findById(id)
    if (!target) throw new ApiError(404, 'User not found.')
    if (target.id === ctx.user.id && role !== 'admin') {
      throw new ApiError(400, 'You cannot remove your own admin role.')
    }
    await setRole(target.id, role)
    return { json: { ok: true } }
  }),

  'POST /admin/users/status': guarded(async (req, ctx) => {
    const body = jsonBody(req)
    const id = requiredText(body, 'id', { max: 80 })
    const disabled = Boolean(body.disabled)
    const target = await findById(id)
    if (!target) throw new ApiError(404, 'User not found.')
    if (target.id === ctx.user.id && disabled) {
      throw new ApiError(400, 'You cannot disable your own account.')
    }
    await setDisabled(target.id, disabled)
    if (disabled) await deleteUserSessions(target.id)
    return { json: { ok: true } }
  }),

  'POST /admin/users/reset-password': guarded(async (req) => {
    const body = jsonBody(req)
    const id = requiredText(body, 'id', { max: 80 })
    const password = typeof body.password === 'string' ? body.password : ''
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    }
    const target = await findById(id)
    if (!target) throw new ApiError(404, 'User not found.')
    await setPassword(target.id, password)
    await deleteUserSessions(target.id)
    return { json: { ok: true } }
  }),
}
