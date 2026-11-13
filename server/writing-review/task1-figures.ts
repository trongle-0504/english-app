// Writing Task 1: every figure the answer reports, checked against the chart reading in code. The model only lists the
// figures (which chart value each number is about, in the chart's unit); the comparison is arithmetic, so a figure that
// is off is never missed because the scoring call looked at the answer as a whole.
import { z } from 'zod'
import type { WritingTask1Chart, WritingTask1Review } from '../../src/types/writingReview.ts'
import type { LlmProvider } from './llm-types.ts'

export const FigureClaimsSchema = z.object({
  claims: z.array(
    z.object({
      n: z.number().int().describe('Sentence number.'),
      quote: z.string().describe('The number as written in that sentence, copied exactly, e.g. "230 million tons", "40 thousand dollars", "a quarter".'),
      figure: z.string().describe('The chart figure it reports: one label copied exactly from the list; "" when it matches none.'),
      value: z.number().describe('The number converted to the chart unit given (e.g. "$40,000" with unit "$ thousand" → 40).'),
    }),
  ),
})

const SYSTEM = `You list the figures an IELTS Writing Task 1 answer reports, for a check done in code. For every number the answer gives as a data value (an amount, a percentage, a fraction such as "a quarter"), write the sentence number, the number exactly as written, the chart figure it is about (one label from the list, by category and time as the sentence states them; "" when none fits) and its value in the chart's unit. When a sentence gives several values with "respectively", match them in order. Skip years, counts of categories ("three fuels") and differences between two figures. Do not judge whether a value is right: only list.`

/** The first number of a chart value such as "≈270 million tons" or "$40,000". */
export function numberOf(value: string): number | undefined {
  const match = /-?\d[\d,]*(?:\.\d+)?/.exec(value)
  return match ? Number(match[0].replace(/,/g, '')) : undefined
}

/**
 * How far a reported figure may be from the chart reading: an estimate read from an axis ("≈") allows 2.5 % of the
 * chart's largest figure (230 against ≈220 on a 0-320 axis is wrong; 320 against ≈315 is within the reading's
 * precision); a labelled figure allows rounding only.
 */
function tolerance(chartValue: string, largest: number): number {
  return /≈|~|approx|about/i.test(chartValue) ? Math.max(largest * 0.025, 0.5) : Math.max(largest * 0.005, 0.5)
}

/** Digits of a quote are in the sentence (the model copied the number, not reworded it). */
const numberInSentence = (quote: string, sentence: string) => {
  const digits = quote.match(/\d[\d,.]*/g)
  return digits ? digits.every((d) => sentence.includes(d)) : sentence.toLowerCase().includes(quote.toLowerCase().trim())
}

/** Figures of the answer that differ from the chart reading, as data errors (0-based sentences). */
export async function checkFigures(
  llm: LlmProvider,
  { sentences, chart }: { sentences: string[]; chart: WritingTask1Chart },
): Promise<WritingTask1Review['dataErrors']> {
  const figures = chart.figures.map((f) => ({ ...f, number: numberOf(f.value) })).filter((f) => f.number !== undefined)
  if (!figures.length) return []
  const largest = Math.max(...figures.map((f) => Math.abs(f.number!)))
  const { value } = await llm.json({
    label: 'task1 figures',
    system: SYSTEM,
    prompt: [
      `Chart: ${chart.kind}: ${chart.subject}${chart.unit ? `. Unit: ${chart.unit}` : ''}${chart.period ? `. Period: ${chart.period}` : ''}`,
      `Chart figure labels:\n${figures.map((f) => `- ${f.label}`).join('\n')}`,
      `Answer, by sentence:\n${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    ].join('\n\n'),
    schema: FigureClaimsSchema,
    effort: 'low',
  })
  const errors: WritingTask1Review['dataErrors'] = []
  for (const claim of value.claims) {
    const sentence = sentences[claim.n - 1]
    const figure = figures.find((f) => f.label.trim().toLowerCase() === claim.figure.trim().toLowerCase())
    if (!sentence || !figure || !Number.isFinite(claim.value) || !numberInSentence(claim.quote, sentence)) continue
    if (Math.abs(claim.value - figure.number!) <= tolerance(figure.value, largest)) continue
    errors.push({
      sentence: claim.n - 1,
      quote: claim.quote.trim(),
      wrote: `${figure.label}: ${claim.quote.trim()}`,
      correct: `Biểu đồ: ${figure.label} = ${figure.value}`,
    })
  }
  return errors
}

/** The scoring call's data errors plus the figures found by the check, without listing one place twice. */
export function mergeDataErrors(
  fromScore: WritingTask1Review['dataErrors'],
  fromCheck: WritingTask1Review['dataErrors'],
): WritingTask1Review['dataErrors'] {
  const merged = [...fromScore]
  for (const e of fromCheck) {
    const digits = e.quote.match(/\d[\d,.]*/)?.[0]
    const dup = merged.some((m) => m.sentence === e.sentence && (m.quote.includes(e.quote) || (digits && m.quote.includes(digits))))
    if (!dup) merged.push(e)
  }
  return merged.sort((a, b) => a.sentence - b.sentence).slice(0, 12)
}
