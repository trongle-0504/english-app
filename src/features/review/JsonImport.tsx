import { AlertTriangle, Check, ChevronDown, ClipboardCopy, FileJson, Sparkles, XCircle } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { slugify } from '@/lib/text'
import type { ReviewCardInput } from '@/types/content'
import { reviewApi } from './api'

/** Same limit as POST /api/review/custom/import. */
const MAX_CARDS = 300

/** The simple card shape offered here: a subset of review_card_schema.json (other fields are ignored). */
const TEMPLATE: ReviewCardInput[] = [
  {
    term: 'trustworthy',
    pronunciation: '/ˈtrʌstwɜːði/',
    part_of_speech: ['adjective'],
    meaning_vi: 'đáng tin cậy',
    examples: [{ en: 'She is a **trustworthy** colleague.', vi: 'Cô ấy là một đồng nghiệp đáng tin cậy.' }],
    collocations: [{ text: 'a trustworthy source', meaning_vi: 'nguồn đáng tin cậy', example: 'Always cite a **trustworthy source**.' }],
  },
]
const TEMPLATE_TEXT = JSON.stringify(TEMPLATE, null, 2)

const FIELDS: { name: string; type: string; note: string; required?: boolean }[] = [
  { name: 'term', type: 'text', note: 'The English word, phrase or structure.', required: true },
  { name: 'pronunciation', type: 'text', note: 'British IPA between slashes: /ˈtrʌstwɜːði/' },
  { name: 'part_of_speech', type: 'list of text', note: '["adjective"], ["noun", "verb"], ["adjective + noun"]' },
  { name: 'meaning_vi', type: 'text', note: 'Vietnamese meaning. Several senses: one per line, numbered.' },
  { name: 'examples', type: 'list', note: '{ "en": "…**term**…", "vi": "…" } — bold the term with **…**; "vi" is optional.' },
  { name: 'collocations', type: 'list', note: '{ "text": "…", "meaning_vi": "…", "example": "…" } — only "text" is needed.' },
]

const AI_PROMPT = `Create English vocabulary study cards for a Vietnamese IELTS learner (band 6.0–7.5) for these words:
<paste your words here, one per line>

Reply with ONLY a JSON array (no explanation), one object per word, in exactly this format.
Only "term" is required; leave out any field you are unsure of.
Use only these fields: term, pronunciation, part_of_speech, meaning_vi, examples, collocations.
Rules: "pronunciation" is British IPA between slashes; "meaning_vi" is in Vietnamese;
2 natural example sentences per word with the word in **bold** and a Vietnamese translation in "vi";
up to 3 common collocations, each with "meaning_vi" and one "example".

${TEMPLATE_TEXT}`

const TEXT_FIELDS = ['term', 'pronunciation', 'meaning_vi'] as const
const LIST_FIELDS = ['part_of_speech'] as const
const KNOWN = new Set<string>([...TEXT_FIELDS, ...LIST_FIELDS, 'examples', 'collocations'])

interface Checked {
  index: number
  card?: ReviewCardInput
  key?: string
  errors: string[]
  warnings: string[]
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/** Mirrors normalizeCustomCard (content-pipeline/review.ts) for the simple fields: reports problems, drops everything else. */
function checkCard(raw: unknown, index: number): Checked {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isObject(raw)) return { index, errors: ['Not an object — each card must be { "term": … }'], warnings }
  const out: Record<string, unknown> = {}

  for (const key of TEXT_FIELDS) {
    const value = raw[key]
    if (value == null || value === '') continue
    if (typeof value !== 'string') errors.push(`"${key}" must be text`)
    else if (value.trim()) out[key] = value.trim()
  }
  if (!out.term) errors.push('"term" is missing')

  for (const key of LIST_FIELDS) {
    const value = raw[key]
    if (value == null) continue
    const list = typeof value === 'string' ? value.split(',') : value
    if (!Array.isArray(list) || list.some((v) => typeof v !== 'string')) errors.push(`"${key}" must be a list of text, e.g. ["…"]`)
    else if (list.some((v) => v.trim())) out[key] = list.map((v) => v.trim()).filter(Boolean)
  }

  if (raw.examples != null) {
    if (!Array.isArray(raw.examples)) errors.push('"examples" must be a list')
    else {
      const examples = raw.examples.map((e, n) => {
        if (typeof e === 'string' && e.trim()) return e.trim()
        if (isObject(e) && typeof e.en === 'string' && e.en.trim()) {
          if (e.vi != null && typeof e.vi !== 'string') errors.push(`examples[${n}].vi must be text`)
          return { en: e.en.trim(), ...(typeof e.vi === 'string' && e.vi.trim() ? { vi: e.vi.trim() } : {}) }
        }
        errors.push(`examples[${n}] needs "en" (the English sentence)`)
        return null
      })
      if (examples.length) out.examples = examples.filter(Boolean)
      if (examples.some((e) => e && !(typeof e === 'string' ? e : e.en).includes('**'))) warnings.push('Some examples have no **bold** term')
    }
  }

  if (raw.collocations != null) {
    if (!Array.isArray(raw.collocations)) errors.push('"collocations" must be a list')
    else {
      const collocations = raw.collocations.map((c, n) => {
        if (typeof c === 'string' && c.trim()) return { text: c.trim() }
        if (isObject(c) && typeof c.text === 'string' && c.text.trim()) {
          const item: Record<string, string> = { text: c.text.trim() }
          for (const k of ['meaning_vi', 'example'] as const) {
            if (c[k] == null || c[k] === '') continue
            if (typeof c[k] !== 'string') errors.push(`collocations[${n}].${k} must be text`)
            else item[k] = c[k].trim()
          }
          return item
        }
        errors.push(`collocations[${n}] needs "text"`)
        return null
      })
      if (collocations.length) out.collocations = collocations.filter(Boolean)
    }
  }

  const unknown = Object.keys(raw).filter((k) => !KNOWN.has(k))
  if (unknown.length) warnings.push(`Ignored: ${unknown.map((k) => `"${k}"`).join(', ')}`)
  if (typeof out.pronunciation === 'string' && !/^\/.+\/$/.test(out.pronunciation)) warnings.push('Pronunciation is usually written between slashes: /…/')

  if (errors.length) return { index, errors, warnings }
  const card = out as unknown as ReviewCardInput
  return { index, card, key: slugify(card.term), errors, warnings }
}

/** Accepts a JSON array, { "cards": [...] } or a single card; strips ```json fences that chat tools add. */
function parse(text: string): { items?: unknown[]; error?: string } {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  if (!trimmed) return {}
  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch (err) {
    return { error: `Not valid JSON: ${(err as Error).message}` }
  }
  if (Array.isArray(data)) return { items: data }
  if (isObject(data) && Array.isArray(data.cards)) return { items: data.cards }
  if (isObject(data) && 'term' in data) return { items: [data] }
  return { error: 'Expected a list of cards: [ { "term": … }, { "term": … } ]' }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // http:// on a LAN address has no clipboard API.
    const area = document.createElement('textarea')
    area.value = text
    document.body.append(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}

function CopyButton({ text, label, icon }: { text: string; label: string; icon: React.ReactNode }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await copy(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? <Check className="size-3.5 text-emerald-600" /> : icon}
      {done ? 'Copied' : label}
    </Button>
  )
}

function Step({ n, title, children, aside }: { n: number; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white dark:bg-brand-500 dark:text-slate-950">{n}</span>
        <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>
        {aside ? <div className="ml-auto flex flex-wrap gap-2">{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** Paste cards written elsewhere (by hand or with any AI chat) in the review_card_schema.json format. */
export function JsonImport({ deck, existing }: { deck: string; existing: ReadonlySet<string> }) {
  const [text, setText] = useState('')
  const [replace, setReplace] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const parsed = useMemo(() => parse(text), [text])
  const checked = useMemo(() => {
    const seen = new Map<string, number>()
    return (parsed.items ?? []).map((raw, i) => {
      const result = checkCard(raw, i)
      if (result.key) {
        const first = seen.get(result.key)
        if (first !== undefined) return { ...result, card: undefined, errors: [`Same term as card #${first + 1}`] }
        seen.set(result.key, i)
      }
      return result
    })
  }, [parsed])

  const valid = checked.filter((c) => c.card)
  const invalid = checked.length - valid.length
  const clash = valid.filter((c) => existing.has(c.key!)).length
  const toSave = replace ? valid.length : valid.length - clash
  const tooMany = valid.length > MAX_CARDS

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const cards = valid.map((c) => c.card!)
      const result = await reviewApi.importCards(deck, JSON.stringify(cards), false, replace)
      const parts = [`${replace && clash ? 'Saved' : 'Imported'} ${result.saved.length} card(s) to “${deck}” and added them to your reviews`]
      if (result.skipped.length) parts.push(`skipped ${result.skipped.length} already in the deck`)
      if (invalid) parts.push(`${invalid} with errors were left out`)
      setMessage({ ok: true, text: `${parts.join('; ')}.` })
      setText('')
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Step
        n={1}
        title="Copy the template and fill it in"
        aside={
          <>
            <CopyButton text={TEMPLATE_TEXT} label="Copy template" icon={<ClipboardCopy className="size-3.5" />} />
            <CopyButton text={AI_PROMPT} label="Copy AI prompt" icon={<Sparkles className="size-3.5" />} />
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          A list of cards — copy the <code>{'{ … }'}</code> block once per word. Six fields only; <code>term</code> is required and the others can be left out or empty. Tip: “Copy
          AI prompt” gives you text to paste into ChatGPT or Gemini together with your words; paste its answer below.
        </p>
        <pre className="scrollbar-thin max-h-72 overflow-auto rounded-xl bg-slate-900 p-4 text-[12.5px] leading-relaxed text-slate-100 dark:bg-slate-950">{TEMPLATE_TEXT}</pre>
        <button
          type="button"
          onClick={() => setShowGuide((v) => !v)}
          aria-expanded={showGuide}
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-brand-600"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', showGuide && 'rotate-180')} /> What each field means
        </button>
        {showGuide ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 text-[11px] font-bold tracking-[0.08em] text-slate-500 uppercase dark:bg-slate-800/60">
                <tr>
                  <th className="px-3 py-2">Field</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">What to write</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {FIELDS.map((f) => (
                  <tr key={f.name}>
                    <td className="px-3 py-2 align-top font-mono text-[12px] whitespace-nowrap text-slate-800 dark:text-slate-100">
                      {f.name}
                      {f.required ? <span className="ml-1 font-sans text-[10px] font-bold text-rose-600 uppercase">required</span> : null}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap text-slate-500">{f.type}</td>
                    <td className="px-3 py-2 align-top text-slate-600 dark:text-slate-300">{f.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Step>

      <Step n={2} title="Paste your JSON">
        <textarea
          rows={10}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setMessage(null)
          }}
          spellCheck={false}
          placeholder={'[\n  { "term": "…", "meaning_vi": "…" },\n  { "term": "…" }\n]'}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        />
        {parsed.error ? (
          <p className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
            <XCircle className="mt-0.5 size-4 shrink-0" /> {parsed.error}
          </p>
        ) : null}
      </Step>

      {checked.length ? (
        <Step n={3} title="Check and import">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span className="text-emerald-700 dark:text-emerald-300">
              <strong>{valid.length}</strong> ready
            </span>
            {clash ? (
              <span className="text-amber-700 dark:text-amber-300">
                <strong>{clash}</strong> already in “{deck}”
              </span>
            ) : null}
            {invalid ? (
              <span className="text-rose-700 dark:text-rose-300">
                <strong>{invalid}</strong> with errors (left out)
              </span>
            ) : null}
          </div>
          <div className="scrollbar-thin max-h-80 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-slate-50 text-[11px] font-bold tracking-[0.08em] text-slate-500 uppercase dark:bg-slate-800">
                <tr>
                  <th className="w-10 px-3 py-2">#</th>
                  <th className="px-3 py-2">Term</th>
                  <th className="hidden px-3 py-2 sm:table-cell">Filled in</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {checked.map((c) => {
                  const raw = parsed.items?.[c.index]
                  const term = c.card?.term ?? (isObject(raw) && typeof raw.term === 'string' ? raw.term : '—')
                  const exists = c.card && existing.has(c.key!)
                  return (
                    <tr key={c.index} className={cn(!c.card && 'bg-rose-50/50 dark:bg-rose-950/20')}>
                      <td className="px-3 py-2 align-top text-slate-400 tabular-nums">{c.index + 1}</td>
                      <td className="px-3 py-2 align-top font-semibold text-slate-800 dark:text-slate-100">{term}</td>
                      <td className="hidden px-3 py-2 align-top sm:table-cell">{c.card ? <Filled card={c.card} /> : null}</td>
                      <td className="px-3 py-2 align-top">
                        {!c.card ? (
                          <span className="text-rose-700 dark:text-rose-300">{c.errors.join(' · ')}</span>
                        ) : exists ? (
                          <span className="text-amber-700 dark:text-amber-300">{replace ? 'Will replace the card in the deck' : 'Already in the deck — skipped'}</span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-300">New</span>
                        )}
                        {c.warnings.length ? (
                          <span className="mt-0.5 flex items-start gap-1 text-xs text-slate-500">
                            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-500" /> {c.warnings.join(' · ')}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {clash ? (
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="size-4 rounded accent-brand-600" />
              Replace cards that are already in the deck (their review progress is kept)
            </label>
          ) : null}
          {tooMany ? <p className="text-sm text-rose-600">At most {MAX_CARDS} cards per import — split the list into smaller parts.</p> : null}
        </Step>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy} disabled={!toSave || tooMany || Boolean(parsed.error)}>
          <FileJson className="size-4" /> {toSave ? `Import ${toSave} card${toSave === 1 ? '' : 's'}` : 'Import'}
        </Button>
        {message ? (
          <p role="status" className={cn('rounded-xl px-3 py-2 text-sm', message.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200')}>
            {message.text}
          </p>
        ) : null}
      </div>
    </form>
  )
}

function Filled({ card }: { card: ReviewCardInput }) {
  const items = [
    card.pronunciation && 'IPA',
    card.part_of_speech?.length && card.part_of_speech.join(', '),
    card.meaning_vi && 'meaning',
    card.examples?.length && `${card.examples.length} example${card.examples.length > 1 ? 's' : ''}`,
    card.collocations?.length && `${card.collocations.length} colloc.`,
  ].filter(Boolean) as string[]
  if (!items.length) return <span className="text-xs text-slate-400">term only</span>
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((i) => (
        <span key={i} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {i}
        </span>
      ))}
    </span>
  )
}
