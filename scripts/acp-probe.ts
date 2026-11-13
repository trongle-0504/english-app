// Measures S, the start-up cost of one `agy -p` call, against the same tiny prompt on an `agy acp` process that is
// already running (docs: admin-generate-speed plan, section 7). Prints ms per call, the ACP start-up time, input tokens
// of each ACP turn (the agent preamble) and whether agy advertises image input in its prompt capabilities.
//   node scripts/acp-probe.ts [runs=5] [model=gemini-3.8-flash-low]
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AcpClient } from '../server/coach/acp.ts'

const runs = Number(process.argv[2]) || 5
const modelId = process.argv[3] || 'gemini-3.8-flash-low'
const bin = process.env.ANTIGRAVITY_BIN || [path.join(os.homedir(), '.local', 'bin', 'agy')].find((p) => existsSync(p)) || 'agy'
const cwd = path.join(os.tmpdir(), 'english-app-acp-probe')
mkdirSync(cwd, { recursive: true })

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function agyP(): Promise<{ ms: number; duration?: number; input?: number; status?: string }> {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(bin, ['-p', 'Reply OK', '--output-format', 'json', '--disable-slash-commands', '--model', modelId.replace(/-(low|medium|high)$/, ''), '--effort', 'low'], { cwd })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d))
    child.on('close', () => {
      const ms = Date.now() - started
      try {
        const o = JSON.parse(out) as { duration_seconds?: number; usage?: { input_tokens?: number }; status?: string }
        resolve({ ms, duration: o.duration_seconds, input: o.usage?.input_tokens, status: o.status })
      } catch {
        resolve({ ms })
      }
    })
  })
}

async function main() {
  const p: number[] = []
  for (let i = 0; i < runs; i++) {
    const r = await agyP()
    p.push(r.ms)
    console.log(`agy -p   #${i + 1}: ${r.ms} ms (agy duration ${r.duration?.toFixed(2)} s, input ${r.input}, ${r.status})`)
  }

  const client = new AcpClient({ cwd, idleMs: 60_000 })
  const t0 = Date.now()
  await client.ensure()
  const startMs = Date.now() - t0
  console.log(`agy acp start-up (spawn + initialize): ${startMs} ms`)
  console.log(`agy acp prompt capabilities: ${JSON.stringify(client.agentCapabilities?.promptCapabilities ?? null)}`)
  const a: number[] = []
  for (let i = 0; i < runs; i++) {
    const started = Date.now()
    const sessionId = await client.newSession([])
    await client.setModel(sessionId, modelId)
    let text = ''
    const result = await client.prompt(sessionId, [{ type: 'text', text: 'Reply OK' }], (u) => {
      if (u.sessionUpdate === 'agent_message_chunk' && u.content?.text) text += u.content.text
    })
    await client.close(sessionId)
    const ms = Date.now() - started
    a.push(ms)
    console.log(`agy acp  #${i + 1}: ${ms} ms (input ${result.usage?.inputTokens}, stop ${result.stopReason}, text ${JSON.stringify(text.slice(0, 20))})`)
  }

  // Several sessions on one process at once.
  const parallel = Date.now()
  await Promise.all(
    [1, 2, 3].map(async () => {
      const sessionId = await client.newSession([])
      await client.setModel(sessionId, modelId)
      await client.prompt(sessionId, [{ type: 'text', text: 'Reply OK' }], () => {})
      await client.close(sessionId)
    }),
  )
  console.log(`3 sessions in parallel on one process: ${Date.now() - parallel} ms`)
  const pid = client.pid
  if (pid) {
    const { readFileSync } = await import('node:fs')
    const rss = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1]
    console.log(`agy acp RSS: ${rss ? Math.round(Number(rss) / 1024) : '?'} MB (pid ${pid})`)
  }
  client.stop()
  console.log(`\nmedian agy -p: ${median(p)} ms · median agy acp: ${median(a)} ms · S ≈ ${median(p) - median(a)} ms`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
