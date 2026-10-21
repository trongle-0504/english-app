import { Eye, EyeOff, LockKeyhole } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { Button, Card } from '@/components/ui'
import { Field, TextInput } from '@/features/admin/ui'
import { LoginBackdrop } from './LoginBackdrop'
import { fetchMe, login, safeNext } from './session'

export default function LoginPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsSetup, setNeedsSetup] = useState(false)

  // Already logged in (another tab, or the back button): go straight on. No account yet: say how to create one.
  useEffect(() => {
    fetchMe()
      .then((me) => {
        if (me.user) window.location.replace(next)
        else setNeedsSetup(me.needsSetup)
      })
      .catch(() => {})
  }, [next])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
      // A full load: pages and their data start fresh with the new session.
      window.location.assign(next)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
      // The account may have been created since the page opened: drop a stale "no account yet" hint.
      fetchMe().then((me) => setNeedsSetup(me.needsSetup), () => {})
    }
  }

  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center px-4 py-10">
      <title>Đăng nhập · LinearThinking</title>
      <LoginBackdrop />
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img src="/logo.svg" alt="" width={56} height={56} className="size-14 drop-shadow-lg" />
          <h1 className="text-3xl font-extrabold tracking-tight text-white drop-shadow-[0_2px_12px_rgb(2_6_23/0.5)]">
            Linear<span className="text-brand-300">Thinking</span>
          </h1>
        </div>

        <Card className="animate-slide-up border-white/40 bg-white/85 p-5 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-7 dark:border-white/10 dark:bg-slate-900/75">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email" htmlFor="login-email">
              <TextInput
                id="login-email"
                type="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Mật khẩu" htmlFor="login-password">
              <div className="relative">
                <TextInput
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>

            {error ? (
              <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </p>
            ) : null}

            <Button type="submit" loading={busy} className="w-full">
              {busy ? null : <LockKeyhole className="size-4" />}
              Đăng nhập
            </Button>
          </form>
        </Card>

        {needsSetup ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            Chưa có tài khoản nào. Tạo bằng lệnh trong WSL, tại thư mục dự án:{' '}
            <code className="font-mono text-[13px] break-all">node scripts/user.ts create &lt;email&gt;</code>
          </p>
        ) : null}
      </div>
    </main>
  )
}
