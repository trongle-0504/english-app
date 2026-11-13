import { ImageOff, Search, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { adminApi, refreshSiteData } from './api'
import { Panel, TextInput } from './ui'

export interface ImageCandidate {
  provider: 'pixabay' | 'wikipedia' | 'openverse'
  thumb: string
  url: string
  title: string
  credit: string
  source: string
}

const PROVIDER_TONE = { pixabay: 'emerald', wikipedia: 'slate', openverse: 'sky' } as const

/**
 * Picture of the loaded word (remount with a `key` per word to reset it): the current one, a search box (prefilled with Gemini's scene description) and a grid of
 * candidates from Pixabay, Wikipedia and Openverse. Clicking one downloads it into the app and saves it on the word.
 */
export function ImagePicker({
  word,
  image,
  credit,
  initialQuery,
  initialCandidates,
  autoSearch = false,
  searchEndpoint = 'vocabulary/images',
  saveEndpoint = 'vocabulary/image',
  itemKey = 'word',
  refreshResource = 'vocabulary',
  title,
  description,
  onSaved,
}: {
  word: string
  image?: string
  credit?: string
  initialQuery?: string
  initialCandidates?: ImageCandidate[]
  /** Search with `initialQuery` as soon as the picker opens (a freshly generated item). */
  autoSearch?: boolean
  searchEndpoint?: string
  saveEndpoint?: string
  itemKey?: string
  refreshResource?: 'vocabulary' | 'notes'
  title?: string
  description?: string
  onSaved: (entry: any) => void
}) {
  const [query, setQuery] = useState(initialQuery || word)
  const [candidates, setCandidates] = useState<ImageCandidate[]>(initialCandidates ?? [])
  const [pending, setPending] = useState<string>('')
  const [error, setError] = useState('')

  const search = async () => {
    setPending('search')
    setError('')
    try {
      const res = await adminApi<{ candidates: ImageCandidate[]; errors: string[] }>(searchEndpoint, { query: { q: query } })
      setCandidates(res.candidates)
      if (!res.candidates.length) setError(res.errors.length ? res.errors.join(' · ') : 'Không tìm thấy ảnh — thử mô tả cảnh khác.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending('')
    }
  }

  // A freshly generated item: load the full list of candidates (its picture is stored in the background).
  useEffect(() => {
    if (autoSearch && !initialCandidates?.length && query.trim()) void search()
    // Once per mount: the picker is remounted (key) for each item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async (body: Record<string, unknown>, key: string) => {
    setPending(key)
    setError('')
    try {
      const res = await adminApi<{ entry?: { word: string; [key: string]: unknown }; note?: { id: string; [key: string]: unknown } }>(saveEndpoint, {
        method: 'POST',
        body: { [itemKey]: word, ...body },
      })
      refreshSiteData(refreshResource === 'notes' ? 'notes.json' : refreshResource, 'review')
      onSaved(res.note ?? res.entry)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending('')
    }
  }

  return (
    <Panel
      icon={<Search className="size-4.5" />}
      title={title || `Picture · ${word}`}
      description={description || "Tìm bằng một cảnh thể hiện nghĩa (không phải chính từ). Bấm một ảnh để tải về và lưu cho mục này."}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {image ? (
            <img src={image} alt={word} className="size-20 shrink-0 rounded-xl object-cover" />
          ) : (
            <span className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-300 dark:bg-slate-800">
              <ImageOff className="size-6" />
            </span>
          )}
          <div className="min-w-0 flex-1 text-xs text-slate-500">
            {image ? <p>Ảnh hiện tại{credit ? ` · ${credit}` : ''}</p> : <p>Chưa có ảnh.</p>}
            {image ? (
              <Button size="sm" variant="ghost" className="mt-1" loading={pending === 'remove'} disabled={Boolean(pending)} onClick={() => void save({ remove: true }, 'remove')}>
                <Trash2 className="size-3.5" /> Bỏ ảnh
              </Button>
            ) : null}
          </div>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void search()
          }}
        >
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="person climbing mountain summit success" />
          <Button type="submit" variant="outline" loading={pending === 'search'} disabled={!query.trim() || Boolean(pending)}>
            <Search className="size-4" /> Tìm
          </Button>
        </form>
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
        {candidates.length ? (
          <div className="grid grid-cols-3 gap-2">
            {candidates.map((c) => {
              const busy = pending === c.url
              return (
                <button
                  key={c.url}
                  type="button"
                  disabled={Boolean(pending)}
                  onClick={() => void save({ url: c.url, credit: c.credit, source: c.source }, c.url)}
                  title={`${c.title}\n${c.credit}`}
                  className={cn('group relative overflow-hidden rounded-xl text-left ring-brand-500 focus:outline-none focus-visible:ring-2', busy && 'ring-2')}
                >
                  <img src={c.thumb} alt={c.title} loading="lazy" referrerPolicy="no-referrer" className="aspect-[4/3] w-full bg-slate-100 object-cover transition-transform group-hover:scale-105 dark:bg-slate-800" />
                  <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-4 pb-1">
                    <Badge tone={PROVIDER_TONE[c.provider]} className="px-1.5 py-0 text-[9px]">
                      {c.provider}
                    </Badge>
                    <span className="truncate text-[10px] text-white/90">{c.credit.split(' · ').slice(1).join(' · ')}</span>
                  </span>
                  {busy ? <span className="absolute inset-0 flex items-center justify-center bg-white/60 text-xs font-semibold dark:bg-black/50">Đang lưu…</span> : null}
                </button>
              )
            })}
          </div>
        ) : null}
        <p className="text-[11px] text-slate-400">
          Ảnh từ Pixabay, Wikipedia và Openverse — nguồn ghi dưới mỗi ảnh.
        </p>
      </div>
    </Panel>
  )
}
