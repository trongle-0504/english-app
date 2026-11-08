// Argument readers for the coach tools. agy adds its own keys (toolSummary…), so unknown keys are ignored; known keys
// with a bad value are an error the model can read and fix.
import { isDay, ToolError } from '../data.ts'

export type Args = Record<string, unknown>

export function optEnum<T extends string>(args: Args, key: string, values: readonly T[], fallback: T): T {
  const value = args[key]
  if (value === undefined || value === null || value === '') return fallback
  if (!values.includes(value as T)) throw new ToolError(`${key} must be one of: ${values.join(', ')}.`)
  return value as T
}

export function optEnumList<T extends string>(args: Args, key: string, values: readonly T[]): T[] {
  const value = args[key]
  if (value === undefined || value === null) return []
  const list = Array.isArray(value) ? value : [value]
  for (const v of list) if (!values.includes(v as T)) throw new ToolError(`${key}: "${String(v)}" is not one of: ${values.join(', ')}.`)
  return list as T[]
}

export function optDay(args: Args, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null || value === '') return undefined
  if (!isDay(value)) throw new ToolError(`${key} must be a date YYYY-MM-DD.`)
  return value
}

export function optInt(args: Args, key: string, min: number, max: number, fallback: number): number {
  const value = args[key]
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) throw new ToolError(`${key} must be a number.`)
  return Math.max(min, Math.min(max, Math.round(n)))
}

export function reqString(args: Args, key: string, max: number): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new ToolError(`${key} is required.`)
  return value.trim().slice(0, max)
}
