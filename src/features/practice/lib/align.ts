import { words } from './compare.ts'

export type AlignedSentence =
  | { kind: 'matched'; target: number; user: number }
  | { kind: 'missing'; target: number }
  | { kind: 'extra'; user: number }

function lcsLength(a: readonly string[], b: readonly string[]): number {
  let prev = new Array<number>(b.length + 1).fill(0)
  for (const word of a) {
    const row = [0]
    for (let j = 0; j < b.length; j++) row.push(word === b[j] ? prev[j] + 1 : Math.max(prev[j + 1], row[j]))
    prev = row
  }
  return prev[b.length]
}

/** Order-aware word overlap in [0, 1]: 2 · LCS / (|a| + |b|). */
export function similarity(a: string, b: string): number {
  const x = words(a)
  const y = words(b)
  return x.length + y.length === 0 ? 0 : (2 * lcsLength(x, y)) / (x.length + y.length)
}

/**
 * Pairs the user's sentences with target sentences, keeping both in order and maximising total
 * similarity. Unlike index-by-index pairing, a skipped or extra sentence doesn't shift every later
 * comparison. Pairs below `minSimilarity` are treated as unrelated (reported as missing + extra).
 */
export function alignSentences(user: readonly string[], target: readonly string[], minSimilarity = 0.3): AlignedSentence[] {
  const sim = user.map((u) => target.map((t) => similarity(u, t)))
  // best[i][j] = best total score aligning user[0..i) with target[0..j).
  const best = Array.from({ length: user.length + 1 }, () => new Array<number>(target.length + 1).fill(0))
  for (let i = 1; i <= user.length; i++) {
    for (let j = 1; j <= target.length; j++) {
      const match = sim[i - 1][j - 1] >= minSimilarity ? best[i - 1][j - 1] + sim[i - 1][j - 1] : -1
      best[i][j] = Math.max(match, best[i - 1][j], best[i][j - 1])
    }
  }

  const result: AlignedSentence[] = []
  let i = user.length
  let j = target.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && sim[i - 1][j - 1] >= minSimilarity && best[i][j] === best[i - 1][j - 1] + sim[i - 1][j - 1]) {
      result.push({ kind: 'matched', user: --i, target: --j })
    } else if (j > 0 && (i === 0 || best[i][j] === best[i][j - 1])) {
      result.push({ kind: 'missing', target: --j })
    } else {
      result.push({ kind: 'extra', user: --i })
    }
  }
  return result.reverse()
}
