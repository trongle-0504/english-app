// Who may call which API route in the multi-user app (PLAN-multi-user-v2.md, 3.3). Every route key is in exactly one
// class; scripts/tests/isolation/route-classes.test.ts fails when a new route is not classified.
//   public  — no session (login, register, health)
//   account — any signed-in account, even one still waiting for approval (its own status, logout, password)
//   user    — an approved account; works on that account's own folder only
//   admin   — the admin only (shared content, other accounts, server-wide logs and jobs)

export type RouteClass = 'public' | 'account' | 'user' | 'admin'

const PUBLIC = new Set([
  'GET /health',
  'POST /auth/login',
  'POST /auth/login/2fa',
  'POST /auth/logout',
  'GET /auth/me',
  'POST /auth/register',
  'GET /auth/register/config',
  'POST /auth/forgot',
])

const ACCOUNT = new Set([
  'POST /auth/change-password',
  'POST /auth/2fa/setup',
  'POST /auth/2fa/enable',
  'POST /auth/2fa/disable',
  'POST /auth/2fa/recovery',
  'GET /me/devices',
  'DELETE /me/devices',
  'POST /me/delete',
])

/**
 * Admin-only: shared content (grammar lessons, blog, model essays), server-wide usage, the news pipeline, the DOL
 * check, the Speaking tag sync, accounts. Vocabulary / Notes / Drills under /admin are NOT here: in the multi-user
 * app they edit the caller's own library (the "Add to library" buttons use them).
 */
const ADMIN_PREFIXES = ['/admin/grammar', '/admin/blog', '/admin/essays', '/admin/usage', '/admin/users', '/admin/system']
const ADMIN_EXACT = new Set([
  'POST /news/collect',
  'POST /news/process',
  'POST /news/process-batch',
  'DELETE /news',
  'POST /dol/check',
  'POST /speaking/sync',
  'POST /speaking/sync/stop',
  'GET /coach/stats',
])

export function routeClass(key: string): RouteClass {
  if (PUBLIC.has(key)) return 'public'
  if (ACCOUNT.has(key)) return 'account'
  if (ADMIN_EXACT.has(key)) return 'admin'
  const path = key.slice(key.indexOf(' ') + 1)
  if (ADMIN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return 'admin'
  return 'user'
}

/** Routes a learner may call while an admin is reading their pages: none that write. */
export const readOnlyMethod = (method: string) => method === 'GET' || method === 'HEAD'
