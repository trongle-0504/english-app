import { CheckCircle2, Copy, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card } from '@/components/ui'
import { Field, TextInput } from '@/features/admin/ui'
import { fetchMe, twoFactorDisable, twoFactorEnable, twoFactorRecovery, twoFactorSetup } from './session'

type Mode = 'idle' | 'setup' | 'disable' | 'recovery'

/** Account → two-factor: turn it on (QR + first code), see recovery codes once, turn it off. */
export function TwoFactorCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [mode, setMode] = useState<Mode>('idle')
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [recovery, setRecovery] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchMe().then((me) => setEnabled(Boolean(me.user?.twoFactor)), () => {})
  }, [])

  const reset = () => {
    setMode('idle')
    setCode('')
    setPassword('')
    setError('')
    setSetup(null)
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const begin = () =>
    run(async () => {
      setSetup(await twoFactorSetup())
      setMode('setup')
    })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      if (mode === 'setup') {
        setRecovery((await twoFactorEnable(code)).recoveryCodes)
        setEnabled(true)
        reset()
      } else if (mode === 'disable') {
        await twoFactorDisable(password, code)
        setEnabled(false)
        setRecovery([])
        reset()
      } else if (mode === 'recovery') {
        setRecovery((await twoFactorRecovery(password, code)).recoveryCodes)
        reset()
      }
    })
  }

  if (enabled === null) return null
  const text = recovery.join('\n')

  return (
    <Card className="mt-5 p-4 sm:p-6">
      <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
        <ShieldCheck className="size-4 text-brand-600" /> Xác thực hai lớp (2FA)
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {enabled ? 'Đang bật: khi đăng nhập cần thêm mã 6 số từ ứng dụng Authenticator trên điện thoại.' : 'Thêm mã 6 số từ ứng dụng Authenticator (Google Authenticator, Microsoft Authenticator, Authy…) mỗi lần đăng nhập.'}
      </p>

      {recovery.length ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Mã khôi phục — chỉ hiện một lần. Lưu ở nơi an toàn; mỗi mã dùng được một lần khi mất điện thoại.</p>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm text-slate-900 dark:text-slate-100">
            {recovery.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="secondary" onClick={() => void navigator.clipboard?.writeText(text)}>
              <Copy className="size-4" /> Sao chép
            </Button>
            <Button type="button" variant="secondary" onClick={() => setRecovery([])}>
              <CheckCircle2 className="size-4" /> Tôi đã lưu
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'idle' ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {enabled ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setMode('recovery')}>
                Tạo lại mã khôi phục
              </Button>
              <Button type="button" variant="secondary" onClick={() => setMode('disable')}>
                Tắt 2FA
              </Button>
            </>
          ) : (
            <Button type="button" loading={busy} onClick={() => void begin()}>
              Bật 2FA
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-4">
          {mode === 'setup' && setup ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">1. Mở Authenticator trên điện thoại → thêm tài khoản → quét mã QR.</p>
              <img src={setup.qr} alt="QR code" width={192} height={192} className="rounded-lg border border-slate-200 bg-white p-1" />
              <p className="text-xs text-slate-500">
                Không quét được? Nhập khóa này:{' '}
                <code className="font-mono text-[13px] break-all select-all">{setup.secret}</code>
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-300">2. Nhập mã 6 số đang hiện trong ứng dụng để xác nhận.</p>
            </div>
          ) : null}
          {mode !== 'setup' ? (
            <Field label="Mật khẩu" htmlFor="tf-password">
              <TextInput id="tf-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          ) : null}
          <Field label="Mã 6 số" htmlFor="tf-code">
            <TextInput id="tf-code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} className="font-mono tracking-widest" />
          </Field>
          {error ? (
            <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              {mode === 'setup' ? 'Xác nhận và bật' : mode === 'disable' ? 'Tắt 2FA' : 'Tạo mã mới'}
            </Button>
            <Button type="button" variant="secondary" onClick={reset}>
              Hủy
            </Button>
          </div>
        </form>
      )}
      {mode === 'idle' && error ? (
        <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      ) : null}
    </Card>
  )
}
