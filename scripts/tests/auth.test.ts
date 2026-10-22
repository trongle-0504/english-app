// End-to-end auth + multi-user isolation tests against the production server (needs a build: npm run build).
// Runs on its own port with a throwaway DATA_DIR, so it touches neither data/ nor a running server.
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
const learnerEmail = 'learner@example.test'
const learnerPassword = randomBytes(12).toString('base64url')

let server: ChildProcess

before(async () => {
  server = spawn(process.execPath, ['server/index.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: 'ignore',
  })
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

const loginAs = (userEmail: string, pass: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ email: userEmail, password: pass }),
  })
const login = (pass: string, headers: Record<string, string> = {}) => loginAs(email, pass, headers)
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
  await createUser(email, password, 'admin')

  const res = await login(password)
  assert.equal(res.status, 200)
  const setCookie = res.headers.get('set-cookie') ?? ''
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /SameSite=Lax/)
  assert.doesNotMatch(setCookie, /Secure/, 'plain http: no Secure flag')
  const cookie = cookieOf(res)

  assert.equal((await fetch(`${base}/api/analyze/history`, { headers: { cookie } })).status, 200)
  assert.equal((await fetch(`${base}/data/lookup.json`, { headers: { cookie } })).status, 200)
  const meBody = (await (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).json()) as {
    user: { email: string; role: string }
  }
  assert.equal(meBody.user.email, email)
  assert.equal(meBody.user.role, 'admin')

  await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie } })
  assert.equal((await fetch(`${base}/api/analyze/history`, { headers: { cookie } })).status, 401)
})

test('behind HTTPS (X-Forwarded-Proto) the cookie is Secure', async () => {
  const res = await login(password, { 'X-Forwarded-Proto': 'https' })
  assert.match(res.headers.get('set-cookie') ?? '', /Secure/)
})

test('a request from another site is refused', async () => {
  const cookie = cookieOf(await login(password))
  const res = await fetch(`${base}/api/analyze/history?text=x`, {
    method: 'DELETE',
    headers: { cookie, Origin: 'https://evil.example' },
  })
  assert.equal(res.status, 403)
})

test('role enforcement: admin vs learner on /api/admin/* and shared content endpoints', async () => {
  const { createUser } = await import('../../server/auth/users.ts')
  await createUser(learnerEmail, learnerPassword, 'learner')

  const adminCookie = cookieOf(await loginAs(email, password))
  const learnerCookie = cookieOf(await loginAs(learnerEmail, learnerPassword))

  // Learner cannot access admin endpoints (403 Forbidden)
  assert.equal((await fetch(`${base}/api/admin/vocabulary`, { headers: { cookie: learnerCookie } })).status, 403)
  assert.equal((await fetch(`${base}/api/admin/notes`, { headers: { cookie: learnerCookie } })).status, 403)
  assert.equal((await fetch(`${base}/api/admin/usage`, { headers: { cookie: learnerCookie } })).status, 403)
  assert.equal((await fetch(`${base}/api/admin/users`, { headers: { cookie: learnerCookie } })).status, 403)
  assert.equal((await fetch(`${base}/api/admin/essays`, { headers: { cookie: learnerCookie } })).status, 403)
  assert.equal(
    (
      await fetch(`${base}/api/speaking/sync`, {
        method: 'POST',
        headers: { cookie: learnerCookie, 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    403,
  )

  // Admin can access admin endpoints (200 OK)
  assert.equal((await fetch(`${base}/api/admin/vocabulary`, { headers: { cookie: adminCookie } })).status, 200)
  assert.equal((await fetch(`${base}/api/admin/usage`, { headers: { cookie: adminCookie } })).status, 200)
  const usersRes = await fetch(`${base}/api/admin/users`, { headers: { cookie: adminCookie } })
  assert.equal(usersRes.status, 200)
  const usersJson = (await usersRes.json()) as { users: { email: string; role: string }[] }
  assert.equal(usersJson.users.length, 2)
})

test('multi-user isolation: review state, custom cards, grammar history, and practice works are isolated per user', async () => {
  const adminCookie = cookieOf(await loginAs(email, password))
  const learnerCookie = cookieOf(await loginAs(learnerEmail, learnerPassword))

  // 1. Review state & settings isolation
  const addRes = await fetch(`${base}/api/review/add`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: ['vocab:abandon'] }),
  })
  assert.equal(addRes.status, 200)
  await fetch(`${base}/api/review/settings`, {
    method: 'PUT',
    headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPerDay: 42 }),
  })

  const adminState = (await (await fetch(`${base}/api/review/state`, { headers: { cookie: adminCookie } })).json()) as {
    cards: Record<string, unknown>
    settings: { newPerDay: number }
  }
  const learnerState = (await (await fetch(`${base}/api/review/state`, { headers: { cookie: learnerCookie } })).json()) as {
    cards: Record<string, unknown>
    settings: { newPerDay: number }
  }
  assert.ok('vocab:abandon' in adminState.cards, 'admin has vocab:abandon')
  assert.equal(adminState.settings.newPerDay, 42)
  assert.deepEqual(learnerState.cards, {}, 'learner has empty cards')
  assert.notEqual(learnerState.settings.newPerDay, 42, 'learner has default settings')

  // 2. Custom review cards isolation (/api/me/review-cards & POST /api/review/custom)
  const createAdminCard = await fetch(`${base}/api/review/custom`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deck: 'admin-private-deck',
      card: { term: 'ephemeral', meaning_vi: 'phu du', examples: [{ en: 'Fame is **ephemeral**.' }] },
    }),
  })
  assert.equal(createAdminCard.status, 201)

  // Learner can also create their own custom card
  const createLearnerCard = await fetch(`${base}/api/review/custom`, {
    method: 'POST',
    headers: { cookie: learnerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deck: 'learner-own-deck',
      card: { term: 'resilient', meaning_vi: 'kien cuong', examples: [{ en: 'She is **resilient**.' }] },
    }),
  })
  assert.equal(createLearnerCard.status, 201)

  const adminCustom = (await (await fetch(`${base}/api/me/review-cards`, { headers: { cookie: adminCookie } })).json()) as {
    cards: { id: string; term: string }[]
  }
  const learnerCustom = (await (await fetch(`${base}/api/me/review-cards`, { headers: { cookie: learnerCookie } })).json()) as {
    cards: { id: string; term: string }[]
  }
  assert.deepEqual(
    adminCustom.cards.map((c) => c.term),
    ['ephemeral'],
  )
  assert.deepEqual(
    learnerCustom.cards.map((c) => c.term),
    ['resilient'],
  )

  // 3. Shared /data/review/index.json contains no custom cards, and /data/grammar/history.json is not exposed
  const sharedReviewIndex = (await (
    await fetch(`${base}/data/review/index.json`, { headers: { cookie: learnerCookie } })
  ).json()) as { cards: { source: string }[] }
  assert.equal(
    sharedReviewIndex.cards.some((c) => c.source === 'custom'),
    false,
    'shared /data/review/index.json has no personal custom cards',
  )
  assert.equal((await fetch(`${base}/data/grammar/history.json`, { headers: { cookie: learnerCookie } })).status, 404)

  // 4. Path traversal attempt on user-scoped endpoints is rejected
  const traversalRes = await fetch(`${base}/api/writing-review?id=../../etc/passwd`, {
    method: 'DELETE',
    headers: { cookie: learnerCookie },
  })
  assert.equal(traversalRes.status, 400)
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
    fetch(`${base}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ current, next }),
    })
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
