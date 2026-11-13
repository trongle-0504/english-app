// The login session in the browser. The server keeps it in an HttpOnly cookie; this module only asks who is logged
// in, sends people to /login when they are not, and logs out.
import { redirect, type LoaderFunctionArgs } from 'react-router'

export interface AuthUser {
  id: string
  email: string
  role: 'admin' | 'learner'
  twoFactor?: boolean
  /** Multi-user app: 'pending' until the admin approves a sign-up. */
  status?: 'pending' | 'active' | 'rejected'
  displayName?: string
  /** The admin set the password: change it before using the app. */
  mustChangePassword?: boolean
}

/** Set once the root loader has seen a session, so later navigations do not ask again. */
let current: AuthUser | null = null

/** /login with a way back to `url` (the page that needed the session). */
export function loginUrl(url: { pathname: string; search: string; hash?: string }): string {
  const back = `${url.pathname}${url.search}${url.hash ?? ''}`
  return back === '/' || url.pathname === '/login' ? '/login' : `/login?next=${encodeURIComponent(back)}`
}

/** Only a path on this site: `next=//evil.example` must not send someone away after logging in. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/'
}

export async function fetchMe(): Promise<{ user: AuthUser | null; needsSetup: boolean }> {
  const res = await fetch('/api/auth/me', { cache: 'no-store' })
  const body = (await res.json().catch(() => ({}))) as { user?: AuthUser; needsSetup?: boolean }
  return { user: res.ok ? (body.user ?? null) : null, needsSetup: Boolean(body.needsSetup) }
}

/** The account loaded by the root loader (null before it ran). */
export const currentUser = (): AuthUser | null => current

/**
 * Root route loader: no session → /login. Multi-user app: an account waiting for approval → /pending; a password the
 * admin set → /account to change it first. If the server cannot be reached, the pages show their own errors.
 */
export async function requireUser({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  if (!current) {
    const me = await fetchMe().catch(() => null)
    if (!me) return null
    if (!me.user) throw redirect(loginUrl(url))
    current = me.user
    if (multi === null) await loadRegisterConfig()
  }
  if (current.status === 'pending' || current.status === 'rejected') throw redirect('/pending')
  if (current.mustChangePassword && url.pathname !== '/account') throw redirect('/account?first=1')
  if (current.role === 'admin' && current.twoFactor === false && url.pathname !== '/account' && isMultiUser()) throw redirect('/account?admin2fa=1')
  return null
}

/** Multi-user app (the sign-up config answers): cached after the first ask. */
let multi: boolean | null = null
export const isMultiUser = () => multi === true
export async function loadRegisterConfig(): Promise<{ multi: boolean; open: boolean; turnstileSiteKey: string }> {
  const res = await fetch('/api/auth/register/config', { cache: 'no-store' }).catch(() => null)
  if (!res || !res.ok) {
    multi = false
    return { multi: false, open: false, turnstileSiteKey: '' }
  }
  const body = (await res.json()) as { multi: boolean; open: boolean; turnstileSiteKey: string }
  multi = Boolean(body.multi)
  return body
}

async function postJson<T>(url: string, json: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error || `Lỗi ${res.status}.`)
  return body
}

export const register = (form: { displayName: string; email: string; password: string; note: string; turnstileToken?: string }) =>
  postJson<{ ok: true }>('/api/auth/register', form)
export const forgotPassword = (email: string) => postJson<{ ok: true }>('/api/auth/forgot', { email })

/** A user, or `{ challenge }` when the account needs its second factor (then call `login2fa`). */
export async function login(email: string, password: string): Promise<AuthUser | { challenge: string }> {
  const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const body = (await res.json().catch(() => ({}))) as { user?: AuthUser; challenge?: string; needs2fa?: boolean; error?: string }
  if (res.ok && body.needs2fa && body.challenge) return { challenge: body.challenge }
  if (!res.ok || !body.user) throw new Error(body.error || `Đăng nhập thất bại (${res.status}).`)
  return body.user
}

/** Second step of a login: an authenticator code or a recovery code. */
export async function login2fa(challenge: string, code: string): Promise<AuthUser> {
  const res = await fetch('/api/auth/login/2fa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge, code }) })
  const body = (await res.json().catch(() => ({}))) as { user?: AuthUser; error?: string }
  if (!res.ok || !body.user) throw new Error(body.error || `Xác thực thất bại (${res.status}).`)
  return body.user
}

async function post2fa<T>(action: string, json: unknown = {}): Promise<T> {
  const res = await fetch(`/api/auth/2fa/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error || `Lỗi ${res.status}.`)
  return body
}

export const twoFactorSetup = () => post2fa<{ secret: string; uri: string; qr: string }>('setup')
export const twoFactorEnable = (code: string) => post2fa<{ recoveryCodes: string[] }>('enable', { code })
export const twoFactorDisable = (password: string, code: string) => post2fa<{ ok: true }>('disable', { password, code })
export const twoFactorRecovery = (password: string, code: string) => post2fa<{ recoveryCodes: string[] }>('recovery', { password, code })

/** The other devices are signed out; this one keeps going with a fresh session cookie. */
export async function changePassword(current: string, next: string): Promise<void> {
  const res = await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current, next }) })
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(body.error || `Không đổi được mật khẩu (${res.status}).`)
}

/** Ends the session, drops what the service worker cached for it, and reloads at /login (clears in-memory data). */
export async function logout(): Promise<void> {
  sessionStorage.removeItem(VIEW_AS_KEY)
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  if ('caches' in window) await Promise.all((await caches.keys()).map((key) => caches.delete(key))).catch(() => {})
  window.location.assign('/login')
}

/* ───────────── Admin "view as" (multi-user app) ───────────── */

export const VIEW_AS_KEY = 'viewAs'
export interface ViewAs {
  id: string
  name: string
}
export function viewingAs(): ViewAs | null {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_AS_KEY) ?? 'null') as ViewAs | null
  } catch {
    return null
  }
}
/** Starts (or ends, with null) reading a learner's pages; reloads so every page and cache starts fresh. */
export function setViewAs(target: ViewAs | null, goTo = '/') {
  if (target) sessionStorage.setItem(VIEW_AS_KEY, JSON.stringify(target))
  else sessionStorage.removeItem(VIEW_AS_KEY)
  window.location.assign(goTo)
}

// A session can end while a page is open (expired, password reset from the CLI). Every page fetches /api and /data
// itself, so the 401 is caught here once instead of in each of them: back to /login, then to this page.
// Admin "view as": every same-site /api and /data read carries X-View-As (the server allows reads only).
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const viewAs = viewingAs()
  if (viewAs) {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (url.origin === window.location.origin && /^\/(api|data)\//.test(url.pathname) && !url.pathname.startsWith('/api/auth/') && !url.pathname.startsWith('/api/admin/') && !url.pathname.startsWith('/api/me/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        return new Response(JSON.stringify({ error: 'Đang ở chế độ "Xem như học viên" (chỉ đọc).' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
      }
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      headers.set('X-View-As', viewAs.id)
      init = { ...init, headers }
    }
  }
  const res = await originalFetch(input, init)
  if (res.status === 401 && window.location.pathname !== '/login') {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
    if (url.origin === window.location.origin && /^\/(api|data)\//.test(url.pathname) && !url.pathname.startsWith('/api/auth/')) {
      window.location.assign(loginUrl(window.location))
    }
  }
  return res
}
