// The app's data (content, media, progress: see data-manifest.json) travels apart from the code, as one archive.
//   node scripts/data.ts pack [--minimal] [--out <dir>]              → <dir>/english-app-data[-minimal]-<date>.tar.gz (+ .index.json)
//   node scripts/data.ts restore <archive.tar.gz | folder> [--force] [--with-models]
// A folder is the unpacked form scripts/sync-commit.ts writes to the repository (data-minimal/). restore checks every file against the checksums packed with it and puts it at its place in this project. Files that
// already exist with other content stop it, unless --force, which first copies them to data/backup-<time>/.
// --minimal leaves out what data-manifest.json lists under minimalSkips (vocabulary and note pictures, blog originals,
// recordings, PDFs, files built from others): a small archive. Restoring it builds the topic collocations index and
// downloads the pronunciation list again; node scripts/fetch-images.ts downloads the pictures.
// --with-models also downloads the speech-recognition model (Speaking Review, ~130 MB) into models/.
// Runs in WSL/Linux (uses tar).
import { spawnSync } from 'node:child_process'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { buildTopicIndex, topicIndexDir } from './build-topic-index.ts'
import { DATA_INDEX, kindOf, listFiles, projectRoot, sha256, skippedInMinimal, type DataIndex } from './lib/data-paths.ts'

const MODEL = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8'
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL}.tar.bz2`

function tar(args: string[]): void {
  const result = spawnSync('tar', args, { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`tar ${args[0]} failed (${result.error?.message ?? `exit ${result.status}`}).`)
}

const stamp = () => new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** The data files a pack or export holds (relative to the project). */
export function dataFiles(minimal: boolean): string[] {
  const files = listFiles(projectRoot, 'data').filter((rel) => !minimal || !skippedInMinimal(rel))
  if (!files.length) throw new Error('No data files found: nothing to pack.')
  return files
}

async function indexFiles(files: string[], minimal: boolean): Promise<DataIndex> {
  const index: DataIndex = { createdAt: new Date().toISOString(), minimal, totalBytes: 0, files: [] }
  for (const rel of files) {
    const abs = path.join(projectRoot, rel)
    const bytes = statSync(abs).size
    index.totalBytes += bytes
    index.files.push({ path: rel, bytes, sha256: await sha256(abs) })
  }
  return index
}

/** Every file under `dir` (relative, forward slashes). */
function filesUnder(dir: string, base = ''): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name
    return e.isDirectory() ? filesUnder(path.join(dir, e.name), rel) : [rel]
  })
}

/**
 * Copies the data files unpacked into `dir`, with DATA_INDEX beside them, and deletes there what is no longer data: a
 * folder to commit in place of an archive (restore reads it the same way). The index keeps its date while no file
 * changes, so an unchanged export shows no diff.
 */
export async function exportTo(dir: string, { minimal = false } = {}): Promise<void> {
  const files = dataFiles(minimal)
  const index = await indexFiles(files, minimal)
  mkdirSync(dir, { recursive: true })
  let written = 0
  for (const f of index.files) {
    const to = path.join(dir, f.path)
    if (existsSync(to) && (await sha256(to)) === f.sha256) continue
    mkdirSync(path.dirname(to), { recursive: true })
    copyFileSync(path.join(projectRoot, f.path), to)
    written++
  }
  const keep = new Set([DATA_INDEX, ...files])
  const stale = filesUnder(dir).filter((rel) => !keep.has(rel))
  for (const rel of stale) rmSync(path.join(dir, rel))
  const indexFile = path.join(dir, DATA_INDEX)
  const old = existsSync(indexFile) ? (JSON.parse(readFileSync(indexFile, 'utf8')) as DataIndex) : null
  if (!old || old.minimal !== minimal || JSON.stringify(old.files) !== JSON.stringify(index.files)) {
    writeFileSync(indexFile, JSON.stringify(index, null, 2))
  }
  console.log(`Data → ${dir}: ${written} written, ${stale.length} removed, ${files.length} files (${mb(index.totalBytes)}).`)
}

/** Packs every data file of this project; returns the archive path. */
export async function pack(outDir: string, { minimal = false } = {}): Promise<string> {
  const files = dataFiles(minimal)
  const index = await indexFiles(files, minimal)

  mkdirSync(outDir, { recursive: true })
  const name = `english-app-data${minimal ? '-minimal' : ''}-${stamp()}`
  const archive = path.join(outDir, `${name}.tar.gz`)
  const work = mkdtempSync(path.join(os.tmpdir(), 'lt-pack-'))
  try {
    writeFileSync(path.join(work, DATA_INDEX), JSON.stringify(index, null, 2))
    writeFileSync(path.join(work, 'files.txt'), files.join('\n') + '\n')
    // The index first (from the work folder), then the data files (from the project), listed in files.txt.
    tar(['-czf', archive, '-C', work, DATA_INDEX, '-C', projectRoot, '--verbatim-files-from', '-T', path.join(work, 'files.txt')])
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  writeFileSync(path.join(outDir, `${name}.index.json`), JSON.stringify(index, null, 2))
  console.log(`Packed ${files.length} data files (${mb(index.totalBytes)}) → ${archive} (${mb(statSync(archive).size)})`)
  return archive
}

/** A path from an archive index that may be written: relative, inside the project, and data by the manifest. */
function safeDataPath(rel: string): boolean {
  const normal = path.posix.normalize(rel)
  return normal === rel && !rel.startsWith('/') && !rel.startsWith('../') && !rel.includes('/../') && kindOf(rel) === 'data'
}

/** Restores an archive made by pack, or a folder made by exportTo (such as data-minimal/ in the repository). */
async function restore(archive: string, force: boolean): Promise<void> {
  if (!existsSync(archive)) throw new Error(`No such file: ${archive}`)
  const fromFolder = statSync(archive).isDirectory()
  const work = fromFolder ? archive : mkdtempSync(path.join(os.tmpdir(), 'lt-restore-'))
  try {
    if (!fromFolder) {
      console.log(`Unpacking ${archive}…`)
      tar(['-xzf', archive, '-C', work])
    }
    const indexFile = path.join(work, DATA_INDEX)
    if (!existsSync(indexFile)) throw new Error(`${DATA_INDEX} missing: not an archive or folder made by scripts/data.ts.`)
    const index = JSON.parse(readFileSync(indexFile, 'utf8')) as DataIndex

    // Everything is checked before anything is written: a damaged download changes nothing.
    const unsafe = index.files.filter((f) => !safeDataPath(f.path))
    if (unsafe.length) throw new Error(`Refused, paths outside the data folders: ${unsafe.slice(0, 5).map((f) => f.path).join(', ')}`)
    const damaged: string[] = []
    for (const f of index.files) {
      const file = path.join(work, f.path)
      if (!existsSync(file) || (await sha256(file)) !== f.sha256) damaged.push(f.path)
    }
    if (damaged.length) throw new Error(`${damaged.length} file(s) damaged or missing in the archive, e.g. ${damaged.slice(0, 3).join(', ')}. Download it again.`)

    const conflicts: string[] = []
    let same = 0
    for (const f of index.files) {
      const target = path.join(projectRoot, f.path)
      if (!existsSync(target)) continue
      if ((await sha256(target)) === f.sha256) same++
      else conflicts.push(f.path)
    }
    if (conflicts.length && !force) {
      console.error(`${conflicts.length} file(s) here differ from the archive, e.g.:`)
      for (const p of conflicts.slice(0, 10)) console.error(`  ${p}`)
      throw new Error('Nothing was written. Run again with --force to replace them (the current ones are backed up to data/backup-<time>/).')
    }

    const replace = new Set(conflicts)
    const backup = path.join(projectRoot, 'data', `backup-${stamp()}`)
    for (const p of conflicts) {
      mkdirSync(path.dirname(path.join(backup, p)), { recursive: true })
      copyFileSync(path.join(projectRoot, p), path.join(backup, p))
    }
    let written = 0
    for (const f of index.files) {
      const target = path.join(projectRoot, f.path)
      if (existsSync(target) && !replace.has(f.path)) continue
      mkdirSync(path.dirname(target), { recursive: true })
      copyFileSync(path.join(work, f.path), target)
      written++
    }
    console.log(`Restored ${written} file(s), ${same} already up to date (${index.files.length} in the archive of ${index.createdAt.slice(0, 10)}).`)
    if (conflicts.length) console.log(`${conflicts.length} replaced file(s) backed up to ${path.relative(projectRoot, backup)}/`)
    if (index.minimal) {
      rebuildDerived()
      console.log('Minimal archive: vocabulary and note pictures and the PDFs are not in it. Download the pictures with: node scripts/fetch-images.ts')
    }
  } finally {
    if (!fromFolder) rmSync(work, { recursive: true, force: true })
  }
}

/** Builds again what the minimal archive leaves out because other files (or a public download) make it. */
function rebuildDerived(): void {
  if (!existsSync(path.join(topicIndexDir(projectRoot), 'index.json'))) {
    console.log(`Built the topic collocations index (${buildTopicIndex(projectRoot)} items).`)
  }
  if (!existsSync(path.join(projectRoot, 'public', 'pronunciation', 'en-gb.tsv'))) {
    console.log('Downloading the pronunciation list…')
    const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'build-pronunciation.ts')], { stdio: 'inherit' })
    if (result.status !== 0) console.error('Pronunciation list failed (offline?). Run later: node scripts/build-pronunciation.ts')
  }
}

async function downloadModel(): Promise<void> {
  const modelsDir = path.join(projectRoot, 'models')
  if (existsSync(path.join(modelsDir, MODEL))) return console.log(`Model already in models/${MODEL}`)
  mkdirSync(modelsDir, { recursive: true })
  const file = path.join(os.tmpdir(), `${MODEL}.tar.bz2`)
  console.log(`Downloading the speech model (~130 MB) from ${MODEL_URL}…`)
  const res = await fetch(MODEL_URL)
  if (!res.ok || !res.body) throw new Error(`Model download failed: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file))
  try {
    tar(['-xjf', file, '-C', modelsDir])
  } finally {
    rmSync(file, { force: true })
  }
  console.log(`Model ready in models/${MODEL}`)
}

// Run as a command (sync-commit.ts imports pack() without running this).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2)
  const flag = (name: string) => rest.includes(name)
  const option = (name: string) => {
    const i = rest.indexOf(name)
    return i >= 0 ? rest[i + 1] : undefined
  }
  try {
    if (command === 'pack') {
      const minimal = flag('--minimal')
      await pack(path.resolve(option('--out') ?? path.join(projectRoot, '..', 'english-app-commit', minimal ? 'data-minimal' : 'data')), { minimal })
    } else if (command === 'restore') {
      const archive = rest.find((a) => !a.startsWith('--'))
      if (!archive) throw new Error('Usage: node scripts/data.ts restore <archive.tar.gz | folder> [--force] [--with-models]')
      await restore(path.resolve(archive), flag('--force'))
      if (flag('--with-models')) await downloadModel()
    } else {
      console.log('Usage:\n  node scripts/data.ts pack [--minimal] [--out <dir>]\n  node scripts/data.ts restore <archive.tar.gz | folder> [--force] [--with-models]')
      process.exitCode = 1
    }
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}
