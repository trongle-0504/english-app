// Linking words found by code (the model tends to list only a few). Each hit becomes a "linking" item.
import type { EssayItem } from '../../src/types/essays.ts'

interface Linker {
  phrase: string
  function: string
  vi: string
  /** Only at the start of a sentence ("First, …"), or only after a comma (", while …"). */
  where?: 'start' | 'after-comma'
}

const LINKERS: Linker[] = [
  { phrase: 'admittedly', function: 'concession', vi: 'phải thừa nhận rằng' },
  { phrase: 'it is true that', function: 'concession', vi: 'đúng là' },
  { phrase: 'although', function: 'concession', vi: 'mặc dù' },
  { phrase: 'even though', function: 'concession', vi: 'mặc dù' },
  { phrase: 'despite', function: 'concession', vi: 'bất chấp, mặc dù' },
  { phrase: 'in spite of', function: 'concession', vi: 'mặc dù' },
  { phrase: 'however', function: 'contrast', vi: 'tuy nhiên' },
  { phrase: 'nevertheless', function: 'contrast', vi: 'tuy vậy' },
  { phrase: 'nonetheless', function: 'contrast', vi: 'tuy vậy' },
  { phrase: 'on the other hand', function: 'contrast', vi: 'mặt khác' },
  { phrase: 'in contrast', function: 'contrast', vi: 'ngược lại' },
  { phrase: 'whereas', function: 'contrast', vi: 'trong khi (đối lập)' },
  { phrase: 'while', function: 'contrast', vi: 'trong khi (đối lập)', where: 'after-comma' },
  { phrase: 'rather than', function: 'contrast', vi: 'thay vì' },
  { phrase: 'for instance', function: 'example', vi: 'ví dụ' },
  { phrase: 'for example', function: 'example', vi: 'ví dụ' },
  { phrase: 'such as', function: 'example', vi: 'chẳng hạn như' },
  { phrase: 'a case in point is', function: 'example', vi: 'một ví dụ điển hình là' },
  { phrase: 'moreover', function: 'addition', vi: 'hơn nữa' },
  { phrase: 'furthermore', function: 'addition', vi: 'hơn nữa' },
  { phrase: 'in addition', function: 'addition', vi: 'ngoài ra' },
  { phrase: 'additionally', function: 'addition', vi: 'ngoài ra' },
  { phrase: 'what is more', function: 'addition', vi: 'hơn thế nữa' },
  { phrase: 'first', function: 'sequence', vi: 'thứ nhất', where: 'start' },
  { phrase: 'firstly', function: 'sequence', vi: 'thứ nhất', where: 'start' },
  { phrase: 'second', function: 'sequence', vi: 'thứ hai', where: 'start' },
  { phrase: 'secondly', function: 'sequence', vi: 'thứ hai', where: 'start' },
  { phrase: 'finally', function: 'sequence', vi: 'cuối cùng', where: 'start' },
  { phrase: 'therefore', function: 'result', vi: 'do đó' },
  { phrase: 'thus', function: 'result', vi: 'vì vậy' },
  { phrase: 'hence', function: 'result', vi: 'do đó' },
  { phrase: 'consequently', function: 'result', vi: 'do đó, kết quả là' },
  { phrase: 'as a result', function: 'result', vi: 'kết quả là' },
  { phrase: 'as a consequence', function: 'result', vi: 'hệ quả là' },
  { phrase: 'because of', function: 'cause', vi: 'bởi vì' },
  { phrase: 'due to', function: 'cause', vi: 'do, bởi vì' },
  { phrase: 'owing to', function: 'cause', vi: 'do, nhờ' },
  { phrase: 'in other words', function: 'clarification', vi: 'nói cách khác' },
  { phrase: 'in particular', function: 'emphasis', vi: 'đặc biệt là' },
  { phrase: 'in conclusion', function: 'conclusion', vi: 'kết luận lại' },
  { phrase: 'to conclude', function: 'conclusion', vi: 'kết luận lại' },
  { phrase: 'to sum up', function: 'conclusion', vi: 'tóm lại' },
  { phrase: 'overall', function: 'conclusion', vi: 'nhìn chung', where: 'start' },
]

/** Linking items for every linker in the sentences that no existing item already covers. */
export function findLinkers(sentences: string[], existing: EssayItem[]): EssayItem[] {
  const found: EssayItem[] = []
  const used = new Set(existing.map((i) => i.id))
  sentences.forEach((sentence, index) => {
    const lower = sentence.toLowerCase()
    for (const l of LINKERS) {
      const re = new RegExp(`(^|[^a-z])(${l.phrase.replace(/ /g, '\\s+')})(?=[^a-z]|$)`, 'g')
      for (const m of lower.matchAll(re)) {
        const start = (m.index ?? 0) + m[1].length
        const end = start + m[2].length
        if (l.where === 'start' && (start !== 0 || sentence[end] !== ',')) continue
        if (l.where === 'after-comma' && !/,\s*$/.test(sentence.slice(0, start))) continue
        const covered = [...existing, ...found].some((i) => i.kind === 'linking' && i.sentence === index && i.start < end && start < i.end)
        if (covered) continue
        let id = l.phrase.replace(/\s+/g, '-')
        for (let n = 2; used.has(id); n++) id = `${l.phrase.replace(/\s+/g, '-')}-${n}`
        used.add(id)
        found.push({ id, key: l.phrase, text: sentence.slice(start, end), kind: 'linking', meaning_vi: l.vi, function: l.function, importance: 2, sentence: index, start, end })
      }
    }
  })
  return found
}
