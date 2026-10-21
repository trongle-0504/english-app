// The login session in the browser. The server keeps it in an HttpOnly cookie; this module only asks who is logged
// in, sends people to /login when they are not, and logs out.
import { redirect, type LoaderFunctionArgs } from 'react-router'

export interface AuthUser {
  id: string
  email: string
  role: 'admin'
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

/** Root route loader: no session → /login. If the server cannot be reached, the pages show their own errors. */
export async function requireUser({ request }: LoaderFunctionArgs) {
  if (current) return null
  const me = await fetchMe().catch(() => null)
  if (!me) return null
  if (!me.user) throw redirect(loginUrl(new URL(request.url)))
  current = me.user
  return null
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const body = (await res.json().catch(() => ({}))) as { user?: AuthUser; error?: string }
  if (!res.ok || !body.user) throw new Error(body.error || `Đăng nhập thất bại (${res.status}).`)
  return body.user
}

/** The other devices are signed out; this one keeps going with a fresh session cookie. */
export async function changePassword(current: string, next: string): Promise<void> {
  const res = await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current, next }) })
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(body.error || `Không đổi được mật khẩu (${res.status}).`)
}

/** Ends the session, drops what the service worker cached for it, and reloads at /login (clears in-memory data). */
export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  if ('caches' in window) await Promise.all((await caches.keys()).map((key) => caches.delete(key))).catch(() => {})
  window.location.assign('/login')
}

// A session can end while a page is open (expired, password reset from the CLI). Every page fetches /api and /data
// itself, so the 401 is caught here once instead of in each of them: back to /login, then to this page.
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const res = await originalFetch(input, init)
  if (res.status === 401 && window.location.pathname !== '/login') {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
    if (url.origin === window.location.origin && /^\/(api|data)\//.test(url.pathname) && !url.pathname.startsWith('/api/auth/')) {
      window.location.assign(loginUrl(window.location))
    }
  }
  return res
}
