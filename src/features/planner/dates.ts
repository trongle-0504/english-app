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

export const viWeekday = (day: string) => VI_LONG[isoWeekday(day) - 1]
export const viShort = (day: string) => VI_SHORT[isoWeekday(day) - 1]
export const enWeekday = (day: string) => EN_LONG[isoWeekday(day) - 1]

/** "Thứ Bảy, 7 tháng 11". */
export function viLongDate(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${viWeekday(day)}, ${d} tháng ${m}`
}

/** "7/11". */
export function viDayMonth(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${d}/${m}`
}

/** A date chip relative to today: "T4" within the last/next 6 days, else "4/11". */
export function shortDateLabel(day: string, today: string): string {
  return Math.abs(daysBetween(day, today)) <= 6 ? viShort(day) : viDayMonth(day)
}

/** "2 giờ 15 phút", "45 phút", "1 giờ". */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} phút`
  return m ? `${h} giờ ${m} phút` : `${h} giờ`
}

/** "hôm nay", "ngày mai", "còn 5 ngày", "3 ngày trước". */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return 'hôm nay'
  if (daysLeft === 1) return 'ngày mai'
  if (daysLeft > 0) return `còn ${daysLeft} ngày`
  return `${-daysLeft} ngày trước`
}
