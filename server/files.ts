import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ApiError } from './api.ts'

/** Resolve a path inside content/, refusing anything that escapes it. */
export function contentFile(contentDir: string, ...parts: string[]): string {
  const file = path.resolve(contentDir, ...parts)
  if (!file.startsWith(path.resolve(contentDir) + path.sep)) throw new ApiError(400, 'Invalid path.')
  return file
}

export async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
}

/** Atomic write (temp file + rename) so a crash never leaves half-written JSON. */
export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await writeTextFile(file, `${JSON.stringify(value, null, 2)}\n`)
}

export async function writeTextFile(file: string, text: string | Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, text)
  await rename(tmp, file)
}
