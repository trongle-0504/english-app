import { CheckCircle2, Eye, EyeOff, KeyRound } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card, PageHeader } from '@/components/ui'
import { Field, TextInput } from '@/features/admin/ui'
import { changePassword, fetchMe } from './session'
import { TwoFactorCard } from './TwoFactorCard'

/** Same rule as the server (server/auth/password.ts), checked here first for a quicker message. */
const MIN_LENGTH = 10

export default function AccountPage() {
  const [email, setEmail] = useState('')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetchMe().then((me) => setEmail(me.user?.email ?? ''), () => {})
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setDone(false)
    if (next.length < MIN_LENGTH) return setError(`Mật khẩu mới cần ít nhất ${MIN_LENGTH} ký tự.`)
    if (next !== repeat) return setError('Hai lần nhập mật khẩu mới không khớp.')
    setBusy(true)
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setRepeat('')
      setDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const type = show ? 'text' : 'password'
  return (
    <div className="mx-auto max-w-md pb-16">
      <PageHeader eyebrow="Account" title="Tài khoản" />

      <Card className="p-4 sm:p-6">
        <p className="text-sm text-slate-500 dark:text-slate-400">Đang đăng nhập</p>
        <p className="mt-0.5 font-semibold break-all text-slate-900 dark:text-white">{email || '…'}</p>
      </Card>

      <Card className="mt-5 p-4 sm:p-6">
        <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <KeyRound className="size-4 text-brand-600" /> Đổi mật khẩu
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Các thiết bị khác sẽ bị đăng xuất; thiết bị này vẫn giữ đăng nhập.</p>

        <form onSubmit={submit} className="mt-4 space-y-4">
          {/* Lets the browser's password manager pair the new password with this account. */}
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
          <Field
            label="Mật khẩu hiện tại"
            htmlFor="current-password"
            action={
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="relative inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hit-area hover:text-slate-800 dark:hover:text-slate-200"
              >
                {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} {show ? 'Ẩn' : 'Hiện'}
              </button>
            }
          >
            <TextInput id="current-password" type={type} autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="Mật khẩu mới" htmlFor="new-password" hint={`Ít nhất ${MIN_LENGTH} ký tự.`}>
            <TextInput id="new-password" type={type} autoComplete="new-password" required minLength={MIN_LENGTH} value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Nhập lại mật khẩu mới" htmlFor="repeat-password">
            <TextInput id="repeat-password" type={type} autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </Field>

          {error ? (
            <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </p>
          ) : null}
          {done ? (
            <p role="status" className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="size-4 shrink-0" /> Đã đổi mật khẩu.
            </p>
          ) : null}

          <Button type="submit" loading={busy} className="w-full">
            Đổi mật khẩu
          </Button>
        </form>
      </Card>

      <TwoFactorCard />
    </div>
  )
}
