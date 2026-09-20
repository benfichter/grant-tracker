import type { PageDate } from './types.ts'
import { findDates } from './dates.ts'
import { normText } from './normalize.ts'

export interface PageScan {
  title?: string
  textLength: number
  nameFound: boolean
  deadlineMatch: 'exact' | 'partial' | 'none' | 'not_checked'
  dates: PageDate[]
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-' }

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
      if (dec) return String.fromCodePoint(+dec)
      if (hex) return String.fromCodePoint(parseInt(hex, 16))
      return ENTITIES[String(name).toLowerCase()] ?? m
    })
    .replace(/[ \t\r\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

const GENERIC = new Set(['program', 'programs', 'fellowship', 'fellows', 'scholarship', 'scholarships', 'scholars', 'award', 'the', 'and', 'for', 'of'])
/** Words that, right before a date, mean it is a deadline (not e.g. an "opens" or "notified" date). */
const KEYWORDS = /deadline|\bdue\b|apply by|closes?\b|closing|submit(?:ted)? by|final date|no later than/i
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/**
 * Report what an official page actually says: whether the program name appears, and which dates it contains
 * (with context). This only reports; it never decides a deadline is correct.
 */
export function scanPage(html: string, opts: { programName: string; deadlineDate?: string }): PageScan {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim()
  const text = htmlToText(html)
  const hay = normText(text)

  const tokens = normText(opts.programName).split(' ').filter((t) => t.length >= 3 && !GENERIC.has(t))
  const nameFound = tokens.length > 0 && tokens.filter((t) => hay.includes(t)).length / tokens.length >= 0.7

  const seen = new Set<string>()
  const dates: (PageDate & { score: number })[] = []
  for (const d of findDates(text)) {
    // Work within the date's own line so a neighbouring sentence's keywords can't leak in.
    const lineStart = text.lastIndexOf('\n', d.index) + 1
    const lineEnd = text.indexOf('\n', d.index)
    const line = text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd)
    const at = d.index - lineStart
    const snippet = line.slice(Math.max(0, at - 90), at + d.text.length + 60).replace(/\s+/g, ' ').trim()
    const key = d.iso + '|' + snippet
    if (seen.has(key)) continue
    seen.add(key)
    dates.push({ text: d.text, iso: d.iso, snippet, score: KEYWORDS.test(line.slice(Math.max(0, at - 50), at)) ? 1 : 0 })
  }
  dates.sort((a, b) => b.score - a.score)

  let deadlineMatch: PageScan['deadlineMatch'] = 'not_checked'
  if (opts.deadlineDate) {
    if (dates.some((d) => d.iso === opts.deadlineDate)) deadlineMatch = 'exact'
    else {
      const [, mm, dd] = /^\d{4}-(\d{2})-(\d{2})$/.exec(opts.deadlineDate) ?? []
      const month = MONTH_NAMES[Number(mm) - 1]
      const day = Number(dd)
      const partial =
        month &&
        new RegExp(`\\b(?:${month}|${month.slice(0, 3)}\\.?)\\s+${day}(?:st|nd|rd|th)?\\b|\\b${day}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${month}|${month.slice(0, 3)})\\b`, 'i').test(text)
      deadlineMatch = partial ? 'partial' : 'none'
    }
  }

  return {
    title,
    textLength: text.length,
    nameFound,
    deadlineMatch,
    dates: dates.slice(0, 12).map(({ score: _s, ...d }) => d),
  }
}
