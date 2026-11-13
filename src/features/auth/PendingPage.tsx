// Multi-user app: shown to an account that signed up and waits for the admin's approval (or was not accepted).
import { Hourglass, LogOut, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card } from '@/components/ui'
import { LoginBackdrop } from './LoginBackdrop'
import { fetchMe, logout, type AuthUser } from './session'

export default function PendingPage() {
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    const check = () =>
      fetchMe().then((me) => {
        if (!me.user) return window.location.assign('/login')
        if (me.user.status !== 'pending' && me.user.status !== 'rejected') return window.location.assign('/')
        setUser(me.user)
      }, () => {})
    void check()
    const timer = setInterval(check, 60_000)
    return () => clearInterval(timer)
  }, [])

  const rejected = user?.status === 'rejected'
  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center px-4 py-10">
      <title>Chờ duyệt · NeSy</title>
      <LoginBackdrop />
      <Card className="w-full max-w-md space-y-4 border-white/40 bg-white/85 p-6 text-center shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/75">
        <Hourglass className="mx-auto size-10 text-amber-500" />
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">{rejected ? 'Yêu cầu chưa được chấp nhận' : 'Đang chờ admin duyệt'}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {rejected
            ? 'Admin chưa chấp nhận yêu cầu đăng ký này. Liên hệ admin nếu bạn nghĩ đây là nhầm lẫn.'
            : `Chào ${user?.displayName ?? 'bạn'}! Tài khoản ${user?.email ?? ''} đã được tạo. Bạn sẽ dùng được app ngay khi admin duyệt; trang này tự kiểm tra lại mỗi phút.`}
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="secondary" onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" /> Kiểm tra lại
          </Button>
          <Button variant="ghost" onClick={() => void logout()}>
            <LogOut className="size-4" /> Đăng xuất
          </Button>
        </div>
      </Card>
    </main>
  )
}
