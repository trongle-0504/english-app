// Request validation helpers. Every failure is a 400 with a message the admin UI shows verbatim.
import { ApiError, type ApiRequest } from '../api.ts'

export type JsonObject = Record<string, unknown>

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function jsonBody(req: ApiRequest): JsonObject {
  if (!isObject(req.body)) throw new ApiError(400, 'Expected a JSON object body (Content-Type: application/json).')
  return req.body
}

interface TextOptions {
  max?: number
  /** Collapse runs of whitespace (names, titles). */
  collapse?: boolean
}

function cleanText(value: unknown, name: string, { max = 20_000, collapse = false }: TextOptions): string {
  if (value == null) return ''
  if (typeof value !== 'string') throw new ApiError(400, `"${name}" must be a string.`)
  const text = collapse ? value.replace(/\s+/g, ' ').trim() : value.trim()
  if (text.length > max) throw new ApiError(400, `"${name}" is too long (max ${max} characters).`)
  return text
}

export function optionalText(source: JsonObject, name: string, options: TextOptions = {}): string {
  return cleanText(source[name], name, options)
}

export function requiredText(source: JsonObject, name: string, options: TextOptions = {}): string {
  const text = cleanText(source[name], name, options)
  if (!text) throw new ApiError(400, `"${name}" is required.`)
  return text
}

/**
 * A topic / sub-topic / title that may end up in a file or folder name: single line, no path
 * separators, not starting with a dot.
 */
export function requiredName(source: JsonObject, name: string, max = 120): string {
  const text = requiredText(source, name, { max, collapse: true })
  if (/[/\\]/.test(text) || text.startsWith('.') || /\p{Cc}/u.test(text)) {
    throw new ApiError(400, `"${name}" must not contain slashes or start with a dot.`)
  }
  return text
}

export function optionalName(source: JsonObject, name: string, max = 120): string {
  return source[name] == null || source[name] === '' ? '' : requiredName(source, name, max)
}

export function queryParam(req: ApiRequest, name: string): string {
  const value = req.query.get(name)?.trim()
  if (!value) throw new ApiError(400, `Query parameter "${name}" is required.`)
  return value
}

export function requiredObject(source: JsonObject, name: string): JsonObject {
  const value = source[name]
  if (!isObject(value)) throw new ApiError(400, `"${name}" must be a JSON object.`)
  return value
}

/** Array of non-empty trimmed strings; anything else in the array is an error. */
export function stringList(value: unknown, name: string): string[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new ApiError(400, `"${name}" must be an array of strings.`)
  return value.map((item, i) => {
    if (typeof item !== 'string') throw new ApiError(400, `"${name}[${i}]" must be a string.`)
    return item.trim()
  }).filter(Boolean)
}

/** Case- and whitespace-insensitive name comparison used for topics, words and titles. */
export function sameName(a: string, b: string): boolean {
  return a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase()
}
