// Every `agy` the server starts (Nova's `agy acp`, the warm `agy acp` pool, one-shot `agy -p`) runs inside a bubblewrap
// sandbox. agy's own read_file / write_file tools act without asking the ACP client (measured 2026-11-13: a file
// outside the workspace was read and written), so the boundary is the file system the process can see:
// - read-only: /usr (+ the /bin /lib /lib64 /sbin links), /etc, the agy binary, the call's working folder;
// - read-write: a private /tmp (memory only) and the profile's own ~/.gemini under ~/.local/state/english-app/agy/;
// - not there at all: the project (code, .env, data, progress), the real ~/.gemini (its TURBO settings and grants),
//   the rest of $HOME, /mnt (Windows drives), /var, /run.
// The environment is cleared (no ADMIN_TOKEN, AUTH_ENC_KEY, API keys); the network stays (agy calls Google and the
// coach's MCP server on 127.0.0.1). Without bwrap nothing runs: there is no unsandboxed fallback.
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** One sandbox home per use: the coach keeps its chats apart from the one-shot calls. */
export type AgyProfile = 'coach' | 'llm'

/** The login files agy needs, relative to ~/.gemini (copied in; nothing else of the real ~/.gemini is visible). */
export const LOGIN_FILES = ['antigravity-cli/antigravity-oauth-token', 'antigravity-cli/installation_id', 'jetski-standalone-oauth-token']

export interface SandboxOptions {
  profile: AgyProfile
  /** The working folder agy is started in (bound read-only at the same path). */
  cwd: string
  /** Extra folders agy may read (images staged for `agy -p`), bound read-only at the same path. */
  readOnly?: string[]
  /** For tests: the user's home, the state folder and the agy binary. */
  home?: string
  stateDir?: string
  agyBin?: string
}

export const agyBinary = () =>
  process.env.ANTIGRAVITY_BIN || [path.join(os.homedir(), '.local', 'bin', 'agy')].find((p) => existsSync(p)) || 'agy'

export const stateRoot = (home = os.homedir()) => path.join(home, '.local', 'state', 'english-app', 'agy')

function which(cmd: string): string | null {
  if (cmd.includes('/')) return existsSync(cmd) ? cmd : null
  for (const dir of (process.env.PATH ?? '/usr/bin:/bin').split(path.delimiter)) {
    const p = path.join(dir, cmd)
    if (existsSync(p)) return p
  }
  return null
}

let bwrapChecked: string | null = null

/** The bwrap binary; throws when it is missing (no AI call runs without the sandbox). */
export function bwrapPath(): string {
  if (bwrapChecked) return bwrapChecked
  const found = which('bwrap')
  if (!found) throw new Error('bubblewrap (bwrap) is not installed: AI calls are blocked until it is (sudo apt install bubblewrap).')
  bwrapChecked = found
  return found
}

/**
 * The profile's ~/.gemini: created on first use; the login files are copied from the real ~/.gemini when missing or
 * older there (a token the sandboxed agy refreshed itself is newer and kept). Returns its path.
 */
export function prepareProfile(profile: AgyProfile, home = os.homedir(), stateDir = stateRoot(home)): string {
  const gemini = path.join(stateDir, profile, '.gemini')
  mkdirSync(path.join(gemini, 'antigravity-cli'), { recursive: true, mode: 0o700 })
  chmodSync(path.join(stateDir, profile), 0o700)
  for (const rel of LOGIN_FILES) {
    const from = path.join(home, '.gemini', rel)
    const to = path.join(gemini, rel)
    if (!existsSync(from)) continue
    if (existsSync(to) && statSync(to).mtimeMs >= statSync(from).mtimeMs) continue
    copyFileSync(from, to)
    chmodSync(to, 0o600)
  }
  return gemini
}

/** Root entries that are links into /usr on merged-/usr systems (bin → usr/bin…); else they are bound read-only. */
function systemDirs(): string[] {
  const args: string[] = ['--ro-bind', '/usr', '/usr']
  for (const name of ['bin', 'lib', 'lib64', 'lib32', 'sbin']) {
    const p = `/${name}`
    if (!existsSync(p)) continue
    const st = lstatSync(p)
    if (st.isSymbolicLink()) args.push('--symlink', path.relative('/', realpathSync(p)), p)
    else args.push('--ro-bind', p, p)
  }
  return args
}

/** /etc/resolv.conf may point outside /etc (WSL: /mnt/wsl/resolv.conf): that one file is bound too. */
function resolvConf(): string[] {
  try {
    const real = realpathSync('/etc/resolv.conf')
    return real.startsWith('/etc/') ? [] : ['--ro-bind', real, real]
  } catch {
    return []
  }
}

/**
 * The bwrap arguments that run `agyArgs` sandboxed (pure apart from reading the system layout). Exported for the tests,
 * which check that no project, $HOME or /mnt path is ever bound.
 */
export function sandboxArgs(agyArgs: string[], opts: SandboxOptions & { gemini: string }): string[] {
  const home = opts.home ?? os.homedir()
  const bin = realpathSync(opts.agyBin ?? agyBinary())
  const binds = [opts.cwd, ...(opts.readOnly ?? [])].flatMap((dir) => ['--ro-bind', dir, dir])
  return [
    ...systemDirs(),
    '--ro-bind', '/etc', '/etc',
    ...resolvConf(),
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--dir', home,
    '--bind', opts.gemini, path.join(home, '.gemini'),
    '--ro-bind', bin, bin,
    ...binds,
    '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup-try',
    '--die-with-parent', '--new-session',
    '--clearenv',
    '--setenv', 'HOME', home,
    '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin',
    '--setenv', 'LANG', 'C.UTF-8',
    '--setenv', 'TMPDIR', '/tmp',
    '--chdir', opts.cwd,
    bin,
    ...agyArgs,
  ]
}

/** The command and arguments to spawn for a sandboxed agy. Creates the working folder and the profile home. */
export function sandboxedAgy(agyArgs: string[], opts: SandboxOptions): { command: string; args: string[] } {
  const command = bwrapPath()
  mkdirSync(opts.cwd, { recursive: true })
  const gemini = prepareProfile(opts.profile, opts.home, opts.stateDir)
  return { command, args: sandboxArgs(agyArgs, { ...opts, gemini }) }
}
