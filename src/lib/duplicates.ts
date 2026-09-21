import type { Opportunity } from './types.ts'
import { normalizeUrl, normCycle, normText } from './normalize.ts'
import { ratio } from './similarity.ts'
import { fundingAmounts } from './merge.ts'
import { isActive } from './deadlines.ts'

// A second, independent duplicate check. dedupe.ts decides on identity keys (URL, sponsor+program+cycle,
// title similarity) as a lead comes in. This one scores every pair of tracker rows on many data points at
// once and keeps the evidence, so a pair that no single rule catches (same page under a different name,
// same program with a re-worded cycle) still surfaces, and the person can see why.

/** The fields the scorer reads; both a tracker row and a not-yet-added draft satisfy this. */
export type DupSubject = Pick<Opportunity, 'programName' | 'sponsor' | 'officialUrl' | 'programCycle' | 'location' | 'deadline' | 'funding'>

export interface DupSignal {
  code: string
  label: string
  /** Signed contribution to the score. Negative signals argue the two are different cycles/programs. */
  weight: number
}

export type DupLevel = 'likely' | 'possible'
export const LIKELY = 0.7
export const POSSIBLE = 0.5

export interface DupScore {
  score: number
  level?: DupLevel
  signals: DupSignal[]
}

export interface DupPair extends DupScore {
  level: DupLevel
  a: Opportunity
  b: Opportunity
}

const STOP = new Set(['the', 'of', 'and', 'for', 'in', 'at', 'to', 'a', 'an', 'on'])
const tokens = (s: string) => normText(s).split(' ').filter((w) => w && !STOP.has(w))
const years = (s: string) => new Set(s.match(/20\d{2}/g) ?? [])
const hasPath = (normalizedUrl: string) => normalizedUrl.includes('/')

/** Share of the smaller token set that also appears in the larger (1 = one name is inside the other). */
function containment(a: string[], b: string[]): number {
  const [small, big] = a.length <= b.length ? [a, b] : [b, a]
  if (!small.length) return 0
  const inBig = new Set(big)
  return small.filter((t) => inBig.has(t)).length / small.length
}

export function scoreDuplicate(a: DupSubject, b: DupSubject): DupScore {
  const signals: DupSignal[] = []
  const add = (code: string, label: string, weight: number) => signals.push({ code, label, weight })

  // Web page: the strongest single fact, unless it is a bare domain (a shared homepage proves little).
  const ua = normalizeUrl(a.officialUrl)
  const ub = normalizeUrl(b.officialUrl)
  if (ua && ua === ub) add('url', hasPath(ua) ? 'same official page' : 'same website (homepage only)', hasPath(ua) ? 0.35 : 0.1)

  // Name: identical/near-identical, or one name wholly inside the other ("RISE Germany" in "DAAD RISE Germany (...)").
  const na = normText(a.programName)
  const nb = normText(b.programName)
  const ta = tokens(a.programName)
  const tb = tokens(b.programName)
  const r = ratio(na, nb)
  if (na && na === nb) add('name', 'identical name', 0.35)
  else if (r >= 0.85) add('name', `near-identical name (${r.toFixed(2)})`, 0.3)
  else if (Math.min(ta.length, tb.length) >= 2 && containment(ta, tb) === 1) add('name', 'one name contains the other', 0.3)
  else if (r >= 0.6) add('name', `similar name (${r.toFixed(2)})`, 0.15)

  // Sponsor.
  const sa = normText(a.sponsor)
  const sb = normText(b.sponsor)
  if (sa && sa === sb) add('sponsor', 'same sponsor', 0.1)
  else if (sa && sb && ratio(sa, sb) >= 0.8) add('sponsor', 'similar sponsor', 0.05)

  // Cycle: compare on the year, since cycle text is free-form ("Summer 2027" vs "2027 cycle (details TBA)").
  const ya = years(a.programCycle)
  const yb = years(b.programCycle)
  if (normCycle(a.programCycle) && normCycle(a.programCycle) === normCycle(b.programCycle)) add('cycle', 'same cycle', 0.1)
  else if ([...ya].some((y) => yb.has(y))) add('cycle', 'same cycle year', 0.1)
  else if (ya.size && yb.size) add('cycle', 'different cycle years', -0.2)

  // Deadline.
  if (a.deadline.date && a.deadline.date === b.deadline.date) add('deadline', `same deadline (${a.deadline.date})`, 0.2)

  // Money and place: weak on their own, useful as corroboration.
  const fa = fundingAmounts(a.funding.details)
  const fb = fundingAmounts(b.funding.details)
  if (fa.some((n) => fb.includes(n))) add('funding', 'same funding amount', 0.05)
  const la = normText(a.location)
  if (la && la === normText(b.location)) add('location', 'same location', 0.05)

  const score = Math.max(0, Math.min(1, signals.reduce((s, x) => s + x.weight, 0)))
  const rounded = Math.round(score * 100) / 100
  return { score: rounded, level: rounded >= LIKELY ? 'likely' : rounded >= POSSIBLE ? 'possible' : undefined, signals }
}

const markedDifferent = (a: Opportunity, b: Opportunity) => !!(a.notDuplicateOf?.includes(b.id) || b.notDuplicateOf?.includes(a.id))

/**
 * Every pair of active tracker rows that scores as a likely or possible duplicate, best first. Pairs the
 * person has marked "not a duplicate" are left out, as is anything already skipped/closed.
 */
export function findDuplicatePairs(opps: Opportunity[]): DupPair[] {
  const rows = opps.filter(isActive)
  const out: DupPair[] = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!
      const b = rows[j]!
      if (markedDifferent(a, b)) continue
      const s = scoreDuplicate(a, b)
      if (s.level) out.push({ ...s, level: s.level, a, b })
    }
  }
  return out.sort((x, y) => y.score - x.score)
}

/** The best-scoring existing row for a lead that is about to be added (closed rows count: a skipped duplicate is still a duplicate). */
export function bestDuplicateOf(subject: DupSubject, existing: Opportunity[]): (DupScore & { level: DupLevel; row: Opportunity }) | undefined {
  let best: (DupScore & { level: DupLevel; row: Opportunity }) | undefined
  for (const row of existing) {
    const s = scoreDuplicate(subject, row)
    if (s.level && (!best || s.score > best.score)) best = { ...s, level: s.level, row }
  }
  return best
}
