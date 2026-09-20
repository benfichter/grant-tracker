const MONTH_ABBR: Record<string, string> = {
  jan: 'january',
  feb: 'february',
  mar: 'march',
  apr: 'april',
  jun: 'june',
  jul: 'july',
  aug: 'august',
  sep: 'september',
  sept: 'september',
  oct: 'october',
  nov: 'november',
  dec: 'december',
}

export function normText(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function normCycle(s: string | undefined): string {
  return normText(s)
    .split(' ')
    .filter(Boolean)
    .map((w) => MONTH_ABBR[w] ?? w)
    .join(' ')
}

/** Lowercase host, strip www, query string, fragment and trailing slash. */
export function normalizeUrl(url: string | undefined): string {
  let u = (url ?? '').trim()
  if (!u) return ''
  if (!u.includes('://')) u = 'http://' + u
  let parsed: URL
  try {
    parsed = new URL(u)
  } catch {
    return ''
  }
  let host = parsed.hostname.toLowerCase()
  if (host.startsWith('www.')) host = host.slice(4)
  return host + parsed.pathname.replace(/\/+$/, '')
}

export function hostOf(url: string | undefined): string {
  return normalizeUrl(url).split('/')[0] ?? ''
}

export function duplicateKey(sponsor: string, program: string, cycle: string): string {
  return [normText(sponsor), normText(program), normCycle(cycle)].join('|')
}

export function slugify(s: string): string {
  return normText(s).replace(/ /g, '-').slice(0, 60).replace(/-+$/, '')
}

export function makeId(programName: string, cycle: string, taken: Set<string>): string {
  const year = /(20\d{2})/.exec(cycle)?.[1]
  const base = [slugify(programName) || 'opportunity', year].filter(Boolean).join('-')
  let id = base
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`
  return id
}
