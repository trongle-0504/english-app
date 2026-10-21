// The login gate, end to end against the production server (needs a build: npm run build). Runs on its own port with
// a throwaway DATA_DIR, so it touches neither data/ nor a running dev server. Run: npm test
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

const root = path.resolve(import.meta.dirname, '..', '..')
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lt-auth-test-'))
process.env.DATA_DIR = dataDir
const PORT = 4199
const base = `http://127.0.0.1:${PORT}`
const email = 'owner@example.test'
const password = randomBytes(12).toString('base64url')

let server: ChildProcess

before(async () => {
  server = spawn(process.execPath, ['server/index.ts'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('server did not start')
})

after(() => {
  server.kill()
  rmSync(dataDir, { recursive: true, force: true })
})

const login = (pass: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ email, password: pass }) })
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]

test('without a session: /api and /data are refused, the page shell is served', async () => {
  assert.equal((await fetch(`${base}/api/analyze/history`)).status, 401)
  assert.equal((await fetch(`${base}/data/lookup.json`)).status, 401)
  assert.equal((await fetch(`${base}/`)).status, 200)
  const me = await fetch(`${base}/api/auth/me`)
  assert.equal(me.status, 401)
  assert.equal(((await me.json()) as { needsSetup: boolean }).needsSetup, true)
})

test('login, use the session, log out', async () => {
  const { createUser } = await import('../../server/auth/users.ts')
  await createUser(email, password)

  const res = await login(password)
  assert.equal(res.status, 200)
  const setCookie = res.headers.get('set-cookie') ?? ''
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /SameSite=Lax/)
  assert.doesNotMatch(setCookie, /Secure/, 'plain http: no Secure flag')
  const cookie = cookieOf(res)

  assert.equal((await fetch(`${base}/api/analyze/history`, { headers: { cookie } })).status, 200)
  assert.equal((await fetch(`${base}/data/lookup.json`, { headers: { cookie } })).status, 200)
  assert.equal(((await (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).json()) as { user: { email: string } }).user.email, email)

  await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie } })
  assert.equal((await fetch(`${base}/api/analyze/history`, { headers: { cookie } })).status, 401)
})

test('behind HTTPS (X-Forwarded-Proto) the cookie is Secure', async () => {
  const res = await login(password, { 'X-Forwarded-Proto': 'https' })
  assert.match(res.headers.get('set-cookie') ?? '', /Secure/)
})

test('a request from another site is refused', async () => {
  const cookie = cookieOf(await login(password))
  const res = await fetch(`${base}/api/analyze/history?text=x`, { method: 'DELETE', headers: { cookie, Origin: 'https://evil.example' } })
  assert.equal(res.status, 403)
})

test('a reset password ends the existing sessions', async () => {
  const cookie = cookieOf(await login(password))
  const { findByEmail, setPassword } = await import('../../server/auth/users.ts')
  const { deleteUserSessions } = await import('../../server/auth/sessions.ts')
  const user = (await findByEmail(email))!
  await setPassword(user.id, password)
  await deleteUserSessions(user.id)
  assert.equal((await fetch(`${base}/api/analyze/history`, { headers: { cookie } })).status, 401)
})

test('change password: needs the current one; other sessions end, this one goes on', async () => {
  const change = (cookie: string, current: string, next: string) =>
    fetch(`${base}/api/auth/change-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ current, next }) })
  assert.equal((await change('', password, 'x'.repeat(12))).status, 401, 'no session')

  const cookie = cookieOf(await login(password))
  const otherDevice = cookieOf(await login(password))
  assert.equal((await change(cookie, 'not-the-password', 'x'.repeat(12))).status, 400)
  assert.equal((await change(cookie, password, 'short')).status, 400)

  const next = randomBytes(12).toString('base64url')
  const res = await change(cookie, password, next)
  assert.equal(res.status, 200)
  const fresh = cookieOf(res)
  assert.equal((await fetch(`${base}/api/analyze/history`, { headers: { cookie: fresh } })).status, 200)
  assert.equal((await fetch(`${base}/api/analyze/history`, { headers: { cookie: otherDevice } })).status, 401)
  assert.equal((await login(password)).status, 401, 'the old password no longer works')
  assert.equal((await login(next)).status, 200)
})

test('wrong passwords: 401, then locked after 5', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login('wrong-password')).status, 401)
  const locked = await login(password)
  assert.equal(locked.status, 429, 'even the right password waits out the lock')
})
