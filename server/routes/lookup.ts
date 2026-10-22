import { guarded } from '../admin/auth.ts'
import { queryParam } from '../admin/input.ts'
import { ApiError, type ApiHandler } from '../api.ts'
import { lookupDol, lookupExtra } from '../lookup.ts'
import { dolSelfCheck, dolStatus } from '../writing-review/dol.ts'

/** The header lookup beyond your library, under /api/lookup. Read-only (a DOL entry is fetched and cached on demand). */
export const lookupRoutes: Record<string, ApiHandler> = {
  /** ?q= → topic collocations and DOL headwords. */
  'GET /lookup': async (req, ctx) => ({ json: await lookupExtra(ctx, (req.query.get('q') ?? '').slice(0, 120)) }),

  /** ?url= → a DOL entry. */
  'GET /lookup/dol': async (req) => {
    const url = queryParam(req, 'url')
    if (!/^[a-z0-9-]{1,200}$/i.test(url)) throw new ApiError(400, 'Invalid DOL entry.')
    const entry = await lookupDol(url)
    if (!entry) throw new ApiError(502, 'Không lấy được mục từ này từ DOL (mạng hoặc DOL đang tạm chặn). Thử lại sau.')
    return { json: entry }
  },

  /** How DOL is doing for the app: the parts failing now, recent failures (shown to users so they can report them). */
  'GET /dol/status': async () => ({ json: await dolStatus() }),

  /** Checks every part of DOL live (after a fix): a few requests. */
  'POST /dol/check': guarded(async () => ({ json: await dolSelfCheck() })),
}
