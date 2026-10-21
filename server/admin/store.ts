import { readFile } from 'node:fs/promises'
import { ApiError } from '../api.ts'
import { writeTextFile } from '../files.ts'

let queue: Promise<unknown> = Promise.resolve()

/**
 * Runs content mutations one at a time, so two requests never interleave their read → modify → write
 * cycles on the same file. Slow work (Gemini calls) must happen before entering.
 */
export function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task)
  queue = run.catch(() => {})
  return run
}

/** Line-ending style of a text file, so rewrites keep the author's formatting. */
export interface TextStyle {
  eol: '\n' | '\r\n'
  finalNewline: boolean
}

const DEFAULT_STYLE: TextStyle = { eol: '\n', finalNewline: true }

export function detectStyle(text: string): TextStyle {
  return { eol: text.includes('\r\n') ? '\r\n' : '\n', finalNewline: /\n$/.test(text) }
}

export function applyStyle(text: string, style: TextStyle): string {
  const body = text.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  const withEnding = style.finalNewline ? `${body}\n` : body
  return style.eol === '\r\n' ? withEnding.replace(/\n/g, '\r\n') : withEnding
}

export interface JsonDoc<T> {
  value: T
  style: TextStyle
  exists: boolean
}

/** Reads a JSON content file. Missing → fallback; unparsable → 500 (never overwrite a file we cannot read). */
export async function readJsonDoc<T>(file: string, fallback: T): Promise<JsonDoc<T>> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { value: fallback, style: DEFAULT_STYLE, exists: false }
    throw error
  }
  try {
    return { value: JSON.parse(text) as T, style: detectStyle(text), exists: true }
  } catch (error) {
    throw new ApiError(500, `${file} is not valid JSON (${(error as Error).message}). Fix it by hand before saving.`)
  }
}

/** Atomic write with 2-space indentation, keeping the file's existing line endings. */
export async function writeJsonDoc(file: string, value: unknown, style: TextStyle = DEFAULT_STYLE): Promise<void> {
  await writeTextFile(file, applyStyle(JSON.stringify(value, null, 2), style))
}

/** Reads a JSON file, lets `update` change the value, writes it back — all inside the mutation queue. */
export function updateJsonDoc<T, R>(file: string, fallback: T, update: (value: T) => R | Promise<R>): Promise<R> {
  return exclusive(async () => {
    const doc = await readJsonDoc(file, fallback)
    const result = await update(doc.value)
    await writeJsonDoc(file, doc.value, doc.style)
    return result
  })
}
