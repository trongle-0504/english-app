// The agy sandbox (server/llm/agy-sandbox.ts): what is bound, the copied login files, and — with the real bwrap, a
// shell standing in for agy — that the project, $HOME and the server's secrets are out of reach.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { LOGIN_FILES, prepareProfile, sandboxArgs, sandboxedAgy } from '../../server/llm/agy-sandbox.ts'

const PROJECT = path.resolve(import.meta.dirname, '..', '..')

function fakeHome() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'agy-sandbox-home-'))
  for (const rel of LOGIN_FILES) {
    mkdirSync(path.dirname(path.join(home, '.gemini', rel)), { recursive: true })
    writeFileSync(path.join(home, '.gemini', rel), `token ${rel}`)
  }
  // Things that must never reach the sandbox.
  mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true })
  writeFileSync(path.join(home, '.gemini', 'config', 'config.json'), '{"permissionPreset":"TURBO"}')
  writeFileSync(path.join(home, '.gemini', 'antigravity-cli', 'settings.json'), '{"trustedWorkspaces":["/"]}')
  return home
}

/** Pairs of bind sources from bwrap arguments. */
function bindSources(args: string[]): string[] {
  const out: string[] = []
  args.forEach((a, i) => {
    if (a === '--bind' || a === '--ro-bind') out.push(args[i + 1])
  })
  return out
}

test('prepareProfile copies only the login files, and keeps a token the sandbox refreshed', () => {
  const home = fakeHome()
  try {
    const gemini = prepareProfile('coach', home)
    assert.equal(gemini, path.join(home, '.local', 'state', 'english-app', 'agy', 'coach', '.gemini'))
    for (const rel of LOGIN_FILES) assert.equal(readFileSync(path.join(gemini, rel), 'utf8'), `token ${rel}`)
    assert.equal(existsSync(path.join(gemini, 'config', 'config.json')), false)
    assert.equal(existsSync(path.join(gemini, 'antigravity-cli', 'settings.json')), false)
    // The sandboxed agy refreshed its token: a later start must not overwrite it with the older original.
    const token = path.join(gemini, LOGIN_FILES[0])
    writeFileSync(token, 'refreshed')
    const future = new Date(Date.now() + 60_000)
    utimesSync(token, future, future)
    prepareProfile('coach', home)
    assert.equal(readFileSync(token, 'utf8'), 'refreshed')
    // A newer original (the owner logged in again) is copied.
    const later = new Date(Date.now() + 120_000)
    utimesSync(path.join(home, '.gemini', LOGIN_FILES[0]), later, later)
    prepareProfile('coach', home)
    assert.equal(readFileSync(token, 'utf8'), `token ${LOGIN_FILES[0]}`)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('sandboxArgs: never binds the project, the real ~/.gemini, $HOME or /mnt; clears the environment', () => {
  const home = fakeHome()
  try {
    const gemini = prepareProfile('llm', home)
    const cwd = path.join(os.tmpdir(), 'english-app-antigravity')
    const args = sandboxArgs(['acp'], { profile: 'llm', cwd, home, gemini, agyBin: '/usr/bin/true' })
    const sources = bindSources(args)
    for (const src of sources) {
      assert.ok(!src.startsWith(PROJECT), `project path bound: ${src}`)
      assert.notEqual(src, home)
      assert.notEqual(src, path.join(home, '.gemini'))
      if (src.startsWith('/mnt/')) assert.match(src, /resolv\.conf$/, `only resolv.conf may come from /mnt: ${src}`)
      if (src.startsWith(home)) assert.equal(src, gemini, `only the profile home may come from $HOME: ${src}`)
    }
    // The working folder is read-only; only the profile home is writable.
    assert.deepEqual(args.filter((_, i) => args[i - 1] === '--bind'), [gemini])
    assert.ok(args.includes('--clearenv'))
    assert.ok(args.includes('--die-with-parent'))
    const set = args.flatMap((a, i) => (a === '--setenv' ? [args[i + 1]] : []))
    assert.deepEqual(set.sort(), ['HOME', 'LANG', 'PATH', 'TMPDIR'])
    assert.deepEqual(args.slice(-2), [realpathSync('/usr/bin/true'), 'acp'])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

const hasBwrap = (() => {
  try {
    execFileSync('bwrap', ['--ro-bind', '/', '/', '--unshare-pid', '/usr/bin/true'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

test('real bwrap: the sandboxed process cannot read or write outside, and sees no server secrets', { skip: !hasBwrap && 'bwrap not usable here' }, () => {
  const home = fakeHome()
  const outside = mkdtempSync(path.join(os.tmpdir(), 'agy-sandbox-outside-'))
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'agy-sandbox-cwd-'))
  try {
    writeFileSync(path.join(outside, 'secret.txt'), 'CANARY')
    const script = [
      `cat ${outside}/secret.txt 2>/dev/null && echo READ-OUTSIDE`,
      `cat ${PROJECT}/package.json >/dev/null 2>&1 && echo READ-PROJECT`,
      `echo x > ${outside}/written.txt 2>/dev/null && echo WROTE-OUTSIDE-NS`,
      `echo x > ${cwd}/written.txt 2>/dev/null && echo WROTE-CWD`,
      `echo x > $HOME/.gemini/ok.txt && echo WROTE-PROFILE`,
      `test -e $HOME/.gemini/config/config.json && echo SAW-REAL-CONFIG`,
      'env | grep -E "ADMIN_TOKEN|AUTH_ENC_KEY|CANARY_ENV" && echo SAW-ENV',
      'echo END',
    ].join('; ')
    process.env.CANARY_ENV = 'leak'
    const run = sandboxedAgy(['-c', script], { profile: 'coach', cwd, home, agyBin: '/usr/bin/sh' })
    const out = execFileSync(run.command, run.args, { encoding: 'utf8', env: { ...process.env, ADMIN_TOKEN: 'secret-admin' } })
    assert.match(out, /WROTE-PROFILE/)
    assert.match(out, /END/)
    for (const bad of ['READ-OUTSIDE', 'READ-PROJECT', 'WROTE-CWD', 'SAW-REAL-CONFIG', 'SAW-ENV', 'CANARY', 'secret-admin']) assert.doesNotMatch(out, new RegExp(bad))
    // /tmp inside is memory only: whatever it wrote "outside" never reached the disk.
    assert.equal(existsSync(path.join(outside, 'written.txt')), false)
    assert.equal(existsSync(path.join(cwd, 'written.txt')), false)
  } finally {
    delete process.env.CANARY_ENV
    for (const dir of [home, outside, cwd]) rmSync(dir, { recursive: true, force: true })
  }
})
