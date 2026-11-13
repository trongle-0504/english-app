// Multi-user isolation, end to end against the production server with MULTI_USER=1 (PLAN-multi-user-v2.md, 3.6).
// Learner A's data carries a canary string in every kind of file; learner B calls every GET route (with A's ids where a
// route takes one), /data, A's pictures and A's jobs, and nothing B gets back may contain the canary. Also: pending
// accounts, the two-device limit, admin-only routes, "view as", daily limits. Throwaway DATA_DIR and port.
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

const root = path.resolve(import.meta.dirname, '..', '..')
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lt-multi-test-'))
process.env.DATA_DIR = dataDir
const PORT = 4197
const base = `http://127.0.0.1:${PORT}`
const CANARY = `CANARY-A-${randomBytes(6).toString('hex')}`
const password = randomBytes(12).toString('base64url')

let server: ChildProcess
let uidA = ''
let uidB = ''

const cookies: Record<string, string> = {}

const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** Logs in from a fresh device; returns "session=…; device=…" for later requests. */
async function login(email: string, device = ''): Promise<{ status: number; cookie: string; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/api/auth/login`, { ...json({ email, password }), headers: { 'Content-Type': 'application/json', ...(device ? { cookie: device } : {}) } })
  const set = res.headers.getSetCookie().map((c) => c.split(';')[0])
  const deviceCookie = set.find((c) => c.startsWith('em_device=')) ?? device
  const session = set.find((c) => c.startsWith('lt_session=')) ?? ''
  return { status: res.status, cookie: [session, deviceCookie].filter(Boolean).join('; '), body: (await res.json()) as Record<string, unknown> }
}

const get = (url: string, cookie: string, headers: Record<string, string> = {}) => fetch(`${base}${url}`, { headers: { cookie, ...headers } })

before(async () => {
  const { createUser } = await import('../../server/auth/users.ts')
  await createUser('admin@example.test', password, { role: 'admin' })
  uidA = (await createUser('a@example.test', password, { role: 'learner', displayName: 'A' })).id
  uidB = (await createUser('b@example.test', password, { role: 'learner', displayName: 'B' })).id

  // A's folder, seeded before the server starts: a canary in every kind of personal file.
  const a = path.join(dataDir, 'users', uidA)
  const seed = (rel: string, value: unknown) => {
    const file = path.join(a, rel)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
  }
  const doc = { id: 'abc123-def456', createdAt: '2026-11-01T00:00:00Z', title: CANARY, text: CANARY, prompt: CANARY, question: CANARY }
  for (const dir of ['writing-reviews', 'speaking-reviews', 'speaking', 'listening', 'writing-task1', 'speaking-mock', 'coach']) seed(`progress/${dir}/abc123-def456.json`, doc)
  seed('progress/review.json', { cards: { [`custom:${CANARY}`]: { box: 1 } } })
  seed('progress/review-log.jsonl', `${JSON.stringify({ at: '2026-11-01T00:00:00Z', id: CANARY })}\n`)
  seed('progress/practice.json', { [CANARY]: 1 })
  seed('progress/planner/planner.json', { tasks: [{ id: 'task1', title: CANARY }] })
  seed('content/vocabulary/words.json', [{ word: CANARY.toLowerCase(), senses: [{ meaning_vi: CANARY }] }])
  seed('content/note/notes.json', [{ id: 'n1', title: CANARY }])
  seed('content/notepad/notes.json', [{ id: 'p1', title: CANARY, content: CANARY, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' }])
  seed('content/grammar/history.json', { [CANARY]: CANARY })
  seed('content/review/mine.json', { name: CANARY, cards: [{ term: CANARY, meaning_vi: CANARY }] })
  seed('public/notepad-images/a.png', 'PNG-' + CANARY)
  seed('public/vocab-images/a.webp', 'WEBP-' + CANARY)

  server = spawn(process.execPath, ['server/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      MULTI_USER: '1',
      ADMIN_REQUIRE_2FA: '0',
      NEWS_SCHEDULER: 'off',
      ANTIGRAVITY_BIN: path.join(dataDir, 'no-agy'),
      COACH_ENABLED: '1',
    },
    stdio: 'ignore',
  })
  for (let i = 0; i < 150; i++) {
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break
    await new Promise((r) => setTimeout(r, 100))
  }
  for (const [who, email] of [['a', 'a@example.test'], ['b', 'b@example.test'], ['admin', 'admin@example.test']] as const) {
    const res = await login(email)
    assert.equal(res.status, 200, `${who} logs in`)
    cookies[who] = res.cookie
  }
})

after(() => {
  server?.kill()
  rmSync(dataDir, { recursive: true, force: true })
})

test('sanity: A sees their own canary (the seed is read by the app)', async () => {
  const notepad = await (await get('/api/notepad', cookies.a)).text()
  assert.match(notepad, new RegExp(CANARY))
  const img = await get('/notepad-images/a.png', cookies.a)
  assert.equal(img.status, 200)
})

test('B never gets A’s data from any GET route, with or without A’s ids', async () => {
  const { routes } = await import('../../server/routes.ts')
  const ids = ['abc123-def456', 'task1', 'p1', 'n1', uidA, `../${uidA}`, `../../users/${uidA}/progress/review.json`]
  const leaks: string[] = []
  for (const key of Object.keys(routes)) {
    const [method, route] = key.split(' ')
    if (method !== 'GET') continue
    const urls = [route, ...ids.flatMap((id) => [`${route}?id=${encodeURIComponent(id)}`, `${route}?session=${encodeURIComponent(id)}&id=${encodeURIComponent(id)}`])]
    for (const url of urls) {
      const res = await get(`/api${url}`, cookies.b).catch(() => null)
      if (!res) continue
      const body = Buffer.from(await res.arrayBuffer()).toString('latin1')
      if (body.includes(CANARY)) leaks.push(`${url} (${res.status})`)
    }
  }
  assert.deepEqual(leaks, [])
})

test('B’s /data build has none of A’s library; A’s has it', async () => {
  for (const file of ['lookup.json', 'review/index.json', 'vocabulary/index.json']) {
    const b = await get(`/data/${file}`, cookies.b)
    const text = await b.text()
    assert.doesNotMatch(text, new RegExp(CANARY), `B /data/${file}`)
  }
  assert.match(await (await get('/data/lookup.json', cookies.a)).text(), new RegExp(CANARY.toLowerCase()))
})

test('pictures: A’s own are A’s only; no session gets 401 for notepad pictures', async () => {
  assert.equal((await get('/notepad-images/a.png', cookies.b)).status, 404)
  assert.equal((await get('/notepad-images/a.png', '')).status, 401)
  const vocabB = await get('/vocab-images/a.webp', cookies.b)
  assert.doesNotMatch(await vocabB.text(), new RegExp(CANARY))
  const traversal = await get('/notepad-images/..%2F..%2Fprogress%2Freview.json', cookies.a)
  assert.doesNotMatch(await traversal.text(), new RegExp(CANARY))
})

test('B cannot change or delete A’s things by id', async () => {
  await fetch(`${base}/api/notepad?id=p1`, { method: 'DELETE', headers: { cookie: cookies.b } })
  await fetch(`${base}/api/planner/task?id=task1`, { method: 'DELETE', headers: { cookie: cookies.b } })
  await fetch(`${base}/api/writing-review?id=abc123-def456`, { method: 'DELETE', headers: { cookie: cookies.b } })
  assert.match(await (await get('/api/notepad', cookies.a)).text(), new RegExp(CANARY))
  const { existsSync } = await import('node:fs')
  assert.ok(existsSync(path.join(dataDir, 'users', uidA, 'progress', 'writing-reviews', 'abc123-def456.json')))
})

test('jobs started by one account are invisible to another (OwnedMap)', async () => {
  const { OwnedMap, requestUser } = await import('../../server/users/context.ts')
  const jobs = new OwnedMap<string, { secret: string }>()
  requestUser.run({ id: 'user-a-0001', role: 'learner' }, () => jobs.set('job1', { secret: CANARY }))
  requestUser.run({ id: 'user-b-0002', role: 'learner' }, () => {
    assert.equal(jobs.get('job1'), undefined)
    assert.equal(jobs.has('job1'), false)
    assert.equal(jobs.delete('job1'), false)
  })
  requestUser.run({ id: 'user-a-0001', role: 'learner' }, () => assert.equal(jobs.get('job1')?.secret, CANARY))
})

test('learners cannot use admin routes; the admin can', async () => {
  for (const url of ['/api/admin/users', '/api/admin/usage', '/api/admin/grammar', '/api/coach/stats']) {
    assert.equal((await get(url, cookies.b)).status, 403, url)
  }
  assert.equal((await get('/api/admin/users', cookies.admin)).status, 200)
})

test('view as: admin reads A read-only (audited); learners cannot use the header', async () => {
  const seen = await get('/api/notepad', cookies.admin, { 'x-view-as': uidA })
  assert.match(await seen.text(), new RegExp(CANARY))
  const write = await fetch(`${base}/api/notepad`, { method: 'PUT', headers: { cookie: cookies.admin, 'x-view-as': uidA, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' }) })
  assert.equal(write.status, 403)
  assert.equal((await get('/api/notepad', cookies.b, { 'x-view-as': uidA })).status, 403)
  const { readFileSync } = await import('node:fs')
  assert.match(readFileSync(path.join(dataDir, 'auth', 'audit.jsonl'), 'utf8'), /admin\.view-as/)
})

test('sign-up: a pending account can log in but reaches no data until approved', async () => {
  const reg = await fetch(`${base}/api/auth/register`, json({ displayName: 'C', email: 'c@example.test', password, note: 'hi' }))
  assert.equal(reg.status, 200)
  const c = await login('c@example.test')
  assert.equal(c.status, 200)
  assert.equal((c.body.user as { status: string }).status, 'pending')
  assert.equal((await get('/api/notepad', c.cookie)).status, 403)
  assert.equal((await get('/data/lookup.json', c.cookie)).status, 403)
  // Same answer for an email that already exists.
  assert.equal((await fetch(`${base}/api/auth/register`, json({ displayName: 'X', email: 'a@example.test', password }))).status, 200)
  const users = (await (await get('/api/admin/users', cookies.admin)).json()) as { users: { id: string; email: string; status: string }[] }
  const pending = users.users.find((u) => u.email === 'c@example.test')
  assert.equal(pending?.status, 'pending')
  const ok = await fetch(`${base}/api/admin/users/approve`, { ...json({ id: pending?.id }), headers: { 'Content-Type': 'application/json', cookie: cookies.admin } })
  assert.equal(ok.status, 200)
  assert.equal((await get('/api/notepad', c.cookie)).status, 200)
})

test('a learner may use two devices; the third is refused', async () => {
  // A already logged in once (device 1). A second device works, a third does not; device 1 again still works.
  const second = await login('a@example.test')
  assert.equal(second.status, 200)
  const third = await login('a@example.test')
  assert.equal(third.status, 403)
  const firstDevice = cookies.a.split('; ').find((c) => c.startsWith('em_device=')) ?? ''
  assert.equal((await login('a@example.test', firstDevice)).status, 200)
})

test('admin-added account must change its password first', async () => {
  const res = await fetch(`${base}/api/admin/users`, { ...json({ email: 'd@example.test', displayName: 'D' }), headers: { 'Content-Type': 'application/json', cookie: cookies.admin } })
  assert.equal(res.status, 200)
  const { password: temp } = (await res.json()) as { password: string }
  const d = await fetch(`${base}/api/auth/login`, json({ email: 'd@example.test', password: temp }))
  const cookie = d.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  assert.equal((await get('/api/notepad', cookie)).status, 403)
})

test('daily limits: a learner over the Writing limit gets 429 before any AI runs', async () => {
  await fetch(`${base}/api/admin/users`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: cookies.admin }, body: JSON.stringify({ id: uidB, quota: { writingPerDay: 0 } }) })
  const res = await fetch(`${base}/api/writing-review`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookies.b }, body: JSON.stringify({ text: 'An essay.' }) })
  assert.equal(res.status, 429)
  const quota = (await (await get('/api/me/quota', cookies.b)).json()) as { limits: { writing: number } }
  assert.equal(quota.limits.writing, 0)
})

test('every route has an access class; admin-only areas are admin', async () => {
  const { routes } = await import('../../server/routes.ts')
  const { routeClass } = await import('../../server/users/access.ts')
  for (const key of Object.keys(routes)) assert.ok(['public', 'account', 'user', 'admin'].includes(routeClass(key)), key)
  for (const key of ['GET /admin/users', 'PUT /admin/grammar/lesson', 'PUT /admin/blog/post', 'POST /admin/essays/analyze', 'GET /admin/usage', 'POST /speaking/sync', 'DELETE /news']) {
    assert.equal(routeClass(key), 'admin', key)
  }
  assert.equal(routeClass('GET /notepad'), 'user')
  assert.equal(routeClass('POST /auth/register'), 'public')
})
