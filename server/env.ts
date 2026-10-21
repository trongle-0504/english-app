import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** Minimal .env loader (KEY=value lines); existing environment variables win. */
export function loadEnv(rootDir: string): void {
  const file = path.join(rootDir, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (!match || process.env[match[1]] !== undefined) continue
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}
