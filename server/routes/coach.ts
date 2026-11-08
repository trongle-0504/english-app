// Study Coach API (behind the login gate). With COACH_ENABLED=0 every route but /coach/status answers 404.
import { isObject } from '../admin/input.ts'
import { ApiError, type ApiContext, type ApiHandler, type ApiRequest } from '../api.ts'
import { coachConfig, getCoach } from '../coach/service.ts'

const body = (req: ApiRequest): Record<string, unknown> => (isObject(req.body) ? req.body : {})
const param = (req: ApiRequest, key: string) => req.query.get(key) ?? ''

/** The coach, or 404 when it is switched off. */
function coach(ctx: ApiContext) {
  if (!coachConfig().enabled) throw new ApiError(404, 'Not found')
  return getCoach(ctx)
}

export const coachRoutes: Record<string, ApiHandler> = {
  'GET /coach/status': (_req, ctx) => {
    const config = coachConfig()
    return { json: config.enabled ? getCoach(ctx).status() : { enabled: false, model: config.model, retentionDays: config.retentionDays } }
  },

  'GET /coach/sessions': async (_req, ctx) => ({ json: { sessions: await coach(ctx).listSessions() } }),

  'POST /coach/sessions': async (_req, ctx) => ({ json: { id: await coach(ctx).createSession() } }),

  'GET /coach/session': async (req, ctx) => ({ json: { session: await coach(ctx).getSession(param(req, 'id')) } }),

  'DELETE /coach/session': async (req, ctx) => {
    await coach(ctx).deleteSession(param(req, 'id'))
    return { json: { ok: true } }
  },

  /** { sessionId, text, page? } → { turnId }; the turn runs in the background. */
  'POST /coach/turn': async (req, ctx) => {
    const input = body(req)
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const text = typeof input.text === 'string' ? input.text : ''
    const page = typeof input.page === 'string' ? input.page : undefined
    return { json: { turnId: await coach(ctx).startTurn(sessionId, text, page) } }
  },

  'GET /coach/turn': async (req, ctx) => ({ json: await coach(ctx).getTurn(param(req, 'session'), param(req, 'id')) }),

  'POST /coach/turn/cancel': (req, ctx) => {
    const input = body(req)
    coach(ctx).cancelTurn(String(input.sessionId ?? ''), String(input.turnId ?? ''))
    return { json: { ok: true } }
  },
}
