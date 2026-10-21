import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Loose key used to match the same phrase written slightly differently ("hold/keep their attention"). */
export function looseKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch (error) {
    warn(`Invalid JSON in ${file}: ${(error as Error).message}`)
    return fallback
  }
}

export function listFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith(ext))
    .sort((a, b) => a.localeCompare(b))
}

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

export function asStringArray(value: unknown): string[] {
  return asArray(value as string | string[])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name)
}

export const warnings: string[] = []

export function warn(message: string): void {
  warnings.push(message)
}

export function contentPath(root: string, ...parts: string[]): string {
  return path.join(root, ...parts)
}

/** Map of `/data/<key>` → JSON-serialisable document. */
export type Output = Map<string, unknown>
