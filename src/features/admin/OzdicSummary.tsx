import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui'
import { TimingsLine, type GenerateTimings } from './GenerateExtras'

/** What the base-form and dictionary (OZDIC, Longman) steps of a Generate request did (Admin → Vocabulary and Notes). */
export interface OzdicGrounding {
  /** Step 1: the base form the entry was generated for ("decisions" → decision). */
  lemma?: { input: string; lemma: string; headwords: string[]; note_vi: string }
  lemmaError?: string
  /** Step 2: dictionary entries sent with the main prompt, and what Gemini corrected because of them. */
  ozdic?: {
    sources: {
      dictionary?: 'ozdic' | 'longman'
      word: string
      url: string
      oxford: boolean
      status: 'oxford' | 'no_oxford' | 'collocations' | 'senses_only' | 'not_found' | 'unavailable' | 'error'
      reason?: string
    }[]
    /** Which dictionaries the entry rests on; "none" = written by the AI alone. */
    dictionarySource?: 'longman' | 'ozdic' | 'both' | 'none'
    /** Why a dictionary could not be used (Vietnamese), '' when all were. */
    dictionaryNote?: string
    corrections: { original: string; corrected: string; reason_vi: string }[]
    /** Collocations chosen from the dictionaries because the notes had none (checked against the dictionary data). */
    added?: string[]
    /** Chosen by Gemini but not found in the dictionary data, so left out. */
    droppedAdded?: string[]
    /** Added from the model's knowledge because the dictionaries list too few for the word. */
    unverifiedAdded?: string[]
  }
  /** How Gemini read the notes: sentences are examples, never collocations. */
  notes?: { examples: string[]; collocations: string[]; patterns: string[] }
  /** Step times of the request. */
  timings?: GenerateTimings
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const SOURCE_STATUS = {
  oxford: 'Oxford data',
  no_oxford: 'no Oxford data',
  collocations: 'collocations',
  senses_only: 'senses only',
  not_found: 'no entry',
  unavailable: 'unavailable',
  error: 'lookup failed',
} as const

/** What the base-form and dictionary steps did for the last generated item. `showInput` = strike through what was typed. */
export function OzdicSummary({ res, subject = 'Base form', showInput = true }: { res: OzdicGrounding; subject?: string; showInput?: boolean }) {
  const { lemma, ozdic, notes } = res
  if (!lemma && !ozdic) return null
  return (
    <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3.5 text-sm dark:border-slate-700 dark:bg-slate-900">
      {lemma ? (
        <p className="text-slate-700 dark:text-slate-200">
          <span className="font-semibold">{subject}:</span>{' '}
          {showInput && lemma.input !== lemma.lemma ? (
            <>
              <span className="text-slate-400 line-through">{lemma.input}</span> → <strong>{lemma.lemma}</strong>
              {lemma.note_vi ? <span className="text-slate-500"> — {lemma.note_vi}</span> : null}
            </>
          ) : (
            <strong>{lemma.lemma}</strong>
          )}
          {res.lemmaError ? <span className="text-amber-600"> (step skipped: {res.lemmaError})</span> : null}
        </p>
      ) : null}
      {ozdic ? (
        <p className="flex flex-wrap items-center gap-1.5 text-slate-700 dark:text-slate-200">
          <span className="font-semibold">Dictionaries:</span>
          {ozdic.sources.length ? (
            ozdic.sources.map((src) => (
              <a key={`${src.dictionary ?? 'ozdic'}:${src.word}`} href={src.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
                <Badge tone={src.oxford ? 'emerald' : 'amber'} title={src.reason ?? SOURCE_STATUS[src.status]}>
                  {src.dictionary === 'longman' ? 'Longman' : 'OZDIC'} · {src.word} · {SOURCE_STATUS[src.status]}
                  {src.reason ? ` (${src.reason})` : ''} <ExternalLink className="size-3" />
                </Badge>
              </a>
            ))
          ) : (
            <span className="text-slate-500">no headword to look up</span>
          )}
        </p>
      ) : null}
      {ozdic?.dictionaryNote ? (
        <p className={ozdic.dictionarySource === 'none' ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-amber-700 dark:text-amber-400'}>
          {ozdic.dictionaryNote}
        </p>
      ) : null}
      {notes && notes.examples.length + notes.collocations.length + notes.patterns.length ? (
        <p className="text-slate-700 dark:text-slate-200" title={[...notes.examples, ...notes.collocations, ...notes.patterns].join('\n')}>
          <span className="font-semibold">Your notes read as:</span>{' '}
          {count(notes.examples.length, 'example sentence')} · {count(notes.collocations.length, 'collocation')} · {count(notes.patterns.length, 'pattern')}
        </p>
      ) : null}
      {ozdic?.unverifiedAdded?.length ? (
        <p className="text-slate-700 dark:text-slate-200">
          <span className="font-semibold">Collocations added by AI</span> <span className="text-slate-500">(you gave none)</span>:{' '}
          {ozdic.unverifiedAdded.map((c, i) => (
            <span key={c}>
              {i ? ', ' : ''}
              <strong>{c}</strong>
            </span>
          ))}{' '}
          <Badge tone="amber" title="No dictionary lists enough collocations for this word, so these come from the model only.">
            not verified by a dictionary
          </Badge>
        </p>
      ) : null}
      {ozdic?.added?.length ? (
        <p className="text-slate-700 dark:text-slate-200">
          <span className="font-semibold">Collocations picked from the dictionaries</span> <span className="text-slate-500">(you gave none)</span>:{' '}
          {ozdic.added.map((c, i) => (
            <span key={c}>
              {i ? ', ' : ''}
              <strong className="text-emerald-700 dark:text-emerald-400">{c}</strong>
            </span>
          ))}
          {ozdic.droppedAdded?.length ? <span className="text-amber-600"> · left out (not in the dictionaries): {ozdic.droppedAdded.join(', ')}</span> : null}
        </p>
      ) : null}
      {ozdic?.corrections.length ? (
        <div>
          <p className="font-semibold text-slate-700 dark:text-slate-200">Corrected with the dictionaries</p>
          <ul className="mt-1 space-y-1">
            {ozdic.corrections.map((c) => (
              <li key={`${c.original}→${c.corrected}`} className="text-slate-600 dark:text-slate-300">
                <span className="text-rose-600 line-through dark:text-rose-400">{c.original}</span> →{' '}
                <strong className="text-emerald-700 dark:text-emerald-400">{c.corrected}</strong>
                <span className="text-slate-500"> — {c.reason_vi}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : ozdic?.sources.some((src) => src.oxford) && !ozdic.added?.length && !ozdic.unverifiedAdded?.length ? (
        <p className="text-slate-500">Nothing needed correcting — your collocations and patterns matched the dictionaries.</p>
      ) : null}
      <TimingsLine timings={res.timings} />
    </div>
  )
}
