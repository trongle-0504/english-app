// Two-factor login, end to end against the production server (needs a build: npm run build), on its own port and a
// throwaway DATA_DIR. Plus the RFC 6238 test vector for the TOTP code itself. Run: npm test
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { base32Decode, base32Encode, currentStep, hotp, verifyTotp } from '../../server/auth/totp.ts'

const root = path.resolve(import.meta.dirname, '..', '..')
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lt-2fa-test-'))
process.env.DATA_DIR = dataDir
const PORT = 4198
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

const post = (url: string, json: unknown, cookie = '') =>
  fetch(`${base}/api/auth/${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(json) })
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]
const json = async <T>(res: Response) => (await res.json()) as T

test('RFC 6238 vector and base32', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'))
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  assert.equal(base32Decode(secret).toString(), '12345678901234567890')
  assert.equal(hotp(secret, Math.floor(59 / 30)), '287082') // RFC: 94287082, last 6 digits
  assert.equal(hotp(secret, Math.floor(1111111109 / 30)), '081804')
})

test('a code works once, and only near the current time', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'))
  const now = 1_111_111_109_000
  const step = Math.floor(now / 1000 / 30)
  assert.equal(verifyTotp(secret, '081804', -1, now), step)
  assert.equal(verifyTotp(secret, '081804', step, now), null, 'replay refused')
  assert.equal(verifyTotp(secret, '081804', -1, now + 5 * 60_000), null, 'five minutes later')
  assert.equal(verifyTotp(secret, '12345', -1, now), null)
})

test('set up, log in with a code, recovery code, disable', async () => {
  const { createUser } = await import('../../server/auth/users.ts')
  await createUser(email, password)

  // Without 2FA: a plain login.
  let res = await post('login', { email, password })
  assert.equal(res.status, 200)
  const cookie = cookieOf(res)
  assert.equal((await json<{ user: { twoFactor: boolean } }>(res)).user.twoFactor, false)

  // Setup needs a session; enabling needs a correct code.
  assert.equal((await post('2fa/setup', {})).status, 401)
  const setup = await json<{ secret: string; uri: string; qr: string }>(await post('2fa/setup', {}, cookie))
  assert.match(setup.uri, /^otpauth:\/\/totp\/NeSy:/)
  assert.match(setup.qr, /^data:image\/png/)
  assert.equal((await post('2fa/enable', { code: '000000' }, cookie)).status, 400)
  let step = currentStep()
  const { recoveryCodes } = await json<{ recoveryCodes: string[] }>(await post('2fa/enable', { code: hotp(setup.secret, step) }, cookie))
  assert.equal(recoveryCodes.length, 10)

  // The stored secret is not the plain one.
  const { readFile } = await import('node:fs/promises')
  assert.doesNotMatch(await readFile(path.join(dataDir, 'auth', 'users.json'), 'utf8'), new RegExp(setup.secret))

  // Password alone no longer gives a session.
  res = await post('login', { email, password })
  const challenge = (await json<{ needs2fa: boolean; challenge: string }>(res))
  assert.equal(challenge.needs2fa, true)
  assert.equal(res.headers.get('set-cookie'), null)

  // The code used to enable is already spent; the next step's is fine.
  assert.equal((await post('login/2fa', { challenge: challenge.challenge, code: hotp(setup.secret, step) })).status, 401)
  step += 1
  res = await post('login/2fa', { challenge: challenge.challenge, code: hotp(setup.secret, step) })
  assert.equal(res.status, 200)
  const session = cookieOf(res)
  assert.equal((await fetch(`${base}/api/analyze/history`, { headers: { cookie: session } })).status, 200)
  // The challenge is single use.
  assert.equal((await post('login/2fa', { challenge: challenge.challenge, code: hotp(setup.secret, step + 1) })).status, 401)

  // A recovery code logs in once.
  const c2 = (await json<{ challenge: string }>(await post('login', { email, password }))).challenge
  assert.equal((await post('login/2fa', { challenge: c2, code: recoveryCodes[0] })).status, 200)
  const c3 = (await json<{ challenge: string }>(await post('login', { email, password }))).challenge
  assert.equal((await post('login/2fa', { challenge: c3, code: recoveryCodes[0] })).status, 401, 'recovery code spent')

  // Disabling needs the password and a code.
  assert.equal((await post('2fa/disable', { password: 'wrong-password', code: recoveryCodes[1] }, session)).status, 400)
  assert.equal((await post('2fa/disable', { password, code: recoveryCodes[1] }, session)).status, 200)
  res = await post('login', { email, password })
  assert.equal(res.status, 200)
  assert.equal((await json<{ user?: unknown }>(res)).user !== undefined, true)
})

test('five wrong codes end the challenge', async () => {
  const { findByEmail } = await import('../../server/auth/users.ts')
  const cookie = cookieOf(await post('login', { email, password }))
  const setup = await json<{ secret: string }>(await post('2fa/setup', {}, cookie))
  await post('2fa/enable', { code: hotp(setup.secret, currentStep()) }, cookie)
  assert.ok((await findByEmail(email))?.totpSecret)
  const { challenge } = await json<{ challenge: string }>(await post('login', { email, password }))
  // 401 for a wrong code; the shared failure limit may answer 429 first. Neither is a login.
  for (let i = 0; i < 5; i++) assert.notEqual((await post('login/2fa', { challenge, code: '000000' })).status, 200)
  assert.notEqual((await post('login/2fa', { challenge, code: hotp(setup.secret, currentStep() + 1) })).status, 200, 'challenge is gone')
})
