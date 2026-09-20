const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, '')
  if (w.length < 3) return -1
  return MONTHS.findIndex((m) => m === w || (w.length >= 3 && m.startsWith(w) && w.length <= m.length))
}

function iso(y: number, m: number, d: number): string | undefined {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export interface FoundDate {
  text: string
  iso: string
  index: number
}

const PATTERNS: { re: RegExp; make: (m: RegExpExecArray) => string | undefined }[] = [
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, make: (m) => iso(+m[1]!, +m[2]!, +m[3]!) },
  { re: /\b(\d{4})\/(\d{1,2})\/(\d{1,2})\b/g, make: (m) => iso(+m[1]!, +m[2]!, +m[3]!) },
  {
    re: /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g,
    make: (m) => {
      const mi = monthIndex(m[1]!)
      return mi < 0 ? undefined : iso(+m[3]!, mi + 1, +m[2]!)
    },
  },
  {
    re: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g,
    make: (m) => {
      const mi = monthIndex(m[2]!)
      return mi < 0 ? undefined : iso(+m[3]!, mi + 1, +m[1]!)
    },
  },
  {
    re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
    make: (m) => {
      const a = +m[1]!
      const b = +m[2]!
      // U.S. month/day/year unless the first number can only be a day.
      return a > 12 ? iso(+m[3]!, b, a) : iso(+m[3]!, a, b)
    },
  },
]

/** Every full (year-bearing) date in the text, in order of appearance. */
export function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = []
  for (const { re, make } of PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const d = make(m)
      if (d) out.push({ text: m[0], iso: d, index: m.index })
    }
  }
  out.sort((a, b) => a.index - b.index)
  // Drop overlaps (e.g. an ISO date also matched by a looser pattern).
  return out.filter((d, i) => i === 0 || d.index >= out[i - 1]!.index + out[i - 1]!.text.length)
}

/** One unambiguous date, or undefined if there are none or several distinct ones. */
export function normalizeDate(input: string | undefined): string | undefined {
  const found = findDates(input ?? '')
  const distinct = new Set(found.map((f) => f.iso))
  return distinct.size === 1 ? [...distinct][0] : undefined
}

export function normalizeTime(input: string | undefined): string | undefined {
  const s = (input ?? '').toLowerCase()
  if (/\bnoon\b/.test(s)) return '12:00'
  const ap = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/.exec(s)
  if (ap) {
    let h = +ap[1]!
    const min = +(ap[2] ?? '0')
    if (h < 1 || h > 12 || min > 59) return undefined
    if (ap[3] === 'p' && h < 12) h += 12
    if (ap[3] === 'a' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  }
  const h24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(s)
  if (h24) return `${h24[1]!.padStart(2, '0')}:${h24[2]}`
  return undefined
}

const TZ_ALIASES: [RegExp, string][] = [
  [/\b(et|est|edt|eastern)\b/i, 'America/New_York'],
  [/\b(ct|cst|cdt|central)\b/i, 'America/Chicago'],
  [/\b(mt|mst|mdt|mountain)\b/i, 'America/Denver'],
  [/\b(pt|pst|pdt|pacific)\b/i, 'America/Los_Angeles'],
  [/\b(utc|gmt|z)\b/i, 'UTC'],
  [/\b(cet|cest)\b/i, 'Europe/Paris'],
  [/\b(bst)\b/i, 'Europe/London'],
  [/\baoe\b|anywhere on earth/i, 'Etc/GMT+12'],
]

export function normalizeTz(input: string | undefined): string | undefined {
  const s = (input ?? '').trim()
  if (!s) return undefined
  const iana = /\b([A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)\b/.exec(s)
  if (iana) return iana[1]
  for (const [re, tz] of TZ_ALIASES) if (re.test(s)) return tz
  return undefined
}

export function tzOffsetMinutes(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!)
  return (asUtc - Math.floor(utcMs / 1000) * 1000) / 60000
}

/** Wall-clock date+time in an IANA zone to a UTC Date; undefined for a bad zone or input. */
export function zonedToUtc(date: string, time: string, tz: string): Date | undefined {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return undefined
  try {
    const guess = Date.UTC(+d[1]!, +d[2]! - 1, +d[3]!, +t[1]!, +t[2]!)
    const off = tzOffsetMinutes(guess, tz)
    let utc = guess - off * 60000
    const off2 = tzOffsetMinutes(utc, tz)
    if (off2 !== off) utc = guess - off2 * 60000
    return new Date(utc)
  } catch {
    return undefined
  }
}

export function daysBetween(fromIso: string, toIso: string): number {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromIso)
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toIso)
  if (!f || !t) return NaN
  return Math.round((Date.UTC(+t[1]!, +t[2]! - 1, +t[3]!) - Date.UTC(+f[1]!, +f[2]! - 1, +f[3]!)) / 86400000)
}

export function addDays(isoDate: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)!
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]! + n))
  return d.toISOString().slice(0, 10)
}

export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
