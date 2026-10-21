// Converts blog images in content/blog/images/** to compressed WebP in public/blog-images/**.
// Run after adding images: `npm run images`. Already-converted files are skipped.
import { readdir, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const srcDir = path.join(root, 'content/blog/images')
const outDir = path.join(root, 'public/blog-images')
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (IMAGE_EXT.test(entry.name)) yield full
  }
}

let before = 0
let after = 0
for await (const file of walk(srcDir)) {
  const rel = path.relative(srcDir, file).replace(IMAGE_EXT, '.webp')
  const out = path.join(outDir, rel)
  const srcStat = await stat(file)
  const outStat = await stat(out).catch(() => null)
  if (outStat && outStat.mtimeMs >= srcStat.mtimeMs) continue

  await mkdir(path.dirname(out), { recursive: true })
  await sharp(file).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 80 }).toFile(out)
  const size = (await stat(out)).size
  before += srcStat.size
  after += size
  console.log(`${rel}  ${(srcStat.size / 1024).toFixed(0)}KB -> ${(size / 1024).toFixed(0)}KB`)
}
if (before) console.log(`Total ${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(1)}MB`)
