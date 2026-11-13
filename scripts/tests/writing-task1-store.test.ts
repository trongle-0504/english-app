// Writing Task 1 store (server/writing-task1/store.ts): chart pictures and the model essay per question.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import { ApiError } from '../../server/api.ts'
import { parseImages } from '../../server/images.ts'
import { addImages, getExtras, listExtras, readImage, removeImage, saveModelEssay } from '../../server/writing-task1/store.ts'

function setup() {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'task1-store-'))
  const contentDir = path.join(rootDir, 'content')
  mkdirSync(path.join(contentDir, 'practice', 'writing-mock'), { recursive: true })
  writeFileSync(
    path.join(contentDir, 'practice', 'writing-mock', 'task1-prompts.json'),
    JSON.stringify([
      { id: 'bar-001', prompt: 'The bar chart shows…', chart_type: 'Bar Chart' },
      { id: 'line-002', prompt: 'The line graph shows…', chart_type: 'Line' },
    ]),
  )
  return { ctx: { rootDir, contentDir }, cleanup: () => rmSync(rootDir, { recursive: true, force: true, maxRetries: 5 }) }
}

/** A PNG of the given size as a request would send it. */
async function png(width: number, height: number) {
  const data = await sharp({ create: { width, height, channels: 3, background: '#3b82f6' } }).png().toBuffer()
  return { mimeType: 'image/png', data: `data:image/png;base64,${data.toString('base64')}` }
}

const status = (expected: number) => (error: unknown) => error instanceof ApiError && error.status === expected

test('pictures: saved as WebP within 1600 px, read back, removed; numbers are not reused', async () => {
  const { ctx, cleanup } = setup()
  try {
    let extras = await addImages(ctx, 'bar-001', parseImages([await png(3200, 1000), await png(400, 300)]))
    assert.deepEqual(
      extras.images.map(({ n, width, height }) => ({ n, width, height })),
      [
        { n: 1, width: 1600, height: 500 },
        { n: 2, width: 400, height: 300 },
      ],
    )
    assert.equal(extras.images[0].url, '/api/writing-task1/image?prompt=bar-001&n=1')
    const bytes = await readImage(ctx, 'bar-001', '2')
    assert.equal((await sharp(bytes).metadata()).format, 'webp')

    extras = await removeImage(ctx, 'bar-001', '1')
    assert.deepEqual(extras.images.map((i) => i.n), [2])
    assert.equal(existsSync(path.join(ctx.rootDir, 'progress', 'writing-task1', 'images', 'bar-001-1.webp')), false)
    await assert.rejects(readImage(ctx, 'bar-001', '1'), status(404))

    extras = await addImages(ctx, 'bar-001', parseImages([await png(10, 10)]))
    assert.deepEqual(extras.images.map((i) => i.n), [2, 3])
  } finally {
    cleanup()
  }
})

test('pictures: at most 4 per question; a broken picture is refused', async () => {
  const { ctx, cleanup } = setup()
  try {
    const one = await png(20, 20)
    await addImages(ctx, 'bar-001', parseImages([one, one, one]))
    await assert.rejects(addImages(ctx, 'bar-001', parseImages([one, one])), status(400))
    assert.equal((await getExtras(ctx, 'bar-001')).images.length, 3)
    assert.throws(() => parseImages([one, one, one, one, one]), status(400))
    await assert.rejects(addImages(ctx, 'line-002', [{ mimeType: 'image/png', data: Buffer.from('not a picture').toString('base64') }]), status(400))
  } finally {
    cleanup()
  }
})

test('question ids: a bad shape or path is 400, an unknown question 404', async () => {
  const { ctx, cleanup } = setup()
  try {
    for (const bad of ['../bar-001', 'bar-001/../../x', 'BAR-001', '', undefined, 42]) {
      await assert.rejects(getExtras(ctx, bad), status(400), String(bad))
    }
    await assert.rejects(getExtras(ctx, 'pie-999'), status(404))
    await assert.rejects(readImage(ctx, 'bar-001', '../x'), status(400))
  } finally {
    cleanup()
  }
})

test('model essay: saved, empty removes it; list shows what each question has', async () => {
  const { ctx, cleanup } = setup()
  try {
    let extras = await saveModelEssay(ctx, 'line-002', '  The line graph illustrates…\r\nOverall, …  ')
    assert.equal(extras.modelEssay?.text, 'The line graph illustrates…\nOverall, …')
    await addImages(ctx, 'bar-001', parseImages([await png(20, 20)]))
    assert.deepEqual(await listExtras(ctx), {
      'bar-001': { images: 1, hasModel: false },
      'line-002': { images: 0, hasModel: true },
    })
    extras = await saveModelEssay(ctx, 'line-002', '')
    assert.equal(extras.modelEssay, undefined)
    assert.deepEqual(Object.keys(await listExtras(ctx)), ['bar-001'])
    await assert.rejects(saveModelEssay(ctx, 'line-002', 'x'.repeat(6001)), status(400))
    await assert.rejects(saveModelEssay(ctx, 'line-002', 7), status(400))
  } finally {
    cleanup()
  }
})

test('caches: new pictures drop the chart reading, a new essay drops its vocabulary', async () => {
  const { ctx, cleanup } = setup()
  try {
    const file = path.join(ctx.rootDir, 'progress', 'writing-task1', 'prompts', 'bar-001.json')
    await saveModelEssay(ctx, 'bar-001', 'First essay.')
    const seed = () => {
      const doc = JSON.parse(readFileSync(file, 'utf8'))
      writeFileSync(file, JSON.stringify({ ...doc, chartRead: { cached: true }, modelVocab: { cached: true } }))
    }
    seed()
    await addImages(ctx, 'bar-001', parseImages([await png(20, 20)]))
    let doc = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(doc.chartRead, undefined)
    assert.deepEqual(doc.modelVocab, { cached: true })

    seed()
    await removeImage(ctx, 'bar-001', '1')
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).chartRead, undefined)

    seed()
    await saveModelEssay(ctx, 'bar-001', 'First essay.')
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).modelVocab, { cached: true }, 'unchanged text keeps the cache')
    await saveModelEssay(ctx, 'bar-001', 'Second essay.')
    doc = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(doc.modelVocab, undefined)
    assert.deepEqual(doc.chartRead, { cached: true })
  } finally {
    cleanup()
  }
})
