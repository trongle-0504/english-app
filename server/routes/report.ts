import type { ReportDoc } from '../../src/features/report/model.ts'
import { ApiError, type ApiHandler } from '../api.ts'
import { reportPdf } from '../report-pdf.ts'

/** Reports exported from Speaking and Writing Review (src/features/report). */
export const reportRoutes: Record<string, ApiHandler> = {
  /** Body `{ doc }` (a report built by the page) → `{ pdf }`: the report as a PDF file, base64. */
  'POST /report/pdf': async (req) => {
    const doc = (req.body as { doc?: ReportDoc } | undefined)?.doc
    if (!doc || typeof doc.title !== 'string' || !Array.isArray(doc.blocks) || !Array.isArray(doc.meta)) throw new ApiError(400, 'doc must be a report.')
    const pdf = await reportPdf(doc)
    return { json: { pdf: pdf.toString('base64') } }
  },
}
