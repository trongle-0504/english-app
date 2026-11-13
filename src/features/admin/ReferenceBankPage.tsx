// Multi-user app: the shared vocabulary bank. Browse it and add a word to your own library (copied, no AI used).
import { Check, Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card } from '@/components/ui'
import { Select, TextInput } from './ui'

interface Word {
  word: string
  meaning_vi: string
  example: string
  image: string
  topic: string
  mine: boolean
}

export default function ReferenceBankPage() {
  const [words, setWords] = useState<Word[]>([])
  const [topics, setTopics] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/reference/words?q=${encodeURIComponent(q)}&topic=${encodeURIComponent(topic)}`)
        .then((r) => r.json())
        .then((b: { words: Word[]; topics: string[]; total: number }) => {
          setWords(b.words ?? [])
          setTopics(b.topics ?? [])
          setTotal(b.total ?? 0)
        }, () => setError('Không tải được kho từ.'))
    }, 200)
    return () => clearTimeout(t)
  }, [q, topic])

  const adopt = async (word: string) => {
    setBusy(word)
    setError('')
    const res = await fetch('/api/reference/adopt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ word }) })
    setBusy('')
    if (!res.ok) return setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Không thêm được.')
    setWords((list) => list.map((w) => (w.word === word ? { ...w, mine: true } : w)))
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Kho từ chung có {total} mục (nghĩa, collocation, ví dụ, hình). Bấm <strong>Thêm</strong> để chép một từ vào thư viện của bạn; từ đó sẽ xuất hiện ở Topic Vocabulary và trong ôn tập. Không tốn lượt AI.
      </p>
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <TextInput className="pl-9" placeholder="Tìm từ hoặc nghĩa" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Select value={topic} onChange={(e) => setTopic(e.target.value)} className="w-56">
          <option value="">Mọi chủ đề</option>
          {topics.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
      </div>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <ul className="grid gap-2 sm:grid-cols-2">
        {words.map((w) => (
          <Card key={w.word} className="flex items-start gap-3 p-3">
            {w.image ? <img src={w.image} alt="" loading="lazy" className="size-14 shrink-0 rounded-lg object-cover" /> : null}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{w.word}</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">{w.meaning_vi}</p>
              {w.example ? <p className="mt-0.5 text-xs text-slate-500 italic">{w.example}</p> : null}
              <p className="mt-0.5 text-xs text-slate-400">{w.topic}</p>
            </div>
            {w.mine ? (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                <Check className="size-4" /> Đã có
              </span>
            ) : (
              <Button size="sm" variant="secondary" loading={busy === w.word} onClick={() => void adopt(w.word)}>
                <Plus className="size-4" /> Thêm
              </Button>
            )}
          </Card>
        ))}
      </ul>
    </div>
  )
}
