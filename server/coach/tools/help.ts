// Nova's help tools: the app's own how-to pages (content/docs), so "how do I…" questions are answered from the
// pages and never invented (PLAN-multi-user-v2.md, 4.3).
import { loadDocs, searchDocs } from '../../help/docs.ts'
import { ToolError } from '../data.ts'
import { reqString } from './args.ts'
import type { CoachTool } from './types.ts'

export const searchHelp: CoachTool = {
  name: 'search_help',
  description:
    'Search the app\'s help pages (how to use each feature, limits, account, privacy). Use it for every "how do I / where is / what does … do" question about the app. Returns the best sections with their page href.',
  inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'The learner\'s question or its key words (Vietnamese or English).' } }, required: ['query'] },
  label: () => 'Đang tra hướng dẫn…',
  run: async (args) => {
    const hits = searchDocs(loadDocs(), reqString(args, 'query', 300), 4)
    return { hits: hits.map(({ title, section, text, href }) => ({ page: title, section, text, href })), note: hits.length ? undefined : 'No help page matches.' }
  },
}

export const readHelp: CoachTool = {
  name: 'read_help',
  description: 'Read one whole help page by id (the id is the last part of a search_help href, e.g. "writing-review").',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  label: () => 'Đang đọc hướng dẫn…',
  run: async (args) => {
    const id = reqString(args, 'id', 80).replace(/^\/?help\//, '')
    const doc = loadDocs().find((d) => d.id === id)
    if (!doc) throw new ToolError(`No help page "${id}". Use search_help first.`)
    return { title: doc.title, href: `/help/${doc.id}`, pages: doc.routes, text: doc.body.slice(0, 6000) }
  },
}
