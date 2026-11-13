// The help pages Nova answers "how do I…" from stay in step with the app: every menu page has a help page, every
// page a help page names exists, and common questions find the right page (PLAN-multi-user-v2.md, 4.3).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { navGroups } from '../../src/components/layout/nav.ts'
import { loadDocs, searchDocs } from '../../server/help/docs.ts'

const root = path.resolve(import.meta.dirname, '..', '..')
const docs = loadDocs()

test('every page in the menu has a help page', () => {
  const covered = new Set(docs.flatMap((d) => d.routes))
  const missing = navGroups.flatMap((g) => [...(g.items ?? []).map((i) => i.to), ...(g.to ? [g.to] : [])]).filter((to) => !covered.has(to))
  assert.deepEqual(missing, [], 'add these routes to a content/docs/*.md page')
})

test('every route a help page names exists in the app', () => {
  const routesFile = readFileSync(path.join(root, 'src', 'routes.tsx'), 'utf8')
  const known = new Set(['/', ...[...routesFile.matchAll(/path: '([^']+)'/g)].map((m) => `/${m[1]}`)])
  for (const doc of docs) for (const r of doc.routes) assert.ok(known.has(r) || known.has(r.replace(/^\/admin\//, '/')) || r.startsWith('/admin/'), `${doc.id}: ${r}`)
})

test('every page has a title, keywords and a date', () => {
  assert.ok(docs.length >= 15)
  for (const d of docs) {
    assert.ok(d.title && d.keywords.length && /^\d{4}-\d{2}-\d{2}$/.test(d.updated), d.id)
  }
})

test('common questions find the right page first', () => {
  const cases: [string, string][] = [
    ['làm sao để ghi âm speaking review', 'speaking-review'],
    ['hết lượt chấm writing thì sao', 'quotas'],
    ['tôi quên mật khẩu', 'account-privacy'],
    ['đăng nhập thiết bị thứ 3', 'account-privacy'],
    ['how do I add a word to my vocabulary', 'vocabulary'],
    ['bật nhắc nhở planner', 'planner'],
    ['chấm bài essay task 2', 'writing-review'],
  ]
  for (const [q, id] of cases) assert.equal(searchDocs(docs, q, 1)[0]?.id, id, q)
})
