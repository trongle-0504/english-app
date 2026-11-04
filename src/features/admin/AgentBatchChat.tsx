import { Bot, Check, Loader2, Send, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, Card } from '@/components/ui'
import { adminApi } from './api'
import { TextArea } from './ui'

interface Item {
  term: string
  context: string
}
interface Batch {
  id: string
  destination: 'note' | 'vocab'
  status: string
  items: Array<Item & { status: string; error?: string }>
}

export function AgentBatchChat() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<{ destination: 'note' | 'vocab'; items: Item[] }>()
  const [batch, setBatch] = useState<Batch>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!batch || batch.status === 'completed') return
    const timer = window.setInterval(async () => {
      try {
        const next = await adminApi<{ batch: Batch }>('agent/batches/item', { query: { id: batch.id } })
        setBatch(next.batch)
      } catch (cause) {
        setError((cause as Error).message)
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [batch])

  const prepare = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await adminApi<{ destination: 'note' | 'vocab'; items: Item[] }>('agent/prepare', { method: 'POST', body: { message } })
      setPreview(result)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      const result = await adminApi<{ batch: Batch }>('agent/batches', { method: 'POST', body: preview })
      setBatch(result.batch)
      setPreview(undefined)
      setMessage('')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button className="fixed right-4 bottom-4 z-40 rounded-full shadow-lg" onClick={() => setOpen(true)}>
        <Bot className="size-4" /> Batch agent
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-slate-950/20 p-4 sm:items-center">
          <Card className="max-h-[90vh] w-full max-w-xl overflow-auto p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Vocabulary & Note agent</h2>
                <p className="text-sm text-slate-500">Dùng đúng một command: /note hoặc /vocab</p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label="Close"><X className="size-4" /></Button>
            </div>
            <TextArea rows={8} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={'/note\n\n1. coin a term\nWhen a new idea needs a name...'} disabled={Boolean(preview || batch)} />
            {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
            {!preview && !batch ? <Button className="mt-3" onClick={() => void prepare()} disabled={busy || !message.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Prepare preview</Button> : null}
            {preview ? (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2"><Badge tone="brand">/{preview.destination}</Badge><span className="text-sm">{preview.items.length} mục sẽ được thêm</span></div>
                <ul className="space-y-2 text-sm">{preview.items.map((item) => <li key={item.term} className="rounded-lg border p-2"><strong>{item.term}</strong><span className="block text-slate-500">{item.context}</span></li>)}</ul>
                <div className="flex gap-2"><Button onClick={() => void start()} disabled={busy}><Check className="size-4" /> Confirm and run</Button><Button variant="outline" onClick={() => setPreview(undefined)}>Edit</Button></div>
              </div>
            ) : null}
            {batch ? (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2"><Badge tone={batch.status === 'completed' ? 'emerald' : 'brand'}>{batch.status}</Badge><span className="text-sm">{batch.items.filter((i) => i.status === 'done').length} done · {batch.items.filter((i) => i.status === 'skipped').length} skipped · {batch.items.filter((i) => i.status === 'error').length} errors</span></div>
                <ul className="space-y-1 text-sm">{batch.items.map((item) => <li key={item.term} className="flex justify-between gap-2"><span>{item.term}</span><span className={item.status === 'error' ? 'text-rose-600' : 'text-slate-500'}>{item.error || item.status}</span></li>)}</ul>
                {batch.status === 'completed' ? <Button variant="outline" onClick={() => setBatch(undefined)}>New batch</Button> : null}
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}
    </>
  )
}
