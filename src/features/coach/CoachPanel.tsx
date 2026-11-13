// The Coach chat: a right-hand drawer on desktop (the page stays usable), full screen on phones.
// A question starts a turn on the server; the panel polls it and shows the steps and the answer as they grow.
import { ArrowLeft, ArrowUp, Check, History, Loader2, Plus, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation } from 'react-router'
import { cn } from '@/lib/cn'
import type { CoachProposal, CoachSession, CoachSessionSummary, CoachTurn } from '@/types/coach'
import * as api from './api'
import { CoachMarkdown } from './CoachMarkdown'
import { ProposalCard } from './ProposalCard'
import { suggestionsFor } from './suggestions'

const SESSION_KEY = 'coach:session'
const POLL_MS = 700

const readStored = () => {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}
const store = (id: string | null) => {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id)
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // Private mode: the chat just does not reopen next time.
  }
}

const isOpenTurn = (t: CoachTurn) => t.status === 'queued' || t.status === 'running'

function formatTokens(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function TurnDetails({ turn }: { turn: CoachTurn }) {
  const [open, setOpen] = useState(false)
  if (isOpenTurn(turn) || (!turn.usage && !turn.ms)) return null
  const u = turn.usage
  return (
    <div className="mt-1.5 text-[11px] text-slate-400">
      <button type="button" onClick={() => setOpen((o) => !o)} className="hover:text-slate-600 dark:hover:text-slate-300">
        {open ? 'Hide details' : 'Details'}
      </button>
      {open ? (
        <span className="ml-2 tabular-nums">
          {u ? `${formatTokens(u.total)} tokens (in ${formatTokens(u.input)} · out ${formatTokens(u.output)}${u.thinking ? ` · thinking ${formatTokens(u.thinking)}` : ''}) · ` : ''}
          {turn.toolCalls ?? 0} {turn.toolCalls === 1 ? 'tool' : 'tools'} · {((turn.ms ?? 0) / 1000).toFixed(1)} s
        </span>
      ) : null}
    </div>
  )
}

function TurnView({
  turn,
  sessionId,
  onNavigate,
  onProposal,
}: {
  turn: CoachTurn
  sessionId: string
  onNavigate: () => void
  onProposal: (turnId: string, p: CoachProposal) => void
}) {
  const waiting = isOpenTurn(turn)
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm whitespace-pre-wrap text-white dark:bg-brand-500">{turn.question}</p>
      </div>
      <div className="max-w-[95%]">
        {turn.steps.length ? (
          <ul className="mb-1.5 space-y-1">
            {turn.steps.map((s) => (
              <li key={s.id} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                {s.status === 'running' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : s.status === 'done' ? (
                  <Check className="size-3.5 text-emerald-500" />
                ) : (
                  <X className="size-3.5 text-rose-500" />
                )}
                {s.label}
              </li>
            ))}
          </ul>
        ) : null}
        {turn.answer ? (
          <CoachMarkdown text={turn.answer} onNavigate={onNavigate} />
        ) : waiting ? (
          <p className="flex items-center gap-1.5 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> {turn.status === 'queued' ? 'Waiting for Nova Agent…' : 'Thinking…'}
          </p>
        ) : null}
        {turn.proposals?.map((p) => <ProposalCard key={p.id} sessionId={sessionId} proposal={p} onNavigate={onNavigate} onChange={(next) => onProposal(turn.id, next)} />)}
        {turn.status === 'cancelled' ? <p className="mt-1 text-xs text-slate-400">Stopped.</p> : null}
        {turn.status === 'error' ? <p className="mt-1 text-sm text-rose-600 dark:text-rose-400">{turn.error || 'Something went wrong — try again.'}</p> : null}
        <TurnDetails turn={turn} />
      </div>
    </div>
  )
}

export default function CoachPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation()
  const [sessionId, setSessionId] = useState<string | null>(readStored)
  const [session, setSession] = useState<CoachSession | null>(null)
  const [view, setView] = useState<'chat' | 'history'>('chat')
  const [history, setHistory] = useState<CoachSessionSummary[] | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  const active = session?.turns.find(isOpenTurn) ?? null

  // Load the remembered chat once.
  useEffect(() => {
    if (!sessionId || session?.id === sessionId) return
    let live = true
    api
      .getSession(sessionId)
      .then((s) => live && setSession(s))
      .catch(() => {
        if (!live) return
        setSessionId(null)
        store(null)
      })
    return () => {
      live = false
    }
  }, [sessionId, session?.id])

  // Poll the running turn.
  const activeId = active?.id
  const activeSession = session?.id
  useEffect(() => {
    if (!activeId || !activeSession) return
    let stopped = false
    const timer = setInterval(() => {
      api
        .pollTurn(activeSession, activeId)
        .then((poll) => {
          if (stopped) return
          setSession((s) => (s && s.id === poll.sessionId ? { ...s, turns: s.turns.map((t) => (t.id === poll.turn.id ? poll.turn : t)) } : s))
        })
        .catch(() => {})
    }, POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [activeId, activeSession])

  // Follow the newest text.
  const lastAnswer = session?.turns.at(-1)?.answer.length ?? 0
  const lastSteps = session?.turns.at(-1)?.steps.length ?? 0
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [lastAnswer, lastSteps, session?.turns.length, open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    if (window.matchMedia('(min-width: 768px)').matches) input.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const send = async (question: string) => {
    const q = question.trim()
    if (!q || sending || active) return
    setSending(true)
    setError('')
    setView('chat')
    try {
      let id = session?.id ?? null
      if (!id) {
        id = await api.createSession()
        setSessionId(id)
        store(id)
      }
      const turnId = await api.startTurn(id, q, `${location.pathname}${location.search}`)
      const turn: CoachTurn = { id: turnId, at: new Date().toISOString(), question: q, answer: '', steps: [], status: 'queued' }
      setSession((s) =>
        s && s.id === id
          ? { ...s, turns: [...s.turns, turn] }
          : { version: 1, id: id!, title: q.slice(0, 60), model: '', createdAt: turn.at, updatedAt: turn.at, turns: [turn] },
      )
      setText('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  const onProposal = (turnId: string, next: CoachProposal) =>
    setSession((s) => (s ? { ...s, turns: s.turns.map((t) => (t.id === turnId ? { ...t, proposals: t.proposals?.map((p) => (p.id === next.id ? next : p)) } : t)) } : s))

  const stop = () => {
    if (session && active) void api.cancelTurn(session.id, active.id).catch(() => {})
  }

  const newChat = () => {
    setSession(null)
    setSessionId(null)
    store(null)
    setView('chat')
    setError('')
  }

  const openHistory = () => {
    setView('history')
    setHistory(null)
    api
      .listSessions()
      .then(setHistory)
      .catch((err: Error) => setError(err.message))
  }

  const pick = (id: string) => {
    setSession(null)
    setSessionId(id)
    store(id)
    setView('chat')
  }

  const remove = async (id: string) => {
    if (!window.confirm('Delete this chat?')) return
    await api.deleteSession(id).catch(() => {})
    setHistory((h) => h?.filter((x) => x.id !== id) ?? null)
    if (id === session?.id) newChat()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(text)
    }
  }

  // Phones: an app link closes the sheet so the page is visible.
  const onNavigate = () => {
    if (!window.matchMedia('(min-width: 768px)').matches) onClose()
  }

  return (
    <div
      role="dialog"
      aria-label="Nova Agent"
      aria-hidden={!open}
      className={cn(
        'fixed z-50 flex flex-col bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100',
        'inset-0 md:inset-auto md:top-20 md:right-4 md:bottom-4 md:w-[420px] md:rounded-2xl md:border md:border-slate-200 md:shadow-2xl md:dark:border-slate-700',
        !open && 'hidden',
      )}
    >
      <header className="flex items-center gap-1 border-b border-slate-100 px-2 py-2 dark:border-slate-800">
        {view === 'history' ? (
          <button type="button" aria-label="Back to the chat" onClick={() => setView('chat')} className="flex size-10 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
            <ArrowLeft className="size-5" />
          </button>
        ) : (
          <span className="ml-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/30">
            <Sparkles className="size-[18px]" />
          </span>
        )}
        {view === 'history' ? (
          <h2 className="min-w-0 flex-1 truncate font-bold">Chats</h2>
        ) : (
          <div className="ml-1.5 min-w-0 flex-1 leading-tight">
            <h2 className="truncate font-bold tracking-tight">Nova Agent</h2>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">AI study coach</p>
          </div>
        )}
        {view === 'chat' ? (
          <>
            <button type="button" aria-label="New chat" title="New chat" onClick={newChat} className="flex size-10 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
              <Plus className="size-5" />
            </button>
            <button type="button" aria-label="Past chats" title="Past chats" onClick={openHistory} className="flex size-10 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
              <History className="size-5" />
            </button>
          </>
        ) : null}
        <button type="button" aria-label="Close" onClick={onClose} className="flex size-10 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
          <X className="size-5" />
        </button>
      </header>

      {view === 'history' ? (
        <div className="flex-1 overflow-y-auto p-2">
          {!history ? <Loader2 className="m-4 size-5 animate-spin text-slate-400" /> : null}
          {history && !history.length ? <p className="p-4 text-sm text-slate-500">No chats yet.</p> : null}
          <ul>
            {history?.map((h) => (
              <li key={h.id} className="flex items-center gap-1 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <button type="button" onClick={() => pick(h.id)} className="min-w-0 flex-1 px-3 py-2.5 text-left">
                  <span className="block truncate text-sm font-medium">{h.title}</span>
                  <span className="block text-xs text-slate-400">
                    {new Date(h.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {h.turns} {h.turns === 1 ? 'question' : 'questions'}
                  </span>
                </button>
                <button type="button" aria-label="Delete chat" onClick={() => void remove(h.id)} className="flex size-10 shrink-0 items-center justify-center rounded-full text-slate-400 hover:text-rose-600">
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <p className="px-3 py-2 text-xs text-slate-400">Chats are kept for 30 days.</p>
        </div>
      ) : (
        <>
          <div ref={scroller} className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
            {!session?.turns.length ? (
              <div className="space-y-3 px-1 pt-2">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Ask about your essays, recordings, mistakes, plan or flashcards. Nova Agent answers from your own data in the app.
                </p>
                <div className="flex flex-col items-start gap-2">
                  {suggestionsFor(location.pathname, location.search).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="rounded-2xl border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:border-brand-300 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              session.turns.map((t) => <TurnView key={t.id} turn={t} sessionId={session.id} onNavigate={onNavigate} onProposal={onProposal} />)
            )}
          </div>
          {error ? <p className="px-4 pb-1 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
          <form
            className="flex items-end gap-2 border-t border-slate-100 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] dark:border-slate-800"
            onSubmit={(e) => {
              e.preventDefault()
              void send(text)
            }}
          >
            <textarea
              ref={input}
              rows={1}
              value={text}
              maxLength={8000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask Nova Agent…"
              className="field-sizing-content max-h-36 min-h-11 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-base focus:border-brand-500 focus:bg-white focus:outline-none sm:text-sm dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-900"
            />
            {active ? (
              <button type="button" aria-label="Stop" onClick={stop} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-white">
                <Square className="size-4 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Send"
                disabled={!text.trim() || sending}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white disabled:opacity-40 dark:bg-brand-500"
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-5" />}
              </button>
            )}
          </form>
        </>
      )}
    </div>
  )
}
