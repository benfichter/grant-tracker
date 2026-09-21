import type { Candidate, Engine } from './types.ts'
import { normalizeDate, normalizeTime, normalizeTz } from './dates.ts'

export type ParseFormat = 'json' | 'csv' | 'markdown' | 'none'
export interface ParseResult {
  format: ParseFormat
  rows: Record<string, unknown>[]
  errors: string[]
}

// ---------- citation / markup cleanup ----------

/** Strip engine citation markers ([1], 【…】, ChatGPT's private-use cite tokens, Gemini's [cite: 1]) and bold markers. */
export function cleanValue(v: string): string {
  return v
    .replace(/[^]*/g, '')
    .replace(/【[^】]*】/g, '')
    .replace(/\s*\[cite(?:_start|:[^\]]*)\]/gi, '')
    .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------- format detection ----------

function asRows(v: unknown): Record<string, unknown>[] | undefined {
  if (Array.isArray(v)) {
    const rows = v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
    return rows.length ? rows : undefined
  }
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>
    for (const val of Object.values(obj)) {
      const inner = Array.isArray(val) ? asRows(val) : undefined
      if (inner) return inner
    }
    if ('program_name' in obj || 'name' in obj || 'program' in obj) return [obj]
  }
  return undefined
}

function tryJson(s: string): Record<string, unknown>[] | undefined {
  try {
    return asRows(JSON.parse(s))
  } catch {
    return undefined
  }
}

function parseJsonBlocks(text: string): Record<string, unknown>[] | undefined {
  const fence = /```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = fence.exec(text))) {
    const rows = tryJson(m[1]!.trim())
    if (rows) return rows
  }
  const a = text.indexOf('[')
  const b = text.lastIndexOf(']')
  if (a >= 0 && b > a) {
    const rows = tryJson(text.slice(a, b + 1))
    if (rows) return rows
  }
  const c = text.indexOf('{')
  const d = text.lastIndexOf('}')
  if (c >= 0 && d > c) return tryJson(text.slice(c, d + 1))
  return undefined
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur)
      cur = ''
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
    } else cur += ch
  }
  row.push(cur)
  if (row.some((c) => c.trim())) rows.push(row)
  return rows
}

function csvToRows(text: string): Record<string, unknown>[] | undefined {
  // Skip prose before the header: start at the first line with 3+ commas.
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => (l.match(/,/g) ?? []).length >= 2)
  if (start < 0) return undefined
  const table = parseCsv(lines.slice(start).join('\n'))
  if (table.length < 2 || (table[0]?.length ?? 0) < 3) return undefined
  const header = table[0]!
  const width = header.length
  const rows = table
    .slice(1)
    .filter((r) => r.length >= Math.min(width, 3) && r.length <= width + 1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])))
  return rows.length ? rows : undefined
}

function markdownToRows(text: string): Record<string, unknown>[] | undefined {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().startsWith('|'))
  if (lines.length < 3) return undefined
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())
  const header = cells(lines[0]!)
  if (!/^[\s|:-]+$/.test(lines[1]!)) return undefined
  const rows = lines.slice(2).map((l) => {
    const row: Record<string, unknown> = {}
    cells(l).forEach((c, i) => {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(c)
      if (link) {
        row[header[i] ?? `col${i}`] = link[1]
        row._link ??= link[2]
      } else row[header[i] ?? `col${i}`] = c
    })
    return row
  })
  return rows.length ? rows : undefined
}

export function parseEngineResponse(text: string): ParseResult {
  const errors: string[] = []
  const json = parseJsonBlocks(text)
  if (json) return { format: 'json', rows: json, errors }
  const md = markdownToRows(text)
  if (md) return { format: 'markdown', rows: md, errors }
  const csv = csvToRows(text)
  if (csv) return { format: 'csv', rows: csv, errors }
  errors.push('Could not find a JSON array, markdown table or CSV in this paste.')
  return { format: 'none', rows: [], errors }
}

// ---------- row -> Candidate ----------

const ALIAS_LISTS: Record<string, string[]> = {
  program_name: ['program', 'name', 'title', 'opportunity', 'opportunity_name', 'program_title', 'fellowship'],
  sponsor: ['organization', 'organisation', 'org', 'host', 'provider', 'funder', 'sponsor_organization', 'institution'],
  official_url: ['url', 'link', 'website', 'official_link', 'official_website', 'source_url', 'application_url', 'official_page'],
  program_cycle: ['cycle', 'year', 'term', 'program_year', 'session'],
  location: ['country', 'country_or_location', 'city', 'place'],
  deadline_raw: ['deadline', 'deadlines', 'application_deadline', 'due_date', 'close_date', 'closes', 'apply_by'],
  deadline_date: ['deadline_date_iso'],
  deadline_time: ['time', 'deadline_clock'],
  deadline_timezone: ['timezone', 'time_zone', 'tz'],
  deadline_evidence: ['deadline_quote', 'deadline_source', 'evidence', 'source_quote', 'deadline_text'],
  funding_type: ['funding', 'award_type'],
  funding_details: ['funding_amount', 'stipend', 'award', 'benefits', 'what_is_covered', 'funding_summary'],
  eligibility_summary: ['eligibility', 'requirements', 'who_can_apply'],
  materials: ['application_materials', 'required_materials', 'application_requirements'],
  travel_component: ['travel', 'travel_support', 'travel_included'],
  notes: ['note', 'comments', 'description', 'summary'],
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const ALIASES = new Map<string, string>()
for (const [field, names] of Object.entries(ALIAS_LISTS)) {
  ALIASES.set(squash(field), field)
  for (const n of names) if (!ALIASES.has(squash(n))) ALIASES.set(squash(n), field)
}

function flatten(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  const put = (k: string, v: unknown) => {
    if (v === null || v === undefined) return
    if (Array.isArray(v)) return put(k, v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('; '))
    if (typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) put(`${k}_${sk}`, sv)
      return
    }
    const s = cleanValue(String(v))
    if (s && !/^(n\/?a|none|null|not stated|unknown|tbd)$/i.test(s)) out[k] = s
  }
  for (const [k, v] of Object.entries(raw)) put(k, v)
  return out
}

export function toCandidate(raw: Record<string, unknown>, engine: Engine): Candidate {
  const flat = flatten(raw)
  const f: Record<string, string> = {}
  const extra: string[] = []
  for (const [k, v] of Object.entries(flat)) {
    if (k === '_link') {
      f.official_url ??= v
      continue
    }
    const canon = ALIASES.get(squash(k))
    if (!canon) extra.push(`${k}: ${v}`)
    else if (!f[canon]) f[canon] = v
  }

  let deadlineDate: string | undefined
  let deadlineText: string | undefined
  if (f.deadline_date) {
    deadlineDate = normalizeDate(f.deadline_date)
    if (!deadlineDate) deadlineText = f.deadline_date
  }
  if (!deadlineDate && f.deadline_raw) {
    deadlineDate = normalizeDate(f.deadline_raw)
    if (!deadlineDate) deadlineText ??= f.deadline_raw
  }
  const deadlineTime = normalizeTime(f.deadline_time) ?? normalizeTime(f.deadline_raw)
  const deadlineTimezone = normalizeTz(f.deadline_timezone) ?? normalizeTz(f.deadline_raw) ?? normalizeTz(f.deadline_time)

  return {
    engine,
    programName: f.program_name ?? '',
    sponsor: f.sponsor ?? '',
    officialUrl: f.official_url ?? '',
    programCycle: f.program_cycle ?? '',
    location: f.location ?? '',
    deadlineDate,
    deadlineTime,
    deadlineTimezone,
    deadlineText,
    deadlineEvidence: f.deadline_evidence,
    fundingType: f.funding_type ?? '',
    fundingDetails: f.funding_details ?? '',
    eligibilitySummary: f.eligibility_summary ?? '',
    materials: f.materials ?? '',
    travelComponent: f.travel_component ?? '',
    notes: [f.notes, ...extra].filter(Boolean).join('; '),
  }
}

export interface ParsedPaste extends ParseResult {
  candidates: Candidate[]
  invalidRows: number
}

export function parsePaste(text: string, engine: Engine): ParsedPaste {
  const res = parseEngineResponse(text)
  const all = res.rows.map((r) => toCandidate(r, engine))
  const candidates = all.filter((c) => c.programName)
  return { ...res, candidates, invalidRows: all.length - candidates.length }
}
