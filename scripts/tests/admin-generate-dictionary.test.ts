// Admin → Generate, dictionary step (no AI, no network: fetch is stubbed, caches live in a scratch folder):
// normalising what was typed, the base-form fast path, Longman always looked up when not cached, Longman failing →
// OZDIC at once (no Retry-After sleep), both failing → AI alone with a note for the admin.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const scratch = mkdtempSync(path.join(os.tmpdir(), 'admin-dict-'))
process.env.LONGMAN_CACHE_DIR = path.join(scratch, 'longman')
process.env.OZDIC_CACHE_DIR = path.join(scratch, 'ozdic')
process.env.LONGMAN_GAP_MS = '1'
process.env.OZDIC_GAP_MS = '1'
process.env.LONGMAN_LOOKUP = 'on'
// Any AI call fails at once (no key): a base-form step that reached the AI shows up as `error`.
process.env.LLM_ENGINE = 'gemini'
delete process.env.GEMINI_API_KEY

const { hasInflectionSign, isSingleWord, lookupAsTyped, normalizeTerm } = await import('../../server/admin/headword.ts')
const { dictionaryReference, ozdicPrompt, resolveLemma, adminEffort } = await import('../../server/admin/ozdic-grounding.ts')

/* ───────────── Stubbed dictionary sites ───────────── */

function longmanPage(word: string, collocations: string[] = []) {
  const box = collocations.length
    ? `<div class="ColloBox"><div class="Section"><span class="SECHEADING">verbs</span>${collocations
        .map((c) => `<div class="Collocate"><span class="COLLOC">${c}</span></div>`)
        .join('')}</div></div>`
    : ''
  return `<html><div class="ldoceEntry Entry"><span class="Head"><span class="HWD">${word}</span><span class="POS">noun</span></span><span class="Sense"><span class="DEF">a ${word}</span></span>${box}</div></html>`
}

/** OZDIC's Nuxt "devalue" payload: objects and arrays go by index, strings inline. */
function ozdicPage(word: string, items: string[]) {
  const flat: unknown[] = []
  const add = (v: unknown): unknown => {
    if (typeof v === 'string') return v
    const i = flat.length
    flat.push(null)
    flat[i] = Array.isArray(v) ? v.map(add) : Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, add(x)]))
    return i
  }
  add({
    data: {
      [`word-${word}`]: {
        collocations: [{ gloss: '', groups: [{ cat: 'ADJ.', clusters: [{ words: items }] }] }],
        sources: ['oxford-collocations'],
        pos: [{ p: 'noun' }],
      },
    },
  })
  return `<script id="__NUXT_DATA__" type="application/json">${JSON.stringify(flat)}</script>`
}

type Reply = { status: number; body?: string; headers?: Record<string, string> }
const routes = new Map<string, Reply>()
const requests: string[] = []
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input)
  requests.push(url)
  const reply = routes.get(url)
  if (!reply) return new Response('', { status: 404 })
  return new Response(reply.body ?? '', { status: reply.status, headers: { 'content-type': 'text/html', ...reply.headers } })
}) as typeof fetch

const LONGMAN = (w: string) => `https://www.ldoceonline.com/dictionary/${w}`
const OZDIC = (w: string) => `https://ozdic.com/word/${w}`
const stats = () => ({ requests: 0, cacheHits: 0, waitMs: 0 })

/* ───────────── Normalising ───────────── */

test('normalizeTerm trims, lowercases, collapses spaces, straightens quotes and strips edge punctuation', () => {
  assert.equal(normalizeTerm('  “Decision.”  '), 'decision')
  assert.equal(normalizeTerm('Take   Responsibility!'), 'take responsibility')
  assert.equal(normalizeTerm('‘one’s own’'), "one's own")
  assert.equal(normalizeTerm('(well-being)', { lower: false }), 'well-being')
  assert.equal(normalizeTerm('Access', { lower: false }), 'Access')
})

test('inflection signs and single words', () => {
  for (const w of ['decisions', 'took'.replace('took', 'taking'), 'decided', 'bigger', 'biggest', 'cities', 'boxes']) assert.equal(hasInflectionSign(w), true, w)
  for (const w of ['decision', 'take', 'bus', 'red', 'ambitious'.replace('ambitious', 'ambition')]) assert.equal(hasInflectionSign(w), false, w)
  assert.equal(isSingleWord('well-being'), true)
  assert.equal(isSingleWord('take responsibility'), false)
  assert.equal(lookupAsTyped('decision'), true)
  assert.equal(lookupAsTyped('decisions'), false)
  assert.equal(lookupAsTyped('make a decision'), false)
})

test('ADMIN_GENERATE_EFFORT defaults to low and ignores GEMINI_THINKING', () => {
  process.env.GEMINI_THINKING = 'medium'
  delete process.env.ADMIN_GENERATE_EFFORT
  assert.equal(adminEffort(), 'low')
  process.env.ADMIN_GENERATE_EFFORT = 'medium'
  assert.equal(adminEffort(), 'medium')
  process.env.ADMIN_GENERATE_EFFORT = 'nonsense'
  assert.equal(adminEffort(), 'low')
  delete process.env.ADMIN_GENERATE_EFFORT
})

/* ───────────── Base-form fast path ───────────── */

test('a base-form word Longman lists exactly skips the AI call, and Longman is still fetched when not cached', async () => {
  routes.set(LONGMAN('decision'), { status: 200, body: longmanPage('decision', ['make a decision', 'reach a decision']) })
  requests.length = 0
  const s = stats()
  const step = await resolveLemma({} as never, 'Decision', '', s)
  assert.equal(step.result.skipped, true)
  assert.equal(step.result.lemma, 'Decision')
  assert.deepEqual(step.result.headwords, ['decision'])
  assert.equal(step.error, undefined)
  assert.equal(step.lemmaMs, 0)
  assert.deepEqual(requests, [LONGMAN('decision')])
  assert.equal(s.requests, 1)

  // The reference then reads the cached page: no second request.
  const ref = await dictionaryReference(step.result.headwords, { baseForms: true, stats: s })
  assert.equal(ref.dictionarySource, 'longman')
  assert.equal(ref.dictionaryNote, '')
  assert.equal(requests.length, 1)
  assert.equal(s.cacheHits, 1)
})

test('an inflected form or a phrase goes to the AI first and is never looked up as typed', async () => {
  requests.length = 0
  const inflected = await resolveLemma({} as never, 'decisions', '', stats())
  assert.equal(inflected.result.skipped, undefined)
  assert.ok(inflected.error, 'the AI base-form call was attempted')
  const phrase = await resolveLemma({} as never, 'took responsibility', '', stats())
  assert.ok(phrase.error)
  assert.equal(requests.length, 0)
})

test('a base-form word Longman does not list goes to the AI', async () => {
  requests.length = 0
  const step = await resolveLemma({} as never, 'zorbing', '', stats())
  // "zorbing" ends in -ing: no lookup as typed.
  assert.equal(requests.length, 0)
  assert.ok(step.error)
  const unknown = await resolveLemma({} as never, 'blorp', '', stats())
  assert.deepEqual(requests, [LONGMAN('blorp')])
  assert.ok(unknown.error)
})

/* ───────────── Source order ───────────── */

test('Longman without a collocations box: OZDIC is looked up too; base forms try no singular on OZDIC', async () => {
  routes.set(LONGMAN('city'), { status: 200, body: longmanPage('city') })
  routes.set(OZDIC('city'), { status: 200, body: ozdicPage('city', ['big', 'capital']) })
  requests.length = 0
  const ref = await dictionaryReference(['city'], { baseForms: true })
  assert.equal(ref.dictionarySource, 'both')
  assert.deepEqual(requests, [LONGMAN('city'), OZDIC('city')])
  assert.match(ref.text, /OZDIC/)

  // Not base forms (the AI step failed): OZDIC also tries the singular of a plural.
  routes.set(OZDIC('jobs'), { status: 404 })
  routes.set(OZDIC('job'), { status: 200, body: ozdicPage('job', ['full-time']) })
  requests.length = 0
  const plural = await dictionaryReference(['jobs'])
  assert.ok(requests.includes(OZDIC('job')))
  assert.equal(plural.dictionarySource, 'ozdic')
  requests.length = 0
  await dictionaryReference(['works'], { baseForms: true })
  assert.deepEqual(requests, [LONGMAN('works'), OZDIC('works')])
})

test('Longman 429 → OZDIC at once (no Retry-After sleep); the back-off still applies to the next Longman request', async () => {
  routes.set(LONGMAN('habit'), { status: 429, headers: { 'retry-after': '120' } })
  routes.set(OZDIC('habit'), { status: 200, body: ozdicPage('habit', ['bad', 'good']) })
  const started = Date.now()
  const ref = await dictionaryReference(['habit'], { baseForms: true })
  assert.ok(Date.now() - started < 2000, 'did not sleep for Retry-After')
  assert.equal(ref.dictionarySource, 'ozdic')
  assert.equal(ref.longmanError, 'HTTP 429')
  const longman = ref.sources.find((s) => s.dictionary === 'longman')
  assert.equal(longman?.status, 'unavailable')
  assert.equal(longman?.reason, 'HTTP 429')

  // Within the back-off: no Longman request is sent at all, OZDIC is used.
  routes.set(OZDIC('routine'), { status: 200, body: ozdicPage('routine', ['daily']) })
  requests.length = 0
  const next = await dictionaryReference(['routine'], { baseForms: true })
  assert.deepEqual(requests, [OZDIC('routine')])
  assert.match(next.longmanError ?? '', /backing off/)
})

test('both sources fail → no reference, dictionarySource "none" and a note for the admin; the prompt says there is none', async () => {
  routes.set(OZDIC('quorum'), { status: 503, headers: { 'retry-after': '60' } })
  const started = Date.now()
  const ref = await dictionaryReference(['quorum'], { baseForms: true })
  assert.ok(Date.now() - started < 2000)
  assert.equal(ref.text, '')
  assert.equal(ref.dictionarySource, 'none')
  assert.match(ref.dictionaryNote, /Không lấy được Longman \(backing off.*\) và OZDIC \(HTTP 503\): nội dung do AI tự tạo/)
  const prompt = ozdicPrompt(ref.text)
  assert.match(prompt, /NO DICTIONARY REFERENCE/)
  assert.match(prompt, /never say or imply that anything comes from Longman/)
})

test('no headword at all is reported too', async () => {
  const ref = await dictionaryReference([])
  assert.equal(ref.dictionarySource, 'none')
  assert.match(ref.dictionaryNote, /Không có từ khoá/)
})
