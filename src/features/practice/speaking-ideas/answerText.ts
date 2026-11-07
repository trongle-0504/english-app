import type { AnswerSentence, SpeakingAnswer, SpeakingPart } from '../../../types/speaking.ts'

export interface ParagraphSentence {
  index: number
  sentence: AnswerSentence
}

export const hasModelAnswer = (a: SpeakingAnswer): boolean =>
  a.answer.length > 0 || Boolean(a.sentences?.length)

export function groupSentencesByParagraphs(
  sentences: AnswerSentence[],
  userEdited?: string,
  part: SpeakingPart = 1,
): ParagraphSentence[][] {
  if (userEdited && userEdited.includes('\n')) {
    const rawParas = userEdited
      .split(/\n\s*\n+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean)
    if (rawParas.length > 1) {
      const result: ParagraphSentence[][] = rawParas.map(() => [])
      let paraIdx = 0
      sentences.forEach((s, idx) => {
        const text = s.segments
          .map((g) => g.text)
          .join('')
          .trim()
          .toLowerCase()
        const snippet = text.slice(0, Math.min(30, text.length))
        for (let p = paraIdx; p < rawParas.length; p++) {
          if (rawParas[p].includes(snippet)) {
            paraIdx = p
            break
          }
        }
        result[paraIdx].push({ index: idx, sentence: s })
      })
      const nonEmpty = result.filter((p) => p.length > 0)
      if (nonEmpty.length > 1) return nonEmpty
    }
  }

  // Part 1 is short (3-4 sentences) -> always 1 unified paragraph
  if (part === 1) {
    return [sentences.map((s, index) => ({ index, sentence: s }))]
  }

  // Part 3 is typically 4-6 sentences -> keep in 1 paragraph unless explicit conclusion
  if (part === 3 && sentences.length <= 4) {
    return [sentences.map((s, index) => ({ index, sentence: s }))]
  }

  // Auto-detect paragraphs for Part 2 (and longer Part 3)
  const paragraphs: ParagraphSentence[][] = []
  let current: ParagraphSentence[] = []

  sentences.forEach((s, i) => {
    const text = s.segments
      .map((g) => g.text)
      .join('')
      .trim()
    const isFirst = i === 0

    const isConclusion =
      s.tool === 'conclusion' ||
      /^(in conclusion|to conclude|to sum up|all in all|overall|in summary|looking back|to wrap up)\b/i.test(text)

    const isBodyTransition =
      /^(on the one hand|on the other hand|firstly|first and foremost|to begin with|first off|as for|when it comes to|speaking of|in addition|furthermore|moreover|what is more|another thing is|turning to|nevertheless|however|conversely|in contrast|secondly|eventually|at that time|during that period|after that|nowadays)\b/i.test(
        text,
      )

    const isNewBody = i > 1 && (s.tool === 'lead_in' || (s.tool === 'introduction' && i > 2) || isBodyTransition)

    if (!isFirst && (isConclusion || (isNewBody && current.length >= 2))) {
      if (current.length) paragraphs.push(current)
      current = [{ index: i, sentence: s }]
    } else {
      current.push({ index: i, sentence: s })
    }
  })

  if (current.length) paragraphs.push(current)
  return paragraphs
}

/** Plain text of the model answer with paragraph breaks preserved; returns `''` when there is no model answer. */
export function modelAnswerText(answer: SpeakingAnswer, part: SpeakingPart): string {
  if (!hasModelAnswer(answer)) return ''
  const plain = answer.answer.map((s) => s.text).join('')
  const paragraphs = groupSentencesByParagraphs(answer.sentences ?? [], answer.userEdited, part)
  if (!paragraphs.length || !paragraphs.some((p) => p.length > 0)) return plain
  return paragraphs
    .map((p) => p.map((item) => item.sentence.segments.map((seg) => seg.text).join('')).join(' '))
    .join('\n\n')
}
