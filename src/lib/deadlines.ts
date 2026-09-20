import type { Opportunity } from './types.ts'
import { addDays, daysBetween, zonedToUtc } from './dates.ts'
import { hasBlock } from './eligibility.ts'

export const REMINDER_DAYS = [28, 21, 14, 7, 3, 1]
export const WINDOW_DAYS = 45
const CLOSED = new Set(['submitted', 'accepted', 'rejected', 'skipped'])

export const isActive = (o: Opportunity) => !CLOSED.has(o.status)

export interface DeadlineEntry {
  opp: Opportunity
  date: string
  days: number
}
export interface DeadlineGroups {
  urgent: DeadlineEntry[]
  soon: DeadlineEntry[]
  upcoming: DeadlineEntry[]
  past: DeadlineEntry[]
}

export function deadlineGroups(opps: Opportunity[], today: string, windowDays = WINDOW_DAYS): DeadlineGroups {
  const g: DeadlineGroups = { urgent: [], soon: [], upcoming: [], past: [] }
  const entries = opps
    .filter(isActive)
    .flatMap((opp) => (opp.deadline.date ? [{ opp, date: opp.deadline.date, days: daysBetween(today, opp.deadline.date) }] : []))
    .filter((e) => !Number.isNaN(e.days))
    .sort((a, b) => a.days - b.days)
  for (const e of entries) {
    if (e.days < 0) g.past.push(e)
    else if (e.days <= 7) g.urgent.push(e)
    else if (e.days <= 21) g.soon.push(e)
    else if (e.days <= windowDays) g.upcoming.push(e)
  }
  return g
}

export interface VerifyEntry {
  opp: Opportunity
  reasons: string[]
}

/** Everything that still needs a human: missing/unconfirmed deadlines, open conflicts, blocking eligibility flags. */
export function verifyList(opps: Opportunity[]): VerifyEntry[] {
  const out: VerifyEntry[] = []
  for (const opp of opps.filter(isActive)) {
    const reasons: string[] = []
    if (!opp.deadline.date) reasons.push('deadline missing')
    if (opp.sourceVerified !== 'official') reasons.push(`source_verified = ${opp.sourceVerified}`)
    for (const f of opp.flags) {
      if (f.dismissed) continue
      if (f.kind === 'conflict' && f.severity !== 'info') reasons.push(f.message)
      else if (f.severity === 'block') reasons.push(`ELIGIBILITY: ${f.message}`)
    }
    if (reasons.length) out.push({ opp, reasons })
  }
  return out
}

// ---------- ICS ----------

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** RFC 5545 line folding at 75 octets. */
export function fold(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = ''
  let n = 0
  for (const ch of line) {
    const size = enc.encode(ch).length
    if (n + size > 75) {
      out.push(cur)
      cur = ' ' + ch
      n = 1 + size
    } else {
      cur += ch
      n += size
    }
  }
  out.push(cur)
  return out.join('\r\n')
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

function dtstart(date: string, time?: string, tz?: string): string {
  const ymd = date.replace(/-/g, '')
  if (!time) return `DTSTART;VALUE=DATE:${ymd}`
  const utc = tz ? zonedToUtc(date, time, tz) : undefined
  if (utc) return `DTSTART:${stamp(utc)}`
  return `DTSTART:${ymd}T${time.replace(':', '')}00`
}

/**
 * One event per deadline, with alarms at 28/21/14/7/3/1 days before. Only rows verified `official` are included,
 * and rows carrying an undismissed blocking eligibility flag are left out so you are not reminded about a program
 * you cannot apply to. Alarms that would already be in the past are skipped.
 */
export function buildIcs(opps: Opportunity[], today: string, now: Date = new Date()): { ics: string; count: number } {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//applications//tracker//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Application deadlines']
  let count = 0
  for (const o of opps) {
    const date = o.deadline.date
    if (!isActive(o) || o.sourceVerified !== 'official' || !date || hasBlock(o.flags)) continue
    if (daysBetween(today, date) < 0) continue
    count++
    const desc = [o.officialUrl, o.funding.details].filter(Boolean).map(esc).join('\\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${o.id.replace(/[^A-Za-z0-9_.-]/g, '-')}@applications.local`,
      `DTSTAMP:${stamp(now)}`,
      `SUMMARY:${esc('DEADLINE: ' + o.programName)}`,
      dtstart(date, o.deadline.time, o.deadline.timezone),
      `DESCRIPTION:${desc}`,
    )
    if (o.officialUrl) lines.push(`URL:${o.officialUrl}`)
    for (const n of REMINDER_DAYS) {
      if (daysBetween(today, addDays(date, -n)) >= 0) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(o.programName)} deadline in ${n} days`, `TRIGGER:-P${n}D`, 'END:VALARM')
      }
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return { ics: lines.map(fold).join('\r\n') + '\r\n', count }
}
