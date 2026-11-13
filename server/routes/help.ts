// The help pages for the /help page (the same pages Nova searches).
import { ApiError, type ApiHandler } from '../api.ts'
import { loadDocs, searchDocs } from '../help/docs.ts'

export const helpRoutes: Record<string, ApiHandler> = {
  /** ?q= → `{ docs }` (all pages, or the matching sections). */
  'GET /help': (req) => {
    const q = req.query.get('q') ?? ''
    const docs = loadDocs()
    return { json: q ? { hits: searchDocs(docs, q, 10) } : { docs: docs.map(({ id, title, routes }) => ({ id, title, routes })) } }
  },
  'GET /help/doc': (req) => {
    const doc = loadDocs().find((d) => d.id === req.query.get('id'))
    if (!doc) throw new ApiError(404, 'Không có trang hướng dẫn này.')
    return { json: { doc } }
  },
}
