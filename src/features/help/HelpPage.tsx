// Multi-user app: the help pages (content/docs), the same pages Nova Agent answers "how do I…" from.
import { LifeBuoy, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link, useParams } from 'react-router'
import { Card, PageHeader } from '@/components/ui'
import { TextInput } from '@/features/admin/ui'

interface DocInfo {
  id: string
  title: string
  routes: string[]
}
interface Doc extends DocInfo {
  body: string
  updated: string
}
interface Hit {
  id: string
  title: string
  section: string
  text: string
}

export default function HelpPage() {
  const { id } = useParams()
  const [docs, setDocs] = useState<DocInfo[]>([])
  const [doc, setDoc] = useState<Doc | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/help')
      .then((r) => r.json())
      .then((b: { docs: DocInfo[] }) => setDocs(b.docs ?? []), () => setError('Không tải được hướng dẫn.'))
  }, [])

  useEffect(() => {
    setDoc(null)
    if (!id) return
    fetch(`/api/help/doc?id=${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error()
        setDoc(((await r.json()) as { doc: Doc }).doc)
      })
      .catch(() => setError('Không có trang hướng dẫn này.'))
  }, [id])

  useEffect(() => {
    if (!query.trim()) return setHits(null)
    const t = setTimeout(() => {
      fetch(`/api/help?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((b: { hits: Hit[] }) => setHits(b.hits ?? []), () => {})
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader eyebrow="Help" title="Hướng dẫn" description="Cách dùng từng tính năng. Bạn cũng có thể hỏi Nova Agent (nút tròn góc dưới) “làm sao để…”." />
      <label className="relative mb-5 block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <TextInput className="pl-9" placeholder="Tìm: ghi âm, hạn mức, thêm từ…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {error ? <p className="mb-4 text-sm text-rose-700">{error}</p> : null}

      {hits ? (
        <div className="space-y-3">
          {hits.length ? null : <p className="text-sm text-slate-500">Không thấy mục nào. Thử từ khác hoặc hỏi Nova.</p>}
          {hits.map((h, i) => (
            <Card key={i} className="p-4">
              <Link to={`/help/${h.id}`} onClick={() => setQuery('')} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                {h.title} · {h.section}
              </Link>
              <p className="mt-1 line-clamp-3 text-sm whitespace-pre-line text-slate-600 dark:text-slate-300">{h.text}</p>
            </Card>
          ))}
        </div>
      ) : doc ? (
        <Card className="p-5 sm:p-7">
          <article className="prose prose-slate max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.body}</ReactMarkdown>
          </article>
          {doc.routes.filter((r) => r !== '/').length ? (
            <p className="mt-5 flex flex-wrap gap-2 text-sm">
              {doc.routes
                .filter((r) => r !== '/' && !r.startsWith('/register'))
                .map((r) => (
                  <Link key={r} to={r} className="rounded-lg bg-brand-50 px-2 py-1 font-semibold text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300">
                    Mở {r}
                  </Link>
                ))}
            </p>
          ) : null}
          <p className="mt-4 text-xs text-slate-400">Cập nhật {doc.updated}</p>
        </Card>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {docs.map((d) => (
            <li key={d.id}>
              <Link to={`/help/${d.id}`} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold hover:border-brand-300 dark:border-slate-800 dark:bg-slate-900">
                <LifeBuoy className="size-4 shrink-0 text-brand-600" />
                {d.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
