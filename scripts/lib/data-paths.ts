// Which files are code, which are data, read from data-manifest.json. Shared by scripts/sync-commit.ts (copies the code
// to the commit folder, packs the data) and scripts/data.ts (packs and restores the data).
import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const projectRoot = path.resolve(import.meta.dirname, '..', '..')

interface Manifest {
  data: string[]
  codeInsideData: string[]
  minimalSkips: { paths: string[]; extensions: string[] }
  neither: string[]
}

export const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'data-manifest.json'), 'utf8')) as Manifest

/** `rel` is `entry` or lies under it (paths use forward slashes). */
const covers = (entry: string, rel: string) => rel === entry || rel.startsWith(`${entry}/`)

export type Kind = 'code' | 'data' | 'neither'

export function kindOf(rel: string): Kind {
  if (manifest.neither.some((e) => covers(e, rel))) return 'neither'
  if (manifest.codeInsideData.some((e) => covers(e, rel))) return 'code'
  if (manifest.data.some((e) => covers(e, rel))) return 'data'
  return 'code'
}

/** Data the minimal pack leaves out: pictures fetched again from their source, blog originals, recordings, PDFs, files restore builds again. */
export function skippedInMinimal(rel: string): boolean {
  const { paths, extensions } = manifest.minimalSkips
  return paths.some((e) => covers(e, rel)) || extensions.some((ext) => rel.toLowerCase().endsWith(ext))
}

/** Every file under `root` (relative, forward slashes), skipping whole folders that are 'neither'. */
export function listFiles(root: string, kind: Kind): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (kindOf(rel) !== 'neither') walk(rel)
      } else if (entry.isFile() && kindOf(rel) === kind) out.push(rel)
    }
  }
  walk('')
  return out.sort()
}

export function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}

/** Name and checksum of every file in a data archive; stored inside it as DATA_INDEX and next to it. */
export interface DataIndex {
  createdAt: string
  /** Packed with --minimal: restore those pictures with scripts/fetch-images.ts. */
  minimal?: boolean
  totalBytes: number
  files: { path: string; bytes: number; sha256: string }[]
}

export const DATA_INDEX = '.data-index.json'
