// agy in the multi-user app (PLAN-multi-user-v2.md, 4.2): agy keeps conversations in its profile's ~/.gemini and its
// read_file tool can read them, so no two accounts (and no two one-shot calls) may share a profile.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { prepareProfile, sandboxArgs } from '../../server/llm/agy-sandbox.ts'

const home = mkdtempSync(path.join(os.tmpdir(), 'agy-home-'))
mkdirSync(path.join(home, '.gemini', 'antigravity-cli'), { recursive: true })
writeFileSync(path.join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'), 'token')

test('each account has its own coach profile; names are checked', () => {
  const a = prepareProfile('coach-11111111-aaaa', home)
  const b = prepareProfile('coach-22222222-bbbb', home)
  assert.notEqual(a, b)
  assert.ok(existsSync(path.join(a, 'antigravity-cli', 'antigravity-oauth-token')))
  assert.throws(() => prepareProfile('coach-../../x' as `coach-${string}`, home))
})

test('a profile bound into the sandbox is only that profile', () => {
  const gemini = prepareProfile('coach-11111111-aaaa', home)
  const args = sandboxArgs(['acp'], { profile: 'coach-11111111-aaaa', cwd: os.tmpdir(), gemini, home, agyBin: process.execPath })
  const binds = args.flatMap((a, i) => (a === '--bind' ? [args[i + 1]] : []))
  assert.deepEqual(binds, [gemini])
  assert.ok(!args.some((a) => a.includes('coach-22222222')))
})

test('one-shot calls: a throwaway profile, removed after the call', async () => {
  const { sandboxedAgy } = await import('../../server/llm/agy-sandbox.ts')
  const saved = process.env.PATH
  // bwrap must exist for sandboxedAgy; skip when it does not.
  if (!existsSync('/usr/bin/bwrap')) return
  const run = sandboxedAgy(['-p', 'x'], { profile: 'llm', cwd: path.join(home, 'cwd'), ephemeral: true, home, agyBin: process.execPath })
  const bound = run.args[run.args.indexOf('--bind') + 1]
  assert.match(bound, /once-/)
  assert.ok(existsSync(bound))
  run.cleanup()
  assert.ok(!existsSync(bound))
  process.env.PATH = saved
  rmSync(home, { recursive: true, force: true })
})

test('Nova: one coach per account, each on its own folder; no account → refused', async () => {
  process.env.MULTI_USER = '1'
  const { getCoach, stopCoach } = await import('../../server/coach/service.ts')
  const a = getCoach({ rootDir: '/tmp/users/a', contentDir: '/tmp/users/a/content', user: { id: 'aaaaaaaa-1' } })
  const b = getCoach({ rootDir: '/tmp/users/b', contentDir: '/tmp/users/b/content', user: { id: 'bbbbbbbb-2' } })
  assert.notEqual(a, b)
  assert.equal(getCoach({ rootDir: '/tmp/users/a', contentDir: '', user: { id: 'aaaaaaaa-1' } }), a)
  assert.equal(a.toolContext().rootDir, '/tmp/users/a')
  assert.equal(b.toolContext().rootDir, '/tmp/users/b')
  assert.throws(() => getCoach({ rootDir: '/tmp', contentDir: '' }))
  await stopCoach()
  delete process.env.MULTI_USER
})
