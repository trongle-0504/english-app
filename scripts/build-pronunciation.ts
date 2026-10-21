// Builds public/pronunciation/en-gb.tsv (word<TAB>/IPA/) for the Read aloud page from two MIT-licensed British
// English lists: ipa-dict en_UK (https://github.com/open-dict-data/ipa-dict, 65k words) and Britfone
// (https://github.com/JoseLlarena/Britfone, 16k words) for the words ipa-dict lacks.
// Run: node scripts/build-pronunciation.ts [en_UK.txt] [britfone.csv]   (missing paths are downloaded)
// Both mark stress right before the vowel ("hˈəʊmtaʊn") and use ɹ/ɛ/ɐ; this rewrites them the way learner
// dictionaries do: stress at the start of the syllable (none on one-syllable words), r, e, ə/ʌ.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const IPA_DICT_URL = 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_UK.txt'
const BRITFONE_URL = 'https://raw.githubusercontent.com/JoseLlarena/Britfone/master/britfone.main.3.0.1.csv'
const OUT_DIR = path.join(import.meta.dirname, '..', 'public', 'pronunciation')

const VOWEL_START = new Set([...'aeiouæɑɒɔəɜɪʊʌɐɛ'])
const STRESS = new Set(['ˈ', 'ˌ'])
/** Consonant clusters that can begin an English syllable (after ɹ → r), longest first when matching. */
const ONSETS = new Set([
  'pl', 'pr', 'bl', 'br', 'tr', 'dr', 'kl', 'kr', 'gl', 'ɡl', 'gr', 'ɡr', 'fl', 'fr', 'θr', 'ʃr', 'vr',
  'sp', 'st', 'sk', 'sm', 'sn', 'sw', 'sl', 'sf', 'tw', 'dw', 'kw', 'ɡw', 'θw',
  'pj', 'bj', 'tj', 'dj', 'kj', 'ɡj', 'mj', 'nj', 'fj', 'vj', 'hj', 'lj', 'sj', 'zj', 'θj',
  'spl', 'spr', 'str', 'skr', 'skw', 'spj', 'stj', 'skj', 'smj',
])

/** Common words and contractions missing from ipa-dict (already in dictionary style). */
const EXTRA: Record<string, string> = {
  a: 'ə', i: 'aɪ', he: 'hiː', are: 'ɑː', do: 'duː', does: 'dʌz', have: 'hæv', as: 'æz', okay: 'əʊˈkeɪ', ok: 'əʊˈkeɪ',
  "i'm": 'aɪm', "i'd": 'aɪd', "i'll": 'aɪl', "i've": 'aɪv', "you're": 'jɔː', "you've": 'juːv', "you'll": 'juːl', "you'd": 'juːd',
  "we're": 'wɪə', "we've": 'wiːv', "we'll": 'wiːl', "we'd": 'wiːd', "they're": 'ðeə', "they've": 'ðeɪv', "they'll": 'ðeɪl',
  "they'd": 'ðeɪd', "he's": 'hiːz', "she's": 'ʃiːz', "it's": 'ɪts', "that's": 'ðæts', "there's": 'ðeəz', "what's": 'wɒts',
  "here's": 'hɪəz', "let's": 'lets', "who's": 'huːz', "he'd": 'hiːd', "she'd": 'ʃiːd', "he'll": 'hiːl', "she'll": 'ʃiːl',
  "it'll": 'ˈɪtl', "that'll": 'ˈðætl', "don't": 'dəʊnt', "doesn't": 'ˈdʌzənt', "didn't": 'ˈdɪdənt', "can't": 'kɑːnt',
  "couldn't": 'ˈkʊdənt', "won't": 'wəʊnt', "wouldn't": 'ˈwʊdənt', "shouldn't": 'ˈʃʊdənt', "isn't": 'ˈɪzənt', "aren't": 'ɑːnt',
  "wasn't": 'ˈwɒzənt', "weren't": 'wɜːnt', "haven't": 'ˈhævənt', "hasn't": 'ˈhæzənt', "hadn't": 'ˈhædənt', "mustn't": 'ˈmʌsənt',
  "needn't": 'ˈniːdənt', "ain't": 'eɪnt', "o'clock": 'əˈklɒk', mr: 'ˈmɪstə', mrs: 'ˈmɪsɪz', ms: 'mɪz', dr: 'ˈdɒktə',
  'wi-fi': 'ˈwaɪfaɪ', wifi: 'ˈwaɪfaɪ', vietnam: 'ˌvjetˈnæm', vietnamese: 'ˌvjetnəˈmiːz', hanoi: 'hæˈnɔɪ', saigon: 'saɪˈɡɒn',
}

/** Splits IPA into phonemes: affricates and length marks stay attached. */
function phonemes(ipa: string): string[] {
  const out: string[] = []
  for (let i = 0; i < ipa.length; i++) {
    const ch = ipa[i]
    const pair = ipa.slice(i, i + 2)
    if (pair === 'tʃ' || pair === 'dʒ') {
      out.push(pair)
      i++
    } else if ((ch === 'ː' || ch === '̃') && out.length) out[out.length - 1] += ch
    else out.push(ch)
  }
  return out
}

const isConsonant = (p: string) => !VOWEL_START.has(p[0]) && !STRESS.has(p) && p !== ' '

function normalize(raw: string): string {
  const ps = phonemes(raw.replace(/ɹ/g, 'r').replace(/ɛ/g, 'e'))
  // ɐ: ʌ when stressed, otherwise schwa.
  for (let i = 0; i < ps.length; i++) if (ps[i] === 'ɐ') ps[i] = STRESS.has(ps[i - 1]) ? 'ʌ' : 'ə'
  // Move each stress mark back over the longest legal onset before its vowel.
  for (let i = 0; i < ps.length; i++) {
    if (!STRESS.has(ps[i])) continue
    let start = i
    while (start > 0 && isConsonant(ps[start - 1])) start--
    const run = ps.slice(start, i)
    let take = 0
    for (let n = run.length; n >= 1; n--) {
      const cluster = run.slice(run.length - n).join('')
      if (n === 1 ? run[run.length - 1] !== 'ŋ' : ONSETS.has(cluster)) {
        take = n
        break
      }
    }
    if (!take) continue
    const mark = ps.splice(i, 1)[0]
    ps.splice(i - take, 0, mark)
  }
  // One-syllable words carry no stress mark (vowels next to each other form one syllable).
  let syllables = 0
  ps.forEach((p, i) => {
    if (VOWEL_START.has(p[0]) && !(i > 0 && VOWEL_START.has(ps[i - 1][0]))) syllables++
  })
  return (syllables <= 1 ? ps.filter((p) => !STRESS.has(p)) : ps).join('')
}

const read = async (file: string | undefined, url: string) => (file ? readFile(file, 'utf8') : (await fetch(url)).text())
const [ipaDict, britfone] = await Promise.all([read(process.argv[2], IPA_DICT_URL), read(process.argv[3], BRITFONE_URL)])

const entries = new Map<string, string>()
for (const line of ipaDict.split('\n')) {
  const [word, ipa] = line.split('\t')
  if (word && ipa) entries.set(word, normalize(ipa.split(',')[0].trim().replace(/^\/|\/$/g, '')))
}
let fromBritfone = 0
for (const line of britfone.split('\n')) {
  // "PACE, p ˈeɪ s" — variants are "WORD(2)"; keep the first only.
  const match = /^([^,(]+), (.+)$/.exec(line.trim())
  if (!match) continue
  const word = match[1].toLowerCase()
  if (entries.has(word) || !/^[a-z][a-z'-]*$/.test(word)) continue
  entries.set(word, normalize(match[2].replace(/\s+/g, '')))
  fromBritfone++
}
for (const [word, ipa] of Object.entries(EXTRA)) entries.set(word, ipa)
const lines = [...entries].map(([word, ipa]) => `${word}\t/${ipa}/`)

await mkdir(OUT_DIR, { recursive: true })
await writeFile(path.join(OUT_DIR, 'en-gb.tsv'), `${lines.join('\n')}\n`)
await writeFile(
  path.join(OUT_DIR, 'LICENSE.txt'),
  `en-gb.tsv is derived from ipa-dict (en_UK), https://github.com/open-dict-data/ipa-dict, Copyright (c) 2016 dohliam,\n` +
    `and Britfone, https://github.com/JoseLlarena/Britfone, Copyright (c) 2017 Jose Llarena. Both under the MIT License:\n\n` +
    'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\n' +
    'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\n' +
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n',
)
console.log(`Wrote ${lines.length} words (${fromBritfone} from Britfone) to public/pronunciation/en-gb.tsv`)
