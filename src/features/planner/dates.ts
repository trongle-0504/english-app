// Calendar helpers in Asia/Ho_Chi_Minh. Pure: used by the server and the client, so both agree on "today".
// Days are 'YYYY-MM-DD' strings; arithmetic is done at UTC noon so it never crosses a day by accident.

const TZ = 'Asia/Ho_Chi_Minh'

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })

/** YYYY-MM-DD in Asia/Ho_Chi_Minh. */
export function vnDay(date: Date = new Date()): string {
  return dayFormat.format(date)
}

/** HH:mm in Asia/Ho_Chi_Minh. */
export function vnTime(date: Date = new Date()): string {
  // Some engines print midnight as "24:00".
  return timeFormat.format(date).replace(/^24/, '00')
}

/** The instant of a VN wall-clock time (VN has no daylight saving time). */
export function vnDateTime(day: string, time = '00:00'): Date {
  return new Date(`${day}T${time}:00+07:00`)
}

const noon = (day: string) => new Date(`${day}T12:00:00Z`)
const iso = (date: Date) => date.toISOString().slice(0, 10)

export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = noon(value)
  return !Number.isNaN(d.getTime()) && iso(d) === value
}

export function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function addDays(day: string, n: number): string {
  const d = noon(day)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  return ((noon(day).getUTCDay() + 6) % 7) + 1
}

/** The Monday of the week holding `day`. */
export function weekStart(day: string): string {
  return addDays(day, 1 - isoWeekday(day))
}

/** The 7 days from `start`. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** b − a in whole days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((noon(b).getTime() - noon(a).getTime()) / 86_400_000)
}

/** Minutes since midnight of an HH:mm. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

const VI_LONG = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật']
const VI_SHORT = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const EN_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const EN_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const EN_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Vietnamese names: only for the AI's calendar table, since notes say "thứ 2", "CN". The UI is in English. */
export const viWeekday = (day: string) => VI_LONG[isoWeekday(day) - 1]
export const viShort = (day: string) => VI_SHORT[isoWeekday(day) - 1]

export const enWeekday = (day: string) => EN_LONG[isoWeekday(day) - 1]
/** "Mon". */
export const shortWeekday = (day: string) => EN_SHORT[isoWeekday(day) - 1]

/** "Saturday, Nov 7". */
export function longDate(day: string): string {
  return `${enWeekday(day)}, ${dayMonth(day)}`
}

/** "Nov 7". */
export function dayMonth(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${EN_MONTH[m - 1]} ${d}`
}

/** A date chip relative to today: "Wed" within the last/next 6 days, else "Nov 4". */
export function shortDateLabel(day: string, today: string): string {
  return Math.abs(daysBetween(day, today)) <= 6 ? shortWeekday(day) : dayMonth(day)
}

/** "2h 15m", "45 min", "1h". */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} min`
  return m ? `${h}h ${m}m` : `${h}h`
}

/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return 'today'
  if (daysLeft === 1) return 'tomorrow'
  if (daysLeft > 0) return `in ${daysLeft} days`
  return daysLeft === -1 ? 'yesterday' : `${-daysLeft} days ago`
}
