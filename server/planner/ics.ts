// One event as an iCalendar file: the phone's own calendar then rings even when the PC (and so the push server) is off.
import type { PlannerEvent } from '../../src/types/planner.ts'
import { addDays } from '../../src/features/planner/dates.ts'

/** Escapes text for an iCalendar value: backslash, comma, semicolon and newlines. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Lines longer than 75 octets are folded (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let current = ''
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > (parts.length ? 74 : 75)) {
      parts.push(current)
      current = char
    } else current += char
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const stamp = (day: string, time: string) => `${day.replace(/-/g, '')}T${time.replace(':', '')}00`

export function eventToIcs(event: PlannerEvent, now = new Date()): string {
  const dtstamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NeSy//Planner//VI',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@nesy`,
    `DTSTAMP:${dtstamp}`,
  ]
  if (event.time) {
    lines.push(`DTSTART;TZID=Asia/Ho_Chi_Minh:${stamp(event.date, event.time)}`)
    if (event.endTime) lines.push(`DTEND;TZID=Asia/Ho_Chi_Minh:${stamp(event.date, event.endTime)}`)
  } else {
    lines.push(`DTSTART;VALUE=DATE:${event.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(event.date, 1).replace(/-/g, '')}`)
  }
  lines.push(`SUMMARY:${icsEscape(event.title)}`)
  if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`)
  if (event.notes) lines.push(`DESCRIPTION:${icsEscape(event.notes)}`)
  for (const minutes of event.remind) {
    // A date-only event starts at midnight in the calendar; the planner counts from 08:00, so shift by 8 hours.
    const offset = event.time ? minutes : minutes - 8 * 60
    const trigger = offset >= 0 ? `-PT${offset}M` : `PT${-offset}M`
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(event.title)}`, `TRIGGER:${trigger}`, 'END:VALARM')
  }
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return `${lines.map(fold).join('\r\n')}\r\n`
}

/** A safe ASCII file name for the download. */
export function icsFileName(event: PlannerEvent): string {
  const slug = event.title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
  return `${slug || 'su-kien'}.ics`
}
