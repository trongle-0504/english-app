// Migrates legacy single-user personal data (progress/*, content/review/*.json|*.md, content/grammar/history.json)
// into data/users/<uid>/ for the specified account email.
// Usage: node scripts/migrate-to-user.ts <email>
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { findByEmail } from '../server/auth/users.ts'
import { userRootDir } from '../server/paths.ts'

const rootDir = path.resolve(import.meta.dirname, '..')
const email = process.argv[2]?.trim()

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  )
}

async function main() {
  if (!email) {
    throw new Error('Usage: node scripts/migrate-to-user.ts <email>')
  }
  const user = await findByEmail(email)
  if (!user) {
    throw new Error(`No account found for "${email}". Create it first with: node scripts/user.ts create ${email} --admin`)
  }

  const targetDir = userRootDir(user.id)
  const backupDir = path.join(rootDir, 'data', 'backups', 'pre-multi-user')
  await mkdir(targetDir, { recursive: true })
  await mkdir(backupDir, { recursive: true })

  console.log(`Migrating personal data to user ${user.email} (${user.id}) -> ${targetDir}`)

  // 1. Migrate progress/* -> data/users/<uid>/progress/*
  const legacyProgress = path.join(rootDir, 'progress')
  if (await exists(legacyProgress)) {
    const destProgress = path.join(targetDir, 'progress')
    await mkdir(destProgress, { recursive: true })
    await cp(legacyProgress, destProgress, { recursive: true, force: true })
    console.log(`  - Copied progress/* -> ${destProgress}`)
  }

  // 2. Migrate content/review/*.json|*.md (excluding _example.*) -> data/users/<uid>/review/*
  const legacyReview = path.join(rootDir, 'content', 'review')
  if (await exists(legacyReview)) {
    const destReview = path.join(targetDir, 'review')
    const backupReview = path.join(backupDir, 'content-review')
    await mkdir(destReview, { recursive: true })
    await mkdir(backupReview, { recursive: true })
    const entries = await readdir(legacyReview)
    let movedCount = 0
    for (const file of entries) {
      if (file.startsWith('_') || (!file.endsWith('.json') && !file.endsWith('.md'))) continue
      const srcFile = path.join(legacyReview, file)
      await cp(srcFile, path.join(backupReview, file), { force: true })
      await cp(srcFile, path.join(destReview, file), { force: true })
      await rm(srcFile, { force: true })
      movedCount++
    }
    console.log(`  - Moved ${movedCount} custom review deck file(s) -> ${destReview} (backup in ${backupReview})`)
  }

  // 3. Migrate content/grammar/history.json -> data/users/<uid>/grammar-history.json + cache/analyze/<sha1>.md
  const legacyGrammarHistory = path.join(rootDir, 'content', 'grammar', 'history.json')
  if (await exists(legacyGrammarHistory)) {
    const rawText = await readFile(legacyGrammarHistory, 'utf8')
    const destHistory = path.join(targetDir, 'grammar-history.json')
    await writeFile(destHistory, rawText, 'utf8')
    const cacheDir = path.join(rootDir, 'cache', 'analyze')
    await mkdir(cacheDir, { recursive: true })
    try {
      const parsed = JSON.parse(rawText) as Record<string, string>
      let cachedCount = 0
      for (const [key, markdown] of Object.entries(parsed)) {
        if (typeof markdown !== 'string' || !markdown.trim()) continue
        const normalizedKey = key.trim().replace(/\s+/g, ' ')
        const sha = createHash('sha1').update(normalizedKey).digest('hex')
        await writeFile(path.join(cacheDir, `${sha}.md`), markdown, 'utf8')
        cachedCount++
      }
      console.log(`  - Copied grammar history (${cachedCount} analyses) -> ${destHistory} and cache/analyze/`)
    } catch {
      console.log(`  - Copied grammar history -> ${destHistory}`)
    }
  }

  console.log('Migration complete.')
}

main().catch((error) => {
  console.error((error as Error).message)
  process.exitCode = 1
})
