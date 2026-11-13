// Multi-user app: the public sign-up form. The account waits for the admin's approval (PLAN-multi-user-v2.md, 6.1).
import { CheckCircle2, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button, Card } from '@/components/ui'
import { Field, TextArea, TextInput } from '@/features/admin/ui'
import { LoginBackdrop } from './LoginBackdrop'
import { loadRegisterConfig, register } from './session'

const MIN_LENGTH = 10

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void }) => void }
  }
}

export default function RegisterPage() {
  const [config, setConfig] = useState<{ open: boolean; turnstileSiteKey: string } | null>(null)
  const [form, setForm] = useState({ displayName: '', email: '', password: '', repeat: '', note: '' })
  const [agree, setAgree] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const widget = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadRegisterConfig().then(setConfig, () => setConfig({ open: false, turnstileSiteKey: '' }))
  }, [])

  // Cloudflare Turnstile ("not a robot"), only when the server has a site key.
  useEffect(() => {
    if (!config?.turnstileSiteKey || !widget.current) return
    const el = widget.current
    const render = () => window.turnstile?.render(el, { sitekey: config.turnstileSiteKey, callback: setToken })
    if (window.turnstile) return render()
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    script.async = true
    script.onload = render
    document.head.appendChild(script)
  }, [config])

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (form.password.length < MIN_LENGTH) return setError(`Mật khẩu cần ít nhất ${MIN_LENGTH} ký tự.`)
    if (form.password !== form.repeat) return setError('Hai lần nhập mật khẩu không khớp.')
    if (!agree) return setError('Hãy đọc và đồng ý cách app lưu dữ liệu của bạn.')
    setBusy(true)
    try {
      await register({ displayName: form.displayName, email: form.email, password: form.password, note: form.note, turnstileToken: token })
      setDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center px-4 py-10">
      <title>Đăng ký · NeSy</title>
      <LoginBackdrop />
      <div className="w-full max-w-md">
        <h1 className="mb-5 text-center text-2xl font-extrabold tracking-tight text-white drop-shadow-[0_2px_12px_rgb(2_6_23/0.5)]">Đăng ký tài khoản</h1>
        <Card className="border-white/40 bg-white/85 p-5 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-7 dark:border-white/10 dark:bg-slate-900/75">
          {done ? (
            <div className="space-y-3 text-center">
              <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
              <p className="font-semibold text-slate-900 dark:text-white">Đã gửi yêu cầu.</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Admin sẽ xem và duyệt tài khoản của bạn. Sau khi được duyệt, đăng nhập bằng email và mật khẩu vừa tạo.
              </p>
              <Link to="/login" className="inline-block text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
                Về trang đăng nhập
              </Link>
            </div>
          ) : config && !config.open ? (
            <p className="text-sm text-slate-700 dark:text-slate-200">
              Hiện chưa mở đăng ký. Hãy liên hệ admin để được tạo tài khoản.{' '}
              <Link to="/login" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                Đăng nhập
              </Link>
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Field label="Tên của bạn" htmlFor="reg-name">
                <TextInput id="reg-name" required maxLength={60} autoComplete="name" value={form.displayName} onChange={set('displayName')} />
              </Field>
              <Field label="Email" htmlFor="reg-email">
                <TextInput id="reg-email" type="email" required autoComplete="email" inputMode="email" autoCapitalize="none" value={form.email} onChange={set('email')} />
              </Field>
              <Field label="Mật khẩu" htmlFor="reg-password" hint={`Ít nhất ${MIN_LENGTH} ký tự.`}>
                <TextInput id="reg-password" type="password" required minLength={MIN_LENGTH} autoComplete="new-password" value={form.password} onChange={set('password')} />
              </Field>
              <Field label="Nhập lại mật khẩu" htmlFor="reg-repeat">
                <TextInput id="reg-repeat" type="password" required autoComplete="new-password" value={form.repeat} onChange={set('repeat')} />
              </Field>
              <Field label="Ghi chú cho admin (không bắt buộc)" htmlFor="reg-note" hint="Ví dụ: bạn biết app qua ai, mục tiêu band.">
                <TextArea id="reg-note" rows={2} maxLength={300} value={form.note} onChange={set('note')} />
              </Field>
              <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>
                  Tôi đã đọc{' '}
                  <a href="/help/account-privacy" target="_blank" className="font-semibold text-brand-700 underline dark:text-brand-300">
                    cách app lưu dữ liệu
                  </a>
                  : bài viết và ghi âm được gửi tới dịch vụ AI để chấm; admin xem được dữ liệu học; ghi âm giữ 15 ngày; mỗi tài khoản dùng tối đa 2 thiết bị.
                </span>
              </label>
              <div ref={widget} />
              {error ? (
                <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  {error}
                </p>
              ) : null}
              <Button type="submit" loading={busy} className="w-full">
                {busy ? null : <UserPlus className="size-4" />} Gửi yêu cầu
              </Button>
              <p className="text-center text-sm text-slate-500">
                Đã có tài khoản?{' '}
                <Link to="/login" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                  Đăng nhập
                </Link>
              </p>
            </form>
          )}
        </Card>
      </div>
    </main>
  )
}
