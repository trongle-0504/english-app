// Planner quick-add eval: 12 notes with today fixed to Saturday 2026-11-07, 10:00 (VN). Prints one line per note,
// pass/fail against the expected values, and the call time. Usage: node scripts/planner-quickadd-eval.ts
import path from 'node:path'
import { loadEnv } from '../server/env.ts'
import { quickAdd } from '../server/planner/ai.ts'
import type { QuickAddItem } from '../src/types/planner.ts'

const rootDir = path.resolve(import.meta.dirname, '..')
loadEnv(rootDir)

const NOW = new Date('2026-11-07T10:00:00+07:00')

interface Expect {
  type: 'task' | 'event'
  date: string
  time?: string
  endTime?: string
  durationMin?: number
  skill?: string
  eventKind?: string
  location?: RegExp
  repeat?: number[]
  /** true: the item must have no time. */
  noTime?: boolean
}

const CASES: { note: string; expect: Expect }[] = [
  { note: 'mai 8h tối luyện speaking part 2 45 phút', expect: { type: 'task', date: '2026-11-08', time: '20:00', durationMin: 45, skill: 'speaking' } },
  { note: 'thi IELTS thứ 5 tuần sau 8h sáng ở IDP', expect: { type: 'event', eventKind: 'exam', date: '2026-11-12', time: '08:00', location: /IDP/i } },
  { note: 'writing task 2 chiều nay', expect: { type: 'task', date: '2026-11-07', time: '15:00', skill: 'writing' } },
  { note: 'ôn 30 thẻ từ vựng mỗi sáng thứ 2 4 6 lúc 6h30', expect: { type: 'task', skill: 'review', time: '06:30', repeat: [1, 3, 5], date: '2026-11-09' } },
  { note: 'họp nhóm học 15/11 19h-21h quán Highlands', expect: { type: 'event', eventKind: 'class', date: '2026-11-15', time: '19:00', endTime: '21:00', location: /Highlands/i } },
  { note: 'nộp bài essay cho cô trước thứ 2', expect: { type: 'event', eventKind: 'deadline', date: '2026-11-09' } },
  { note: 'Listening Cambridge 18 test 2, cuối tuần', expect: { type: 'task', skill: 'listening', date: '2026-11-07' } },
  { note: 'dictation 20p', expect: { type: 'task', skill: 'listening', date: '2026-11-07', noTime: true, durationMin: 20 } },
  { note: 'Mock test full 4 kỹ năng chủ nhật tuần sau 8h', expect: { type: 'task', skill: 'mock', date: '2026-11-15', time: '08:00' } },
  { note: 'Speaking lesson with Ms. Lan next Tuesday 7pm', expect: { type: 'event', eventKind: 'class', date: '2026-11-10', time: '19:00' } },
  { note: 'đi khám răng thứ 4 lúc 9h', expect: { type: 'event', eventKind: 'appointment', date: '2026-11-11', time: '09:00' } },
  { note: 'grammar câu điều kiện 30 phút, tối mai', expect: { type: 'task', skill: 'grammar', date: '2026-11-08', time: '20:00', durationMin: 30 } },
]

function check(item: QuickAddItem | undefined, e: Expect): string[] {
  if (!item) return ['no item']
  const bad: string[] = []
  if (item.type !== e.type) bad.push(`type ${item.type}`)
  if (item.date !== e.date) bad.push(`date ${item.date}`)
  if (e.time !== undefined && item.time !== e.time) bad.push(`time ${item.time || '∅'}`)
  if (e.noTime && item.time) bad.push(`time ${item.time}`)
  if (e.endTime !== undefined && item.endTime !== e.endTime) bad.push(`end ${item.endTime || '∅'}`)
  if (e.durationMin !== undefined && item.durationMin !== e.durationMin) bad.push(`dur ${item.durationMin}`)
  if (e.skill && item.skill !== e.skill) bad.push(`skill ${item.skill}`)
  if (e.eventKind && item.eventKind !== e.eventKind) bad.push(`kind ${item.eventKind || '∅'}`)
  if (e.location && !e.location.test(item.location)) bad.push(`location "${item.location}"`)
  if (e.repeat && item.repeatWeekdays.join(',') !== e.repeat.join(',')) bad.push(`repeat [${item.repeatWeekdays}]`)
  return bad
}

const describe = (i: QuickAddItem) =>
  [
    i.type === 'event' ? `event ${i.eventKind}` : 'task',
    `${i.date}${i.time ? ` ${i.time}` : ''}${i.endTime ? `–${i.endTime}` : ''}`,
    i.durationMin ? `${i.durationMin}′` : '',
    i.type === 'task' || i.skill !== 'other' ? i.skill : '',
    i.location ? `@${i.location}` : '',
    i.repeatWeekdays.length ? `repeat [${i.repeatWeekdays}] dates ${i.repeatDates.join(',')}` : '',
    `"${i.title}"`,
    i.confidence === 'low' ? '(low)' : '',
  ]
    .filter(Boolean)
    .join(' · ')

let pass = 0
const times: number[] = []
for (const [n, { note, expect }] of CASES.entries()) {
  try {
    const { items, unparsed, ms, raw } = await quickAdd(note, { now: NOW })
    times.push(ms)
    const bad = check(items[0], expect)
    if (!bad.length && items.length === 1) pass++
    const extra = items.length !== 1 ? ` | ${items.length} items` : ''
    console.log(`${String(n + 1).padStart(2)} ${bad.length || items.length !== 1 ? 'FAIL' : 'PASS'} | ${ms} ms | ${note} → ${items.map(describe).join(' ‖ ') || '(none)'}${unparsed ? ` | unparsed "${unparsed}"` : ''}${bad.length ? ` | wrong: ${bad.join(', ')}` : ''}${extra}`)
    if (bad.length || items.length !== 1) console.log(`   raw: ${JSON.stringify(raw)}`)
  } catch (error) {
    console.log(`${String(n + 1).padStart(2)} FAIL | ${note} → error: ${(error as Error).message}`)
  }
}
const sorted = [...times].sort((a, b) => a - b)
console.log(`\n${pass}/${CASES.length} pass · ms per call: min ${sorted[0]} · median ${sorted[Math.floor(sorted.length / 2)]} · max ${sorted.at(-1)}`)
