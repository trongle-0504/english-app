import { KeyRound, ShieldCheck, UserCheck, UserPlus, UserX } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge, Button, Card } from '@/components/ui'
import { useCurrentUser, type UserRole } from '@/features/auth/session'
import { cn } from '@/lib/cn'
import { adminApi, useAdminResource } from './api'
import { Field, inputClass, StatusAlert, TextInput } from './ui'
import type { Status } from './utils'

interface AdminUserItem {
  id: string
  email: string
  role: UserRole
  disabled: boolean
  createdAt: string
}

export default function UsersAdminPage() {
  const me = useCurrentUser()
  const { data, loading, error, reload } = useAdminResource<{ users: AdminUserItem[] }>('users')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('learner')
  const [creating, setCreating] = useState(false)
  const [resetTarget, setResetTarget] = useState<AdminUserItem | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [status, setStatus] = useState<Status | null>(null)

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setCreating(true)
    setStatus(null)
    try {
      await adminApi('users', { method: 'POST', body: { email: email.trim(), password, role } })
      setEmail('')
      setPassword('')
      setRole('learner')
      setStatus({ tone: 'success', message: `Created account for ${email.trim()}.` })
      reload()
    } catch (err) {
      setStatus({ tone: 'error', message: (err as Error).message })
    } finally {
      setCreating(false)
    }
  }

  const handleRoleChange = async (user: AdminUserItem, nextRole: UserRole) => {
    setStatus(null)
    try {
      await adminApi('users/role', { method: 'POST', body: { id: user.id, role: nextRole } })
      setStatus({ tone: 'success', message: `Updated ${user.email} role to ${nextRole}.` })
      reload()
    } catch (err) {
      setStatus({ tone: 'error', message: (err as Error).message })
    }
  }

  const handleToggleDisabled = async (user: AdminUserItem) => {
    setStatus(null)
    try {
      await adminApi('users/status', { method: 'POST', body: { id: user.id, disabled: !user.disabled } })
      setStatus({
        tone: 'success',
        message: `${user.email} ${user.disabled ? 'enabled' : 'disabled'}.`,
      })
      reload()
    } catch (err) {
      setStatus({ tone: 'error', message: (err as Error).message })
    }
  }

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault()
    if (!resetTarget || !newPassword) return
    setStatus(null)
    try {
      await adminApi('users/reset-password', { method: 'POST', body: { id: resetTarget.id, password: newPassword } })
      setStatus({ tone: 'success', message: `Reset password for ${resetTarget.email}.` })
      setResetTarget(null)
      setNewPassword('')
    } catch (err) {
      setStatus({ tone: 'error', message: (err as Error).message })
    }
  }

  const users = data?.users ?? []

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <Card className="h-fit space-y-4 p-5">
        <div className="flex items-center gap-2">
          <UserPlus className="size-5 text-brand-600 dark:text-brand-400" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Create account</h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Learner accounts share the vocabulary, grammar, essays, and blog library, while keeping their own review progress, custom cards, and practice history.
        </p>
        <form onSubmit={(e) => void handleCreate(e)} className="space-y-3">
          <Field label="Email">
            <TextInput
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="learner@example.com"
              autoComplete="off"
            />
          </Field>
          <Field label="Initial password" hint="At least 10 characters">
            <TextInput
              type="password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 10 characters"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Role">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className={cn(inputClass, 'h-9 py-1.5')}
            >
              <option value="learner">Learner (study & personal progress)</option>
              <option value="admin">Admin (full library editor)</option>
            </select>
          </Field>
          <Button type="submit" className="w-full" disabled={creating || !email.trim() || password.length < 10}>
            <UserPlus className="size-4" />
            {creating ? 'Creating\u2026' : 'Create account'}
          </Button>
        </form>
      </Card>

      <div className="space-y-4">
        <StatusAlert status={status} />
        {error ? <StatusAlert status={{ tone: 'error', message: error }} /> : null}

        {resetTarget ? (
          <Card className="border-brand-200 bg-brand-50/40 p-4 dark:border-brand-900/60 dark:bg-brand-950/20">
            <form onSubmit={(e) => void handleResetPassword(e)} className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 flex-1">
                <Field label={`Reset password for ${resetTarget.email}`}>
                  <TextInput
                    type="password"
                    required
                    minLength={10}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (min 10 chars)"
                    autoComplete="new-password"
                  />
                </Field>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={newPassword.length < 10}>
                  <KeyRound className="size-3.5" /> Save password
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setResetTarget(null)
                    setNewPassword('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        ) : null}

        <Card className="divide-y divide-slate-200/80 dark:divide-slate-800">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Accounts ({users.length})</h2>
          </div>
          {loading ? (
            <div className="p-5 text-sm text-slate-500">Loading accounts\u2026</div>
          ) : !users.length ? (
            <div className="p-5 text-sm text-slate-500">No accounts found.</div>
          ) : (
            users.map((u) => {
              const isSelf = u.id === me?.id
              return (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-slate-900 dark:text-white">{u.email}</span>
                      <Badge tone={u.role === 'admin' ? 'brand' : 'slate'}>
                        {u.role === 'admin' ? (
                          <span className="inline-flex items-center gap-1">
                            <ShieldCheck className="size-3" /> admin
                          </span>
                        ) : (
                          'learner'
                        )}
                      </Badge>
                      {u.disabled ? <Badge tone="rose">disabled</Badge> : null}
                      {isSelf ? <Badge tone="emerald">you</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      ID: <code>{u.id}</code> \u00b7 Created {u.createdAt.slice(0, 10)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={u.role}
                      disabled={isSelf}
                      onChange={(e) => void handleRoleChange(u, e.target.value as UserRole)}
                      className={cn(inputClass, 'h-8 w-28 py-0 text-xs')}
                      aria-label={`Role for ${u.email}`}
                    >
                      <option value="learner">learner</option>
                      <option value="admin">admin</option>
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setResetTarget(u)
                        setNewPassword('')
                      }}
                    >
                      <KeyRound className="size-3.5" /> Password
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isSelf}
                      onClick={() => void handleToggleDisabled(u)}
                    >
                      {u.disabled ? (
                        <>
                          <UserCheck className="size-3.5 text-emerald-600" /> Enable
                        </>
                      ) : (
                        <>
                          <UserX className="size-3.5 text-rose-600" /> Disable
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </Card>
      </div>
    </div>
  )
}
