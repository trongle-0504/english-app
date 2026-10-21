import type { Tone } from '@/components/ui'
import type { NoteType } from '@/types/content'

/** Display order of the sidebar filters. */
export const NOTE_TYPES: NoteType[] = ['Structure', 'Idiom', 'Collocation', 'Vocabulary', 'Other']

export const NOTE_TYPE_TONES: Record<NoteType, Tone> = {
  Structure: 'indigo',
  Idiom: 'amber',
  Collocation: 'emerald',
  Vocabulary: 'sky',
  Other: 'slate',
}

/** Lookup key for resolving `related_notes` (which hold titles or ids) to note ids. */
export const noteKey = (value: string) => value.trim().toLowerCase()
