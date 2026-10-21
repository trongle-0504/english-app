import { FilePlus2, ListPlus, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Card, EmptyState, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { ReviewCard, ReviewCardInput, ReviewDeck } from '@/types/content'
import { reviewApi } from './api'
import { CardBack } from './CardView'
import { JsonImport } from './JsonImport'

type Panel = 'form' | 'gemini' | 'import' | 'json'

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-900'

function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-slate-400">{hint}</span> : null}
    </label>
  )
}

function Status({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null
  return (
    <p role="status" className={cn('rounded-xl px-3 py-2 text-sm', message.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200')}>
      {message.text}
    </p>
  )
}

const list = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean)
const lines = (text: string) => text.split('\n').map((s) => s.trim()).filter(Boolean)

/** Every field of review_card_schema.json; only the term is required. */
function CardForm({ deck }: { deck: string }) {
  const empty = { term: '', pronunciation: '', pos: '', meaning_vi: '', meaning_en: '', examples: '', collocations: '', synonyms: '', antonyms: '', usage: '', mnemonic: '', tags: '' }
  const [f, setF] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const bind = (key: keyof typeof empty) => ({ value: f[key], onChange: (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value }) })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const card: ReviewCardInput = {
      term: f.term.trim(),
      pronunciation: f.pronunciation.trim() || undefined,
      part_of_speech: list(f.pos),
      meaning_vi: f.meaning_vi.trim() || undefined,
      meaning_en: f.meaning_en.trim() || undefined,
      examples: lines(f.examples).map((l) => {
        const [en, vi] = l.split('|').map((s) => s.trim())
        return { en, vi: vi || undefined }
      }),
      collocations: lines(f.collocations).map((l) => {
        const [text, meaning_vi, example] = l.split('|').map((s) => s.trim())
        return { text, meaning_vi: meaning_vi || undefined, example: example || undefined }
      }),
      synonyms: list(f.synonyms),
      antonyms: list(f.antonyms),
      usage_note_vi: f.usage.trim() || undefined,
      mnemonic_vi: f.mnemonic.trim() || undefined,
      tags: list(f.tags),
    }
    setBusy(true)
    setMessage(null)
    try {
      await reviewApi.saveCard(deck, card)
      setF(empty)
      setMessage({ ok: true, text: `Saved “${card.term}” and added it to your reviews.` })
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Field label="Term *" hint="Word, phrase, collocation or structure">
        <input required className={inputClass} placeholder="trustworthy" {...bind('term')} />
      </Field>
      <Field label="Pronunciation" hint="British IPA, e.g. /ˈtrʌstwɜːði/">
        <input className={cn(inputClass, 'ipa')} {...bind('pronunciation')} />
      </Field>
      <Field label="Meaning (Vietnamese)" className="sm:col-span-2">
        <textarea rows={2} className={inputClass} placeholder="đáng tin cậy" {...bind('meaning_vi')} />
      </Field>
      <Field label="Part of speech" hint="Comma separated">
        <input className={inputClass} placeholder="adjective" {...bind('pos')} />
      </Field>
      <Field label="Meaning (English)">
        <input className={inputClass} {...bind('meaning_en')} />
      </Field>
      <Field label="Examples" hint="One per line: English | Vietnamese (translation optional). **bold** the term." className="sm:col-span-2">
        <textarea rows={3} className={inputClass} placeholder="She is a **trustworthy** colleague. | Cô ấy là một đồng nghiệp đáng tin cậy." {...bind('examples')} />
      </Field>
      <Field label="Collocations" hint="One per line: collocation | meaning | example" className="sm:col-span-2">
        <textarea rows={2} className={inputClass} placeholder="a trustworthy source | nguồn đáng tin cậy | Always cite a trustworthy source." {...bind('collocations')} />
      </Field>
      <Field label="Synonyms" hint="Comma separated">
        <input className={inputClass} {...bind('synonyms')} />
      </Field>
      <Field label="Antonyms" hint="Comma separated">
        <input className={inputClass} {...bind('antonyms')} />
      </Field>
      <Field label="Usage note (Vietnamese)">
        <textarea rows={2} className={inputClass} {...bind('usage')} />
      </Field>
      <Field label="Memory trick (Vietnamese)">
        <textarea rows={2} className={inputClass} {...bind('mnemonic')} />
      </Field>
      <Field label="Tags" hint="Comma separated" className="sm:col-span-2">
        <input className={inputClass} placeholder="IELTS Writing, environment" {...bind('tags')} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={busy}>
          <FilePlus2 className="size-4" /> Save card
        </Button>
        <Status message={message} />
      </div>
    </form>
  )
}

function GeminiForm({ deck }: { deck: string }) {
  const [term, setTerm] = useState('')
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [preview, setPreview] = useState<ReviewCard | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const { card, saved } = await reviewApi.generateCard(deck, term.trim(), hint.trim() || undefined)
      setPreview({
        id: saved[0],
        source: 'custom',
        term: card.term,
        pronunciation: card.pronunciation,
        part_of_speech: card.part_of_speech ?? [],
        meaning_vi: card.meaning_vi ?? '',
        meaning_en: card.meaning_en,
        examples: (card.examples ?? []).map((x) => (typeof x === 'string' ? { en: x } : x)),
        collocations: card.collocations ?? [],
        synonyms: card.synonyms ?? [],
        antonyms: card.antonyms ?? [],
        usage_note_vi: card.usage_note_vi,
        mnemonic_vi: card.mnemonic_vi,
        tags: card.tags ?? [],
        origin: deck,
      })
      setMessage({ ok: true, text: `Created “${card.term}” and added it to your reviews. Edit it in content/review/ if needed.` })
      setTerm('')
      setHint('')
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Term *">
          <input required value={term} onChange={(e) => setTerm(e.target.value)} className={inputClass} placeholder="be on the verge of" />
        </Field>
        <Field label="Your note (optional)" hint="Meaning or context Gemini should follow">
          <input value={hint} onChange={(e) => setHint(e.target.value)} className={inputClass} placeholder="sắp sửa, trên bờ vực" />
        </Field>
        <Button type="submit" loading={busy} className="sm:mb-5">
          <Sparkles className="size-4" /> Generate
        </Button>
      </form>
      <Status message={message} />
      {preview ? (
        <Card className="p-4 sm:p-5">
          <p className="mb-3 text-xl font-bold text-slate-900 dark:text-white">
            {preview.term} {preview.pronunciation ? <span className="ipa text-base font-normal text-slate-500">{preview.pronunciation}</span> : null}
          </p>
          <CardBack card={preview} />
        </Card>
      ) : null}
    </div>
  )
}

function ImportForm({ deck }: { deck: string }) {
  const [text, setText] = useState('')
  const [fill, setFill] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const result = await reviewApi.importCards(deck, text, fill)
      setMessage({
        ok: true,
        text: `Imported ${result.saved.length} card(s)${result.skipped.length ? `; skipped ${result.skipped.length} already in the deck (${result.skipped.slice(0, 5).join(', ')}${result.skipped.length > 5 ? '…' : ''})` : ''}.`,
      })
      setText('')
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Paste your list" hint="One card per line: term — meaning (meaning optional). Or paste a JSON array of cards in the schema format.">
        <textarea
          required
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={cn(inputClass, 'font-mono text-[13px]')}
          placeholder={'trustworthy — đáng tin cậy\ntake something for granted — coi điều gì là hiển nhiên\nbe on the verge of'}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} className="size-4 rounded accent-brand-600" />
        Fill missing pronunciation, meanings and examples with Gemini (15 terms per request)
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy}>
          <ListPlus className="size-4" /> Import
        </Button>
        <Status message={message} />
      </div>
    </form>
  )
}

/** Your own decks (content/review/*.json): add cards by hand, with Gemini, by pasting a list or schema JSON. */
export function MyCards({ decks, cardsById }: { decks: ReviewDeck[]; cardsById: ReadonlyMap<string, ReviewCard> }) {
  const custom = useMemo(() => decks.filter((d) => d.source === 'custom'), [decks])
  const [deckName, setDeckName] = useState(custom[0]?.name ?? 'My words')
  const [panel, setPanel] = useState<Panel>('json')
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = custom.find((d) => d.name === deckName)
  // Card keys already in the chosen deck (custom:<deck>:<key>), so pasted duplicates can be flagged.
  const existing = useMemo(() => new Set((current?.cardIds ?? []).map((id) => id.split(':').slice(2).join(':'))), [current])

  const remove = async (card: ReviewCard) => {
    if (removing !== card.id) return setRemoving(card.id)
    const [, deck, key] = card.id.split(':')
    try {
      await reviewApi.deleteCard(deck, key)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Deck" hint="Saved as content/review/<deck>.json — type a new name to create a deck" className="min-w-56 flex-1">
            <input list="custom-decks" value={deckName} onChange={(e) => setDeckName(e.target.value)} className={inputClass} />
            <datalist id="custom-decks">
              {custom.map((d) => (
                <option key={d.id} value={d.name} />
              ))}
            </datalist>
          </Field>
          <SegmentedControl
            value={panel}
            onChange={setPanel}
            options={[
              { value: 'json', label: 'Paste JSON' },
              { value: 'form', label: 'Add card' },
              { value: 'gemini', label: 'With Gemini' },
              { value: 'import', label: 'Import list' },
            ]}
          />
        </div>
        {panel === 'form' ? (
          <CardForm deck={deckName} />
        ) : panel === 'gemini' ? (
          <GeminiForm deck={deckName} />
        ) : panel === 'json' ? (
          <JsonImport deck={deckName} existing={existing} />
        ) : (
          <ImportForm deck={deckName} />
        )}
      </Card>

      <aside className="space-y-3">
        <h3 className="text-[11px] font-bold tracking-[0.16em] text-slate-400 uppercase">
          {current ? `${current.name} · ${current.cardIds.length} cards` : 'New deck'}
        </h3>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        {current?.cardIds.length ? (
          <ul className="scrollbar-thin max-h-[32rem] space-y-1 overflow-y-auto">
            {current.cardIds.map((id) => {
              const card = cardsById.get(id)
              if (!card) return null
              return (
                <li key={id} className="group flex items-start gap-2 rounded-xl px-3 py-2 hover:bg-white dark:hover:bg-slate-900">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{card.term}</p>
                    <p className="truncate text-xs text-slate-500">{card.meaning_vi || '—'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void remove(card)}
                    onBlur={() => setRemoving(null)}
                    className={cn(
                      'relative shrink-0 hit-area rounded-lg p-1.5 text-xs transition-colors',
                      removing === id ? 'bg-rose-600 px-2 text-white' : 'text-slate-400 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600 pointer-fine:focus:opacity-100',
                    )}
                    aria-label={`Delete ${card.term}`}
                  >
                    {removing === id ? 'Delete?' : <Trash2 className="size-3.5" />}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyState title="No cards yet" description="Cards you add here go straight into your reviews." />
        )}
      </aside>
    </div>
  )
}
