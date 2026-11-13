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
export async function writeJsonFile(file: string, value: unknown, mode?: number): Promise<void> {
  await writeTextFile(file, `${JSON.stringify(value, null, 2)}\n`, mode)
}

/** `mode` (e.g. 0o600) sets the file's permissions: the temp file is created with them, so the rename keeps them. */
export async function writeTextFile(file: string, text: string | Buffer, mode?: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, text, mode === undefined ? undefined : { mode })
  await rename(tmp, file)
}
