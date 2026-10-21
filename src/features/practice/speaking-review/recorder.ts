// Recording in the browser: the microphone through MediaRecorder, a live level for the meter, and the result turned into
// what the server's recognizer reads — 16 kHz mono 16-bit WAV (decoded and resampled here, so the server needs no ffmpeg).
import { useCallback, useEffect, useRef, useState } from 'react'

const RATE = 16000

/** Peak -1 dB; a quiet recording is raised at most 20 dB (more would mostly raise the room noise). */
const PEAK = 0.89
const MAX_GAIN = 10

/**
 * The recording brought up to a steady level (in place): a laptop or phone mic often records quietly, and the ends of
 * words fade with it — /t/, /s/, /d/ the recognizer then misses.
 */
function normalize(samples: Float32Array): Float32Array {
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.abs(s))
  if (peak < 1e-4) return samples
  const gain = Math.min(MAX_GAIN, PEAK / peak)
  if (Math.abs(gain - 1) > 0.01) for (let i = 0; i < samples.length; i++) samples[i] *= gain
  return samples
}

/** Any audio the browser can decode (a recording, an uploaded file) as a 16 kHz mono WAV, its level normalized. */
export async function toWav16k(blob: Blob): Promise<{ wav: Blob; seconds: number }> {
  const data = await blob.arrayBuffer()
  const ctx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(data)
  } finally {
    void ctx.close()
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * RATE))
  const offline = new OfflineAudioContext(1, frames, RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const samples = normalize((await offline.startRendering()).getChannelData(0))

  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, RATE, true)
  view.setUint32(28, RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return { wav: new Blob([buffer], { type: 'audio/wav' }), seconds: decoded.duration }
}

/** A blob as base64 (no data: prefix). */
export function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export type RecorderState = 'idle' | 'recording' | 'converting' | 'ready'

export interface Take {
  wav: Blob
  url: string
  seconds: number
}

/** Records from the microphone: elapsed time and level while recording, then the take as a WAV. */
export function useRecorder(maxSeconds: number) {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [take, setTake] = useState<Take | null>(null)
  const [error, setError] = useState('')
  const live = useRef<{ recorder: MediaRecorder; stream: MediaStream; audio: AudioContext; frame: number; timer: number } | null>(null)

  const release = useCallback(() => {
    const l = live.current
    if (!l) return
    cancelAnimationFrame(l.frame)
    clearInterval(l.timer)
    l.stream.getTracks().forEach((t) => t.stop())
    void l.audio.close()
    live.current = null
  }, [])

  const keep = useCallback(async (blob: Blob) => {
    setState('converting')
    try {
      const { wav, seconds } = await toWav16k(blob)
      setTake((old) => {
        if (old) URL.revokeObjectURL(old.url)
        return { wav, seconds, url: URL.createObjectURL(wav) }
      })
      setState('ready')
    } catch (err) {
      setError(`Không đọc được âm thanh: ${(err as Error).message}`)
      setState('idle')
    }
  }, [])

  const stop = useCallback(() => {
    if (live.current?.recorder.state === 'recording') live.current.recorder.stop()
  }, [])

  const start = useCallback(async () => {
    setError('')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
    } catch (err) {
      setError(
        (err as Error).name === 'NotAllowedError'
          ? 'Trình duyệt chưa cho dùng micro: bấm biểu tượng ổ khoá trên thanh địa chỉ và cho phép Microphone.'
          : `Không mở được micro: ${(err as Error).message}`,
      )
      return
    }
    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    recorder.onstop = () => {
      release()
      setLevel(0)
      void keep(new Blob(chunks, { type: recorder.mimeType }))
    }
    const audio = new AudioContext()
    const analyser = audio.createAnalyser()
    analyser.fftSize = 1024
    audio.createMediaStreamSource(stream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    const begun = performance.now()
    const tick = () => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (const v of buf) sum += v * v
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6))
      if (live.current) live.current.frame = requestAnimationFrame(tick)
    }
    const timer = window.setInterval(() => {
      const s = (performance.now() - begun) / 1000
      setElapsed(s)
      if (s >= maxSeconds) recorder.stop()
    }, 200)
    live.current = { recorder, stream, audio, frame: requestAnimationFrame(tick), timer }
    setElapsed(0)
    setState('recording')
    recorder.start(1000)
  }, [keep, maxSeconds, release])

  /** An audio file instead of the microphone. */
  const upload = useCallback((file: File) => void keep(file), [keep])

  const reset = useCallback(() => {
    setTake((old) => {
      if (old) URL.revokeObjectURL(old.url)
      return null
    })
    setElapsed(0)
    setState('idle')
  }, [])

  useEffect(() => release, [release])

  return { state, elapsed, level, take, error, start, stop, upload, reset }
}
