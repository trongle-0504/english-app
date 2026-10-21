// Form building blocks shared by the admin editors.
import { AlertTriangle, Check, CheckCircle2, Info, Plus, Trash2, X, XCircle } from 'lucide-react'
import { useEffect, useId, useState, type ComponentProps, type ReactNode } from 'react'
import { Button, Card, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { parseJson, type Status, type StatusTone } from './utils'

export const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 transition focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500'

export function TextInput({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(inputClass, 'h-10', className)} {...props} />
}

export function TextArea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(inputClass, 'block py-2.5 leading-relaxed', className)} {...props} />
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(inputClass, 'h-10 pr-8', className)} {...props} />
}

export function Field({
  label,
  hint,
  htmlFor,
  action,
  className,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  htmlFor?: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {label}
        </label>
        {action}
      </div>
      {children}
      {hint ? <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  )
}

/** Card with a titled header row; the editors are built from these. */
export function Panel({
  icon,
  title,
  description,
  actions,
  className,
  children,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <Card className={cn('min-w-0 p-4 sm:p-6', className)}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="font-bold text-slate-900 dark:text-white">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </Card>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed opacity-60')}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-slate-300 transition peer-checked:bg-brand-600 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/20 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4 dark:bg-slate-700 dark:peer-checked:bg-brand-500"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        {description ? <span className="block text-xs text-slate-500 dark:text-slate-400">{description}</span> : null}
      </span>
    </label>
  )
}

/* ───────────── Status messages ───────────── */

const statusStyles: Record<StatusTone, { box: string; icon: ReactNode }> = {
  success: {
    box: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200',
    icon: <CheckCircle2 className="size-4" />,
  },
  error: {
    box: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200',
    icon: <XCircle className="size-4" />,
  },
  warning: {
    box: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200',
    icon: <AlertTriangle className="size-4" />,
  },
  info: {
    box: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200',
    icon: <Info className="size-4" />,
  },
}

export function StatusAlert({ status, onDismiss, className }: { status: Status | null | undefined; onDismiss?: () => void; className?: string }) {
  if (!status) return null
  const style = statusStyles[status.tone]
  return (
    <div
      role={status.tone === 'error' ? 'alert' : 'status'}
      className={cn('animate-fade-in flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm', style.box, className)}
    >
      <span className="mt-0.5 shrink-0">{style.icon}</span>
      <div className="min-w-0 flex-1 break-words">{status.message}</div>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="-mr-1 shrink-0 rounded-md p-0.5 opacity-60 hover:opacity-100" aria-label="Dismiss">
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  )
}

/* ───────────── Name picker with inline "create new" ───────────── */

/**
 * Select for a topic / sub-topic with an inline form to create a new one. `onCreate` should persist it and
 * resolve once the option list contains the new name.
 */
export function NamePicker({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  onCreate,
  createLabel = 'New',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label?: string }[]
  placeholder?: string
  disabled?: boolean
  onCreate?: (name: string, description: string) => Promise<boolean>
  createLabel?: string
}) {
  const id = useId()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!onCreate || !name.trim()) return
    setBusy(true)
    const ok = await onCreate(name.trim(), description.trim())
    setBusy(false)
    if (!ok) return
    onChange(name.trim())
    setCreating(false)
    setName('')
    setDescription('')
  }

  return (
    <Field
      label={label}
      htmlFor={id}
      action={
        onCreate && !creating ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-40 dark:text-brand-400 dark:hover:bg-brand-950/50"
          >
            <Plus className="size-3.5" /> {createLabel}
          </button>
        ) : null
      }
    >
      {creating ? (
        <div className="animate-fade-in space-y-2 rounded-xl border border-dashed border-brand-300 bg-brand-50/40 p-3 dark:border-brand-800 dark:bg-brand-950/20">
          <TextInput
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              } else if (e.key === 'Escape') setCreating(false)
            }}
            placeholder={`New ${label.toLowerCase()} name`}
          />
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional, Vietnamese)" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void submit()} loading={busy} disabled={!name.trim()}>
              <Check className="size-3.5" /> Create
            </Button>
          </div>
        </div>
      ) : (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label ?? option.value}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )
}

/* ───────────── JSON editor ───────────── */

export function JsonEditor({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  const { error } = parseJson(value)
  const invalid = Boolean(value.trim() && error)
  return (
    <div className={cn('overflow-hidden rounded-xl border bg-slate-950 transition', invalid ? 'border-rose-500/70' : 'border-slate-800', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-1.5 text-[11px] font-medium">
        <span className={invalid ? 'truncate text-rose-300' : 'text-slate-400'}>{invalid ? error : value.trim() ? 'Valid JSON' : 'JSON'}</span>
        <button
          type="button"
          disabled={invalid || !value.trim()}
          onClick={() => onChange(JSON.stringify(JSON.parse(value), null, 2))}
          className="rounded px-1.5 py-0.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
        >
          Format
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder={placeholder}
        className="block min-h-[420px] w-full resize-y bg-transparent p-3 font-mono text-xs leading-relaxed text-emerald-200 placeholder:text-slate-600 focus:outline-none"
      />
    </div>
  )
}

/* ───────────── Destructive button with inline confirmation ───────────── */

export function ConfirmDelete({ onConfirm, label = 'Delete', busy }: { onConfirm: () => void; label?: string; busy?: boolean }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(timer)
  }, [armed])

  return armed ? (
    <Button size="sm" variant="danger" loading={busy} onClick={onConfirm}>
      <Trash2 className="size-3.5" /> Confirm
    </Button>
  ) : (
    <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40" onClick={() => setArmed(true)}>
      <Trash2 className="size-3.5" /> {label}
    </Button>
  )
}

export function EditorSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-2" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-[560px]" />
      <Skeleton className="h-[560px]" />
    </div>
  )
}
