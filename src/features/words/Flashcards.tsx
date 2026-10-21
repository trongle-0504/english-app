import { RotateCw } from 'lucide-react'
import { useState } from 'react'
import { StudyOverlay } from '@/components/StudyOverlay'
import { Badge, Kbd } from '@/components/ui'
import { cn } from '@/lib/cn'
import { shuffle } from '@/lib/text'
import type { VocabWord } from '@/types/content'
import { collocationTypeTone } from './collocationType'
import { RichText } from './RichText'
import { SpeakButton } from '@/components/SpeakButton'
import { WordImage } from './WordImage'

interface FlashcardsProps {
  open: boolean
  onClose: () => void
  words: VocabWord[]
  title: string
}

/** Flip cards: word on the front, meaning + examples + picture on the back. */
export function Flashcards({ open, onClose, words, title }: FlashcardsProps) {
  const [deck, setDeck] = useState(words)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      // Each session starts from the first card of the current word list.
      setDeck(words)
      setIndex(0)
      setFlipped(false)
    }
  }

  const go = (next: number) => {
    setIndex(next)
    setFlipped(false)
  }

  const word = deck[index]
  if (!word) return null
  const sense = word.senses[0]

  return (
    <StudyOverlay
      open={open}
      onClose={onClose}
      index={index}
      total={deck.length}
      onIndexChange={go}
      title={`Flashcards · ${title}`}
      wrap
      onShuffle={() => {
        setDeck(shuffle(deck))
        go(0)
      }}
      onKey={(event) => {
        if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          setFlipped((f) => !f)
          return true
        }
        return false
      }}
      footerExtra={
        <span className="hidden items-center gap-1 text-xs text-slate-400 lg:flex">
          <Kbd>Space</Kbd> flip
        </span>
      }
      className="flex items-center justify-center"
    >
      <div className="w-full max-w-3xl [perspective:1600px]">
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          aria-label={flipped ? 'Show word' : 'Show meaning'}
          className={cn(
            'relative grid min-h-[22rem] w-full text-left transition-transform duration-500 [transform-style:preserve-3d] sm:min-h-[26rem]',
            flipped && '[transform:rotateY(180deg)]',
          )}
        >
          {/* Front */}
          <div className="col-start-1 row-start-1 flex flex-col items-center justify-center rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-brand-50/60 p-8 text-center shadow-lg [backface-visibility:hidden] dark:border-slate-700 dark:from-slate-900 dark:to-brand-950/40">
            <div className="flex flex-wrap justify-center gap-2">
              {word.part_of_speech.map((pos) => (
                <Badge key={pos} tone="brand">
                  {pos}
                </Badge>
              ))}
              {word.collocation_type ? <Badge tone={collocationTypeTone(word.collocation_type)}>{word.collocation_type}</Badge> : null}
            </div>
            <p className="mt-5 text-4xl font-extrabold tracking-tight text-balance text-slate-900 sm:text-5xl dark:text-white">{word.word}</p>
            {word.pronunciation ? <p className="ipa mt-3 text-lg text-slate-500 dark:text-slate-400">{word.pronunciation}</p> : null}
            <p className="mt-8 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400">
              <RotateCw className="size-3.5" /> Tap or press Space to flip
            </p>
          </div>

          {/* Back */}
          <div className="col-start-1 row-start-1 flex flex-col gap-5 overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-lg [backface-visibility:hidden] [transform:rotateY(180deg)] sm:flex-row sm:p-8 dark:border-slate-700 dark:bg-slate-900">
            <div className="min-w-0 flex-1 space-y-4">
              <p className="text-sm font-bold text-brand-600 dark:text-brand-400">{word.word}</p>
              {sense ? (
                <>
                  <RichText text={sense.definition_vi} className="block text-xl leading-snug font-bold text-slate-900 dark:text-white" />
                  {sense.examples.length ? (
                    <ul className="space-y-2 border-l-2 border-brand-200 pl-4 dark:border-brand-800">
                      {sense.examples.slice(0, 3).map((example) => (
                        <li key={example} className="text-[15px] text-slate-600 italic dark:text-slate-300">
                          <RichText text={example} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null}
              {word.senses.length > 1 ? <p className="text-xs text-slate-400">+{word.senses.length - 1} more sense(s)</p> : null}
            </div>
            {word.image ? <WordImage src={word.image} alt={word.word} credit={word.image_credit} className="h-40 w-full shrink-0 rounded-2xl sm:h-48 sm:w-48" /> : null}
          </div>
        </button>
        <div className="mt-4 flex justify-center">
          <SpeakButton text={word.word} className="size-11 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" />
        </div>
      </div>
    </StudyOverlay>
  )
}
