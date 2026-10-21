// Prepares a commit, from this working folder (run in WSL, in the project folder):
//   node scripts/sync-commit.ts [--out <dir>] [--no-data] [--full-data]
// 1. Copies the code (everything data-manifest.json does not call data or leave out) to <out>/code — a git repository,
//    created on the first run — and deletes there what was deleted here. Nothing is committed or pushed.
// 2. Packs the data, to upload apart (scripts/data.ts): the minimal archive in <out>/data-minimal/ — no vocabulary or
//    note pictures (node scripts/fetch-images.ts downloads them again), no blog originals, no recordings, no PDFs, none
//    of the files restore builds again. --full-data
//    also packs everything into <out>/data/.
// <out> defaults to ../english-app-commit. Before copying, the code is checked for what must never reach GitHub
// (.env files, keys, big files); any hit stops everything.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { pack } from './data.ts'
import { listFiles, projectRoot } from './lib/data-paths.ts'

const MAX_BYTES = 5 * 1024 * 1024
const BINARY = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|mp3|wav|pdf|zip|gz)$/i
const SECRETS: [string, RegExp][] = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['OpenAI / Anthropic key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{24,}/],
  ['GitHub token', /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
]

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const out = path.resolve(outIndex >= 0 ? args[outIndex + 1] : path.join(projectRoot, '..', 'english-app-commit'))
const codeDir = path.join(out, 'code')

/** What would leak or bloat the repository: reported all at once, then nothing is copied. */
function check(files: string[]): string[] {
  const problems: string[] = []
  for (const rel of files) {
    const abs = path.join(projectRoot, rel)
    const name = path.basename(rel)
    if (/^\.env(\.|$)/.test(name) && name !== '.env.example') problems.push(`${rel}: environment file`)
    const bytes = statSync(abs).size
    if (bytes > MAX_BYTES) problems.push(`${rel}: ${(bytes / 1024 / 1024).toFixed(1)} MB (data? add it to data-manifest.json)`)
    if (BINARY.test(rel)) continue
    const text = readFileSync(abs, 'utf8')
    for (const [label, pattern] of SECRETS) if (pattern.test(text)) problems.push(`${rel}: looks like a ${label}`)
  }
  return problems
}

/** Files under the commit copy, skipping its .git. */
function existingCopy(dir: string, base = ''): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name
    if (rel === '.git') return []
    return e.isDirectory() ? existingCopy(path.join(dir, e.name), rel) : [rel]
  })
}

function removeEmptyDirs(dir: string): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === '.git') continue
    const sub = path.join(dir, e.name)
    removeEmptyDirs(sub)
    if (!readdirSync(sub).length) rmdirSync(sub)
  }
}

function sameFile(a: string, b: string): boolean {
  if (!existsSync(b) || statSync(a).size !== statSync(b).size) return false
  return readFileSync(a).equals(readFileSync(b))
}

try {
  // Temporary files that come and go while the dev server runs (Vite's bundled config, atomic-write temps).
  const files = listFiles(projectRoot, 'code').filter((rel) => !/\.timestamp-[^/]*\.mjs$|\.tmp$/.test(rel))
  const problems = check(files)
  if (problems.length) {
    console.error('Stopped, nothing copied. Fix these first:')
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }

  mkdirSync(codeDir, { recursive: true })
  let added = 0
  let updated = 0
  let unchanged = 0
  for (const rel of files) {
    const from = path.join(projectRoot, rel)
    const to = path.join(codeDir, rel)
    if (sameFile(from, to)) {
      unchanged++
      continue
    }
    if (existsSync(to)) updated++
    else added++
    mkdirSync(path.dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
  const keep = new Set(files)
  const removed = existingCopy(codeDir).filter((rel) => !keep.has(rel))
  for (const rel of removed) unlinkSync(path.join(codeDir, rel))
  removeEmptyDirs(codeDir)
  console.log(`Code → ${codeDir}: ${added} added, ${updated} updated, ${removed.length} removed, ${unchanged} unchanged (${files.length} files).`)

  if (!existsSync(path.join(codeDir, '.git'))) {
    const git = spawnSync('git', ['init', '-b', 'main'], { cwd: codeDir, stdio: 'inherit' })
    if (git.status !== 0) console.error('git init failed: create the repository by hand.')
  }

  if (!args.includes('--no-data')) {
    await pack(path.join(out, 'data-minimal'), { minimal: true })
    if (args.includes('--full-data')) await pack(path.join(out, 'data'))
  }

  console.log(`\nNext: cd ${codeDir} && git status, then git add -A && git commit … && git push.`)
  if (!args.includes('--no-data')) console.log(`Upload the newest archive in ${path.join(out, 'data-minimal')} wherever you keep the data (not to GitHub).`)
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
}
