import { KeyRound, ServerOff, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { adminNavFor } from '@/components/layout/nav'
import { currentUser, isMultiUser } from '@/features/auth/session'
import { Button, EmptyState, PageHeader, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { getAdminToken, setAdminToken, useTokenRejected } from './api'
import { StatusAlert, TextInput } from './ui'
import type { AdminOutletContext } from './utils'

type Health = { state: 'checking' } | { state: 'offline' } | { state: 'online'; gemini: boolean }

function useServerHealth(): Health {
  const [health, setHealth] = useState<Health>({ state: 'checking' })
  useEffect(() => {
    let cancelled = false
    fetch('/api/health', { cache: 'no-store' })
      .then(async (res) => {
        // Static hosts answer with index.html (or 404) instead of JSON.
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error('offline')
        const body = (await res.json()) as { ok?: boolean; gemini?: boolean }
        if (!body.ok) throw new Error('offline')
        if (!cancelled) setHealth({ state: 'online', gemini: Boolean(body.gemini) })
      })
      .catch(() => !cancelled && setHealth({ state: 'offline' }))
    return () => {
      cancelled = true
    }
  }, [])
  return health
}

function TokenPrompt() {
  const [token, setToken] = useState(getAdminToken)
  return (
    <StatusAlert
      className="mb-6"
      status={{
        tone: 'warning',
        message: (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setAdminToken(token.trim())
            }}
          >
            <span className="mr-1 font-semibold">This server requires an admin token (ADMIN_TOKEN in .env).</span>
            <TextInput
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Admin token"
              autoComplete="off"
              className="h-8 w-56 max-w-full"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!token.trim()}>
              <KeyRound className="size-3.5" /> Save token
            </Button>
            <span className="text-xs opacity-80">Saved in this browser only. Retry your action afterwards.</span>
          </form>
        ),
      }}
    />
  )
}

export default function AdminLayout() {
  const health = useServerHealth()
  const tokenRejected = useTokenRejected()

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="Content editor"
        title="Admin"
        description="Generate entries with Gemini or edit the JSON by hand. Changes are written to content/ and the site rebuilds its data automatically."
      />

      <nav aria-label="Admin sections" className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        {adminNavFor(currentUser()?.role, isMultiUser()).map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition',
                isActive
                  ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/20 dark:bg-brand-500 dark:text-slate-950'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      {health.state === 'checking' ? (
        <div className="grid gap-6 lg:grid-cols-2" aria-busy="true" aria-label="Checking the local server">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : health.state === 'offline' ? (
        <EmptyState
          icon={<ServerOff className="size-10" />}
          title="Admin needs the local server"
          description={
            <>
              The editors write to <code>content/</code> through the local API, which static hosting does not have. Run{' '}
              <code>npm run dev</code> or <code>npm start</code> on your machine and open this page there.
            </>
          }
        />
      ) : (
        <>
          {tokenRejected ? <TokenPrompt /> : null}
          {!health.gemini ? (
            <StatusAlert
              className="mb-6"
              status={{
                tone: 'info',
                message: (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <Sparkles className="size-3.5" /> Generation is off: add <code>GEMINI_API_KEY</code> to <code>.env</code> and restart the
                    server. Loading, editing and saving JSON by hand still works.
                  </span>
                ),
              }}
            />
          ) : null}
          <Outlet context={{ gemini: health.gemini } satisfies AdminOutletContext} />
        </>
      )}
    </div>
  )
}
