// Speech to text on this machine: NVIDIA Parakeet TDT (110M, int8) run by sherpa-onnx on the CPU — no GPU, no network,
// ~0.05 s per second of audio, ~300 MB of memory. The model lives in models/ (not in git; see SPEAKING_STT_MODEL).
// Parakeet transcribes what was said rather than what should have been said (unlike Whisper, which tidies grammar up),
// so a learner's mistakes stay in the text, and it times every token — what the fluency figures are measured from.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { TalkWord } from '../../src/types/speakingReview.ts'
import { ApiError } from '../api.ts'

const MODEL_NAME = 'sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8'
/** SPEAKING_STT_MODEL: the model folder (encoder / decoder / joiner .onnx and tokens.txt), else models/<MODEL_NAME>. */
export const modelDir = (rootDir: string) => process.env.SPEAKING_STT_MODEL || path.join(rootDir, 'models', MODEL_NAME)
/** SPEAKING_STT_THREADS, else 4 (of the CPU's cores; more barely helps a model this size). */
const threads = () => Math.max(1, Number(process.env.SPEAKING_STT_THREADS) || 4)

const SAMPLE_RATE = 16000
/** Audio is decoded in pieces of at most this long, cut where it is quietest (attention cost grows with length²). */
const MAX_CHUNK = 28
const MIN_CHUNK = 18

interface Recognizer {
  createStream(): { acceptWaveform(w: { samples: Float32Array; sampleRate: number }): void }
  decodeAsync(stream: unknown): Promise<RawResult>
}
interface RawResult {
  text: string
  tokens: string[]
  timestamps: number[]
  durations?: number[]
  ys_log_probs?: number[]
}

// Kept on globalThis: the dev server reloads server modules in-process, and loading the model takes a second.
const holder = globalThis as { __sttRecognizer?: Promise<Recognizer> }

/** Whether the model is on this machine. */
export const sttAvailable = (rootDir: string) => existsSync(path.join(modelDir(rootDir), 'tokens.txt'))

function recognizer(rootDir: string): Promise<Recognizer> {
  if (!sttAvailable(rootDir))
    throw new ApiError(
      503,
      `Speech-to-text model not found in ${modelDir(rootDir)}. Download ${MODEL_NAME} into models/ (see the Speaking review page).`,
    )
  holder.__sttRecognizer ??= (async () => {
    const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as any
    const dir = modelDir(rootDir)
    const file = (name: string) => path.join(dir, name)
    return (await sherpa.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: file('encoder.int8.onnx'), decoder: file('decoder.int8.onnx'), joiner: file('joiner.int8.onnx') },
        tokens: file('tokens.txt'),
        numThreads: threads(),
        modelType: 'nemo_transducer',
      },
      decodingMethod: 'greedy_search',
    })) as Recognizer
  })().catch((error: Error) => {
    holder.__sttRecognizer = undefined
    throw error
  })
  return holder.__sttRecognizer
}

/* ───────────── WAV ───────────── */

/** Samples of a PCM WAV (16-bit, any rate; channels mixed down). */
export function readWav(buf: Buffer): { samples: Float32Array; sampleRate: number } {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new ApiError(400, 'The recording is not a WAV file.')
  let offset = 12
  let channels = 1
  let sampleRate = SAMPLE_RATE
  let bits = 16
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      if (buf.readUInt16LE(body) !== 1) throw new ApiError(400, 'Only PCM WAV recordings are supported.')
      channels = buf.readUInt16LE(body + 2)
      sampleRate = buf.readUInt32LE(body + 4)
      bits = buf.readUInt16LE(body + 14)
    } else if (id === 'data') {
      if (bits !== 16) throw new ApiError(400, 'Only 16-bit WAV recordings are supported.')
      const frames = Math.floor(Math.min(size, buf.length - body) / (2 * channels))
      const samples = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        let sum = 0
        for (let c = 0; c < channels; c++) sum += buf.readInt16LE(body + (i * channels + c) * 2)
        samples[i] = sum / channels / 32768
      }
      return { samples, sampleRate }
    }
    offset = body + size + (size % 2)
  }
  throw new ApiError(400, 'The WAV file has no audio data.')
}

/* ───────────── Chunking ───────────── */

/** Where to cut the audio: at the quietest 0.3 s between MIN_CHUNK and MAX_CHUNK seconds after the last cut. */
function cutPoints(samples: Float32Array, rate: number): number[] {
  const frame = Math.round(rate * 0.02)
  const energy: number[] = []
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let e = 0
    for (let j = i; j < i + frame; j++) e += samples[j] * samples[j]
    energy.push(e)
  }
  const cuts = [0]
  const span = 15 // frames: 0.3 s
  while (samples.length - cuts[cuts.length - 1] > MAX_CHUNK * rate) {
    const from = Math.floor((cuts[cuts.length - 1] + MIN_CHUNK * rate) / frame)
    const to = Math.floor((cuts[cuts.length - 1] + MAX_CHUNK * rate) / frame) - span
    let best = from
    let bestEnergy = Infinity
    for (let f = from; f <= to; f++) {
      let e = 0
      for (let k = f; k < f + span; k++) e += energy[k] ?? 0
      if (e < bestEnergy) {
        bestEnergy = e
        best = f
      }
    }
    cuts.push((best + Math.floor(span / 2)) * frame)
  }
  return cuts
}

/* ───────────── Tokens → words ───────────── */

/** Tokens glued into words: a token starting with a space starts a word; punctuation and word pieces join the last one. */
function wordsOf(raw: RawResult, offset: number): TalkWord[] {
  const words: (TalkWord & { logs: number[] })[] = []
  raw.tokens.forEach((token, i) => {
    const start = offset + (raw.timestamps[i] ?? 0)
    const end = start + (raw.durations?.[i] ?? 0.08)
    const log = raw.ys_log_probs?.length === raw.tokens.length ? raw.ys_log_probs[i] : 0
    const last = words[words.length - 1]
    const punctuation = /^[^\p{L}\p{N}']+$/u.test(token.trim())
    if (!last || (token.startsWith(' ') && !punctuation)) {
      words.push({ w: token.trim(), start, end, conf: 1, logs: punctuation ? [] : [log] })
      return
    }
    last.w += token.trim()
    if (!punctuation) {
      last.end = end
      last.logs.push(log)
    }
  })
  return words
    .filter((w) => w.w)
    .map(({ logs, ...w }) => ({
      ...w,
      start: Math.round(w.start * 100) / 100,
      end: Math.round(w.end * 100) / 100,
      // The word is as sure as its least sure piece.
      conf: Math.round(Math.exp(Math.min(0, ...logs)) * 1000) / 1000,
    }))
}

export interface Transcript {
  text: string
  words: TalkWord[]
  duration: number
}

/** The recording as text, word by word with timings. */
/** Peak -1 dB, raised at most 20 dB: the page normalizes recordings already; this covers any other WAV sent. */
function normalized(samples: Float32Array): Float32Array {
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.abs(s))
  const gain = peak < 1e-4 ? 1 : Math.min(10, 0.89 / peak)
  if (Math.abs(gain - 1) <= 0.01) return samples
  return samples.map((s) => s * gain)
}

export async function transcribe(rootDir: string, audio: { samples: Float32Array; sampleRate: number }): Promise<Transcript> {
  const rec = await recognizer(rootDir)
  const { sampleRate } = audio
  const samples = normalized(audio.samples)
  const cuts = [...cutPoints(samples, sampleRate), samples.length]
  const words: TalkWord[] = []
  const texts: string[] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const stream = rec.createStream()
    stream.acceptWaveform({ samples: samples.subarray(cuts[i], cuts[i + 1]), sampleRate })
    const raw = await rec.decodeAsync(stream)
    if (raw.text.trim()) texts.push(raw.text.trim())
    words.push(...wordsOf(raw, cuts[i] / sampleRate))
  }
  return { text: texts.join(' '), words, duration: Math.round((samples.length / sampleRate) * 100) / 100 }
}
