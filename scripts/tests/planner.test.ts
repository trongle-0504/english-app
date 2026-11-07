import assert from 'node:assert/strict'
import test from 'node:test'
import { addDays, isoWeekday, vnDay, vnTime, weekStart } from '../../src/features/planner/dates.ts'
import { DEFAULT_SETTINGS, type PlannerDoc, type PlannerEvent, type PlannerTask } from '../../src/types/planner.ts'
import { calendarTable, validateBrief, validateQuickAdd, validateReschedule, validateWeekDraft, type DraftWeekInput } from '../../server/planner/ai.ts'
import { autoTickReview } from '../../server/planner/context.ts'
import { eventToIcs, icsEscape } from '../../server/planner/ics.ts'
import { dueNotifications, inQuietHours } from '../../server/planner/scheduler.ts'
import { overdueTasks } from '../../server/planner/store.ts'
import { applyRoutineToWeek } from '../../server/routes/planner.ts'

const NOW = '2026-11-01T00:00:00.000Z'

function task(over: Partial<PlannerTask>): PlannerTask {
  return { id: 't1', title: 'Task', date: '2026-11-07', skill: 'writing', source: 'manual', createdAt: NOW, updatedAt: NOW, ...over }
}

function event(over: Partial<PlannerEvent>): PlannerEvent {
  return { id: 'e1', title: 'IELTS', kind: 'exam', date: '2026-11-20', remind: [10080, 1440, 120], countdown: true, createdAt: NOW, updatedAt: NOW, ...over }
}

function doc(over: Partial<PlannerDoc> = {}): PlannerDoc {
  return { version: 1, tasks: [], events: [], routine: [], settings: { ...DEFAULT_SETTINGS }, ...over }
}

/** A VN wall-clock instant. */
const vn = (day: string, time: string) => new Date(`${day}T${time}:00+07:00`)
const keys = (d: PlannerDoc, now: Date, sent: Record<string, string> = {}) => dueNotifications(d, sent, now).map((x) => x.key)

/* ───────────── Dates ───────────── */

test('vnDay switches at midnight Vietnam time', () => {
  assert.equal(vnDay(new Date('2026-11-07T16:59:59Z')), '2026-11-07')
  assert.equal(vnDay(new Date('2026-11-07T17:00:00Z')), '2026-11-08')
  assert.equal(vnTime(new Date('2026-11-07T17:00:00Z')), '00:00')
})

test('weekStart is the Monday, also from a Sunday', () => {
  assert.equal(weekStart('2026-11-08'), '2026-11-02') // Sunday
  assert.equal(weekStart('2026-11-09'), '2026-11-09') // Monday
  assert.equal(isoWeekday('2026-11-07'), 6)
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})

test('calendarTable marks today and the weeks', () => {
  const table = calendarTable('2026-11-07')
  assert.match(table, /2026-11-07 \| Thứ Bảy \(Saturday\)\s+\| T7\s+\| tuần này\s+\| hôm nay/)
  assert.match(table, /2026-11-08 \| Chủ Nhật \(Sunday\)\s+\| CN\s+\| tuần này\s+\| ngày mai/)
  assert.match(table, /2026-11-12 \| Thứ Năm \(Thursday\)\s+\| T5\s+\| tuần sau/)
  assert.equal(table.split('\n').length, 1 + 29)
})

/* ───────────── Store, routine ───────────── */

test('apply-routine twice adds nothing the second time', () => {
  const routine = [
    { id: 'r1', weekday: 1, title: 'Ôn thẻ', time: '06:30', durationMin: 20, skill: 'review' as const },
    { id: 'r2', weekday: 6, title: 'Writing', skill: 'writing' as const },
  ]
  const first = applyRoutineToWeek([], routine, '2026-11-09', '2026-11-07', NOW)
  assert.deepEqual(first.map((t) => t.date), ['2026-11-09', '2026-11-14'])
  assert.equal(applyRoutineToWeek(first, routine, '2026-11-09', '2026-11-07', NOW).length, 0)
  // Days before today are skipped.
  assert.deepEqual(applyRoutineToWeek([], routine, '2026-11-02', '2026-11-07', NOW).map((t) => t.date), ['2026-11-07'])
})

test('overdueTasks: undone and before today, oldest first', () => {
  const d = doc({
    tasks: [
      task({ id: 'a', date: '2026-11-05' }),
      task({ id: 'b', date: '2026-11-03' }),
      task({ id: 'c', date: '2026-11-04', doneAt: NOW }),
      task({ id: 'd', date: '2026-11-07' }),
    ],
  })
  assert.deepEqual(overdueTasks(d, '2026-11-07').map((t) => t.id), ['b', 'a'])
})

test('auto-tick review only when every due card is done', () => {
  const d = doc({ tasks: [task({ id: 'r', skill: 'review' })] })
  assert.equal(autoTickReview(d, '2026-11-07', { due: 3, streak: 1, reviewedToday: 5, forecast: [] }, NOW), false)
  assert.equal(autoTickReview(d, '2026-11-07', { due: 0, streak: 1, reviewedToday: 0, forecast: [] }, NOW), false)
  assert.equal(autoTickReview(d, '2026-11-07', { due: 0, streak: 1, reviewedToday: 12, forecast: [] }, NOW), true)
  assert.equal(d.tasks[0].doneAt, NOW)
  assert.equal(autoTickReview(d, '2026-11-07', { due: 0, streak: 1, reviewedToday: 12, forecast: [] }, NOW), false)
})

/* ───────────── .ics ───────────── */

test('ics escaping and alarms', () => {
  assert.equal(icsEscape('a, b; c\\d\ne'), 'a\\, b\\; c\\\\d\\ne')
  const timed = eventToIcs(event({ title: 'IELTS, IDP', time: '08:00', location: 'IDP; Q1' }), new Date(NOW))
  assert.match(timed, /DTSTART;TZID=Asia\/Ho_Chi_Minh:20261120T080000\r\n/)
  assert.match(timed, /SUMMARY:IELTS\\, IDP\r\n/)
  assert.match(timed, /LOCATION:IDP\\; Q1\r\n/)
  assert.equal(timed.match(/BEGIN:VALARM/g)?.length, 3)
  assert.match(timed, /TRIGGER:-PT120M/)
  const dateOnly = eventToIcs(event({ remind: [60] }), new Date(NOW))
  assert.match(dateOnly, /DTSTART;VALUE=DATE:20261120\r\n/)
  // Date-only events count from 08:00: 1 hour before is 07:00, i.e. 7 hours after midnight.
  assert.match(dateOnly, /TRIGGER:PT420M/)
  assert.ok(timed.split('\r\n').every((line) => Buffer.byteLength(line) <= 75))
})

/* ───────────── Notifications ───────────── */

test('brief: generated 15 min before, sent at 07:00 once', () => {
  const d = doc()
  assert.deepEqual(keys(d, vn('2026-11-07', '06:44')), [])
  assert.deepEqual(keys(d, vn('2026-11-07', '06:46')), ['brief-gen:2026-11-07'])
  assert.deepEqual(keys(d, vn('2026-11-07', '07:00'), { 'brief-gen:2026-11-07': NOW }), ['brief:2026-11-07'])
  assert.deepEqual(keys(d, vn('2026-11-07', '07:01'), { 'brief-gen:2026-11-07': NOW, 'brief:2026-11-07': NOW }), [])
})

test('brief: catch-up at 09:30 after a missed 07:00, nothing after 11:00', () => {
  const d = doc()
  assert.deepEqual(keys(d, vn('2026-11-07', '09:30')), ['brief-gen:2026-11-07', 'brief:2026-11-07'])
  assert.deepEqual(keys(d, vn('2026-11-07', '11:00')), [])
})

test('nothing is pushed during quiet hours; it waits for quietEnd inside its window', () => {
  const d = doc({ settings: { ...DEFAULT_SETTINGS, morningTime: '06:00', quietEnd: '06:30' }, tasks: [task({ time: '23:00' })] })
  assert.equal(inQuietHours(vn('2026-11-07', '23:00'), '22:30', '06:30'), true)
  assert.equal(inQuietHours(vn('2026-11-07', '06:30'), '22:30', '06:30'), false)
  assert.deepEqual(keys(d, vn('2026-11-07', '23:05')), [])
  // Brief generation (no push) still runs in quiet hours.
  assert.deepEqual(keys(d, vn('2026-11-07', '06:10')), ['brief-gen:2026-11-07'])
  assert.deepEqual(keys(d, vn('2026-11-07', '06:31'), { 'brief-gen:2026-11-07': NOW }), ['brief:2026-11-07'])
})

test('task reminder at its time, once; snooze fires later', () => {
  const sent = { 'brief-gen:2026-11-07': NOW, 'brief:2026-11-07': NOW }
  const d = doc({ tasks: [task({ id: 'w', time: '19:00' })] })
  assert.deepEqual(keys(d, vn('2026-11-07', '18:59'), sent), [])
  assert.deepEqual(keys(d, vn('2026-11-07', '19:00'), sent), ['task:w:2026-11-07T19:00'])
  assert.deepEqual(keys(d, vn('2026-11-07', '19:30'), { ...sent, 'task:w:2026-11-07T19:00': NOW }), [])
  assert.deepEqual(keys(d, vn('2026-11-07', '21:01'), { ...sent, 'digest:2026-11-07': NOW }), []) // past the 2 h window
  const snoozedUntil = vn('2026-11-07', '20:00').toISOString()
  const snoozed = doc({ tasks: [task({ id: 'w', time: '19:00', snoozedUntil })] })
  const after = { ...sent, 'task:w:2026-11-07T19:00': NOW }
  assert.deepEqual(keys(snoozed, vn('2026-11-07', '19:30'), after), [])
  assert.deepEqual(keys(snoozed, vn('2026-11-07', '20:00'), after), [`snooze:w:${snoozedUntil}`])
  // Done tasks are never reminded.
  assert.deepEqual(keys(doc({ tasks: [task({ time: '19:00', doneAt: NOW })] }), vn('2026-11-07', '19:00'), sent), [])
})

test('digest only when something is undone', () => {
  const sent = { 'brief-gen:2026-11-07': NOW, 'brief:2026-11-07': NOW }
  assert.deepEqual(keys(doc({ tasks: [task({})] }), vn('2026-11-07', '20:30'), sent), ['digest:2026-11-07'])
  assert.deepEqual(keys(doc({ tasks: [task({ doneAt: NOW })] }), vn('2026-11-07', '20:30'), sent), [])
  assert.deepEqual(keys(doc({ tasks: [task({})] }), vn('2026-11-07', '22:31'), sent), [])
})

test('event offsets for a date-only and a timed event', () => {
  const dateOnly = doc({ events: [event({ id: 'x', date: '2026-11-20' })] })
  // 7 days before 08:00 on the 20th.
  assert.ok(keys(dateOnly, vn('2026-11-13', '08:00')).includes('event:x:10080'))
  assert.ok(keys(dateOnly, vn('2026-11-19', '08:00')).includes('event:x:1440'))
  // Due at 06:00, but that is still quiet hours (until 06:30): it goes out at 06:40, inside its 2 h window.
  assert.ok(!keys(dateOnly, vn('2026-11-20', '06:00')).includes('event:x:120'))
  assert.ok(keys(dateOnly, vn('2026-11-20', '06:40')).includes('event:x:120'))
  assert.ok(!keys(dateOnly, vn('2026-11-20', '08:00')).includes('event:x:120')) // window of 2 h passed
  const timed = doc({ events: [event({ id: 'y', time: '14:00' })] })
  assert.ok(keys(timed, vn('2026-11-20', '12:00')).includes('event:y:120'))
  assert.ok(keys(timed, vn('2026-11-19', '19:59')).includes('event:y:1440')) // 6 h catch-up window
  assert.ok(!keys(timed, vn('2026-11-19', '20:01')).includes('event:y:1440'))
})

/* ───────────── AI validation ───────────── */

test('quick add: out-of-range dates, repeats, reminders and links', () => {
  const { items, unparsed } = validateQuickAdd(
    {
      items: [
        { type: 'task', title: 'Ôn thẻ', date: '2026-11-09', time: '06:30', endTime: '', durationMin: 0, skill: 'review', eventKind: '', location: '', repeatWeekdays: [1, 3, 5, 9], remindMinutesBefore: [], confidence: 'high' },
        { type: 'event', title: 'Thi IELTS', date: '2025-01-01', time: '08:00', endTime: '07:00', durationMin: 0, skill: 'other', eventKind: 'exam', location: 'IDP', repeatWeekdays: [], remindMinutesBefore: [], confidence: 'high' },
        { type: 'task', title: '  ', date: '2026-11-07' },
      ],
      unparsed: '',
    },
    '2026-11-07',
  )
  assert.equal(items.length, 2)
  assert.deepEqual(items[0].repeatDates, ['2026-11-09', '2026-11-11', '2026-11-13'])
  assert.deepEqual(items[0].repeatWeekdays, [1, 3, 5])
  assert.equal(items[0].link, '/review')
  assert.equal(items[1].date, '2026-11-07')
  assert.equal(items[1].confidence, 'low')
  assert.equal(items[1].endTime, '')
  assert.deepEqual(items[1].remind, [10080, 1440, 120])
  assert.equal(items[1].countdown, true)
  assert.equal(unparsed, '')
})

test('brief: fields cut, order fixed to known ids', () => {
  const facts = {
    today: '2026-11-07 (Thứ Bảy)',
    tasksToday: [
      { id: 'a', title: 'A', time: '', durationMin: 30, skill: 'writing' },
      { id: 'b', title: 'B', time: '', durationMin: 30, skill: 'review' },
    ],
    overdue: [],
    events: [],
    review: { due: 0, streak: 0 },
    yesterday: { done: 0, total: 0 },
    latestScores: { writingBand: null, speakingBand: null },
    targetBand: null,
  }
  const brief = validateBrief({ headline: 'x'.repeat(100), body: 'b', greeting: 'g', focus: 'f', tip: 't', order: ['b', 'zz', 'b'], tone: 'loud' }, facts, '2026-11-07')
  assert.ok(brief.headline.length <= 60)
  assert.ok(brief.headline.endsWith('…'))
  assert.deepEqual(brief.order, ['b', 'a'])
  assert.equal(brief.tone, 'calm')
})

test('reschedule: unknown ids and out-of-range dates dropped, forgotten tasks placed', () => {
  const d = doc({
    tasks: [task({ id: 'o1', date: '2026-11-03', durationMin: 45 }), task({ id: 'o2', date: '2026-11-04', durationMin: 30 }), task({ id: 'o3', date: '2026-11-05' })],
  })
  const out = validateReschedule(
    {
      moves: [
        { taskId: 'o1', date: '2026-11-09', time: '19:00', reason: 'ok' },
        { taskId: 'ghost', date: '2026-11-08', time: '', reason: 'x' },
        { taskId: 'o2', date: '2026-12-01', time: '', reason: 'too far' },
      ],
      drop: [{ taskId: 'o1', reason: 'dup' }, { taskId: 'o3', reason: 'old' }],
      summary: 's',
    },
    d,
    '2026-11-07',
  )
  assert.deepEqual(out.moves.map((m) => [m.taskId, m.date]), [['o1', '2026-11-09'], ['o2', '2026-11-07']])
  assert.equal(out.moves[1].reason, 'Tự động: ngày còn trống')
  assert.deepEqual(out.drop.map((x) => x.taskId), ['o3'])
})

test('week draft: dates in range, days trimmed to their free minutes', () => {
  const input: DraftWeekInput = {
    week: [
      { date: '2026-11-07', weekday: 'Thứ Bảy', availableMinutes: 60, plannedMinutes: 20, reviewDue: 0 },
      { date: '2026-11-08', weekday: 'Chủ Nhật', availableMinutes: 200, plannedMinutes: 0, reviewDue: 0 },
    ],
    targetBand: null,
    latestScores: { writingBand: null, speakingBand: null },
    exam: null,
    focus: '',
    alreadyPlanned: [],
  }
  const out = validateWeekDraft(
    {
      tasks: [
        { date: '2026-11-06', time: '', durationMin: 30, skill: 'writing', title: 'past', why: '' },
        { date: '2026-11-07', time: '', durationMin: 30, skill: 'writing', title: 'W', why: '' },
        { date: '2026-11-07', time: '', durationMin: 30, skill: 'speaking', title: 'S', why: '' },
        { date: '2026-11-08', time: 'bad', durationMin: 400, skill: 'mock', title: 'Mock', why: '' },
        { date: '2026-11-08', time: '', durationMin: 5, skill: 'nope', title: 'X', why: '' },
      ],
      summary: 'ok',
    },
    input,
    '2026-11-07',
  )
  assert.deepEqual(out.tasks.map((t) => t.title), ['W', 'Mock', 'X'])
  assert.equal(out.trimmed, 1)
  assert.equal(out.tasks[1].durationMin, 180)
  assert.equal(out.tasks[1].time, '')
  assert.equal(out.tasks[2].skill, 'other')
  assert.equal(out.tasks[2].durationMin, 15)
})

test('reschedule: work and personal tasks are never dropped and do not use study capacity', () => {
  const settings = { ...DEFAULT_SETTINGS, minutesPerDay: [30, 30, 30, 30, 30, 30, 30] }
  const d = doc({
    settings,
    tasks: [
      task({ id: 'w', date: '2026-11-05', skill: 'work', durationMin: 120 }),
      task({ id: 's', date: '2026-11-05', skill: 'writing', durationMin: 30 }),
      task({ id: 'p', date: '2026-11-04', skill: 'personal', durationMin: 60 }),
    ],
  })
  const out = validateReschedule({ moves: [], drop: [{ taskId: 'w', reason: 'x' }], summary: '' }, d, '2026-11-07')
  assert.deepEqual(out.drop, [])
  // Work and personal fit today (they need no study time); the writing task takes today's 30 study minutes.
  assert.deepEqual(Object.fromEntries(out.moves.map((m) => [m.taskId, m.date])), { w: '2026-11-07', s: '2026-11-07', p: '2026-11-07' })
})
