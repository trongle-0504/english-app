// Review drills written by Gemini in the same request as an Admin entry — a vocabulary word or a note: "use_prompts"
// (Tự dùng), "dictation" (Nghe chép) and "paraphrase" (Viết lại câu). Cleaned afterwards by src/lib/wordDrills.ts.
import { PARAPHRASE_COUNT, USE_PROMPT_COUNT } from '../../src/lib/wordDrills.ts'

/** What the entry is called in the prompt, and the field holding the phrases a drill may also target. */
export interface DrillSubject {
  /** "word", "note title" */
  item: string
  /** "collocations", "patterns" */
  partners: string
}

export const DRILL_FIELDS = ['use_prompts', 'dictation', 'paraphrase'] as const

export function drillsSchema({ item, partners }: DrillSubject): Record<(typeof DRILL_FIELDS)[number], unknown> {
  const target = { type: 'string', description: `The ${item} itself, or a text copied exactly from "${partners}".` }
  return {
    use_prompts: {
      type: 'array',
      minItems: USE_PROMPT_COUNT,
      maxItems: USE_PROMPT_COUNT,
      items: {
        type: 'object',
        properties: {
          context: { type: 'string', description: 'IELTS topic, 1–2 words.' },
          question: { type: 'string', description: 'IELTS question, max 20 words.' },
          fits: { type: 'array', items: { type: 'string' }, description: `Texts from "${partners}" that fit a natural answer, copied exactly.` },
        },
        required: ['context', 'question', 'fits'],
      },
    },
    dictation: {
      type: 'array',
      items: {
        type: 'object',
        properties: { target, text: { type: 'string', description: 'Simple sentence, 6–12 words, no markdown.' } },
        required: ['target', 'text'],
      },
    },
    paraphrase: {
      type: 'array',
      minItems: PARAPHRASE_COUNT,
      maxItems: PARAPHRASE_COUNT,
      items: {
        type: 'object',
        properties: {
          target,
          source: { type: 'string', description: 'Plain IELTS-style sentence WITHOUT the target.' },
          model: { type: 'string', description: 'The source rewritten with the target, same meaning, no markdown.' },
        },
        required: ['target', 'source', 'model'],
      },
    },
  }
}

export function drillsPrompt({ item, partners }: DrillSubject): string {
  return `

### USE PROMPTS
Set "use_prompts" to ${USE_PROMPT_COUNT} IELTS questions (Writing Task 2 / Speaking Part 3 style) in ${USE_PROMPT_COUNT} DIFFERENT contexts
(e.g. Work, Education, Environment). A learner must be able to answer each one in ONE natural sentence that uses this
${item} in its meaning; never put the ${item} in the question. In "fits", copy the "${partners}" texts that would also sound
natural in that answer; together the questions should cover all of them where possible. [] if none fits.

### DICTATION
Set "dictation" to one sentence for the ${item} and one for EACH of its "${partners}" ("target" = that text, copied
exactly). Each is the SIMPLEST natural sentence (6–12 common words) using the target in its meaning, with placeholders
(sb, sth, + N, S + V) filled in by real words — it is read aloud for the learner to type.

### PARAPHRASE
Set "paraphrase" to ${PARAPHRASE_COUNT} rewrite tasks for IELTS paraphrasing: "source" = a plain sentence that says the same thing
with simpler words and does NOT contain the target; "model" = that sentence rewritten with the target, same meaning.
Use the ${item} for one task and, if there are "${partners}", one of them for the other.`
}
