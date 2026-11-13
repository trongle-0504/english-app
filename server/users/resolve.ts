// The multi-user request context (PLAN-multi-user-v2.md, 3.1): every API request that touches learner data runs with
// rootDir/contentDir set to the caller's own folder (server/users/root.ts). Fails closed: no session → 401, an account
// not yet approved → 403, a learner on an admin route → 403. The admin may read a learner's pages with the header
// X-View-As: <uid> (GET only, written to the audit log).
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import { ApiError, type ApiContext, type ContextResolver } from '../api.ts'
import { authenticate } from '../auth/middleware.ts'
import { findById, statusOf, type User } from '../auth/users.ts'
import { audit } from './audit.ts'
import { readOnlyMethod } from './access.ts'
import { rememberAccountRoot } from './quota.ts'
import { ensureUserRoot } from './root.ts'

export interface UserContextOptions {
  appRoot: string
  base: ApiContext
  /** The /data store of a user changed (their library was written). */
  invalidate: (uid: string) => void
}

/** The context for `user`'s own folder. */
export function contextFor(user: Pick<User, 'id' | 'role' | 'email'>, opts: UserContextOptions, viewAs = false): ApiContext {
  const root = ensureUserRoot(user.id, opts.appRoot)
  rememberAccountRoot(user.id, root, user.role === 'admin')
  return {
    contentDir: path.join(root, 'content'),
    rootDir: root,
    onContentChange: () => opts.invalidate(user.id),
    user: { id: user.id, role: user.role, email: user.email, ...(viewAs ? { viewAs: true } : {}) },
  }
}

/** Whether `user` may use the app's data (approved, password changed, admin with two-factor). Throws otherwise. */
export function assertActive(user: User) {
  const status = statusOf(user)
  if (status === 'pending') throw new ApiError(403, 'Tài khoản đang chờ admin duyệt.')
  if (status === 'rejected') throw new ApiError(403, 'Yêu cầu đăng ký chưa được chấp nhận.')
  if (user.mustChangePassword) throw new ApiError(403, 'Hãy đổi mật khẩu trước khi dùng app.')
  if (user.role === 'admin' && !user.totpSecret && process.env.ADMIN_REQUIRE_2FA !== '0') {
    throw new ApiError(403, 'Tài khoản admin phải bật xác thực hai lớp (Tài khoản → Xác thực hai lớp).')
  }
}

const viewAsHeader = (req: IncomingMessage) => {
  const value = req.headers['x-view-as']
  return String((Array.isArray(value) ? value[0] : value) ?? '').trim()
}

export function multiUserResolver(opts: UserContextOptions): ContextResolver {
  return async (req, routeKey, routeClass) => {
    if (routeClass === 'public') return opts.base
    const user = await authenticate(req)
    if (!user) throw new ApiError(401, 'Not logged in.')
    if (routeClass === 'account') return { ...opts.base, user: { id: user.id, role: user.role, email: user.email } }
    assertActive(user)
    if (routeClass === 'admin' && user.role !== 'admin') throw new ApiError(403, 'Chỉ admin dùng được chức năng này.')

    const target = viewAsHeader(req)
    if (target && target !== user.id) {
      if (user.role !== 'admin') throw new ApiError(403, 'Chỉ admin xem được dữ liệu của người khác.')
      if (!readOnlyMethod(req.method ?? 'GET')) throw new ApiError(403, 'Chế độ "Xem như học viên" chỉ đọc.')
      if (routeClass === 'admin') throw new ApiError(403, 'Không dùng chế độ xem với trang admin.')
      const learner = await findById(target)
      if (!learner) throw new ApiError(404, 'Không có tài khoản này.')
      void audit('admin.view-as', { admin: user.email, learner: learner.email, route: routeKey })
      return contextFor(learner, opts, true)
    }
    return contextFor(user, opts)
  }
}
