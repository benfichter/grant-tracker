import { duplicateKey, hostOf, normalizeUrl, normCycle, normText } from './normalize.ts'
import { ratio } from './similarity.ts'

/** The four fields identity is judged on; both Candidate and Opportunity satisfy this. */
export interface Subject {
  programName: string
  sponsor: string
  officialUrl: string
  programCycle: string
}

export interface Ref<T extends Subject = Subject> {
  subject: T
  label: string
  url: string
  host: string
  key: string
  sponsor: string
  name: string
  title: string
  cycle: string
}

export type MatchKind = 'high_confidence_duplicate' | 'manual_review'
export interface Match<T extends Subject = Subject> {
  kind: MatchKind
  reason: string
  similarity: number
  ref: Ref<T>
}

export function makeRef<T extends Subject>(s: T, label: string): Ref<T> {
  const url = normalizeUrl(s.officialUrl)
  return {
    subject: s,
    label,
    url,
    host: url.split('/')[0] ?? '',
    key: duplicateKey(s.sponsor, s.programName, s.programCycle),
    sponsor: normText(s.sponsor),
    name: normText(s.programName),
    title: normText(`${s.sponsor} ${s.programName}`),
    cycle: normCycle(s.programCycle),
  }
}

/**
 * Compare one subject against known refs. Exact normalized URL or identical sponsor+program+cycle is a
 * high-confidence duplicate; close titles, or the same host with a different cycle, need a human.
 * Two guards keep noise down: a shared URL with an unrelated name (homepage links) is only a review,
 * and same-host-different-cycle also needs the same sponsor or a loosely similar name (shared hosts
 * like umd.edu or smapply.us would otherwise flag everything).
 */
export function classify<T extends Subject>(subject: Subject, refs: Ref<T>[]): Match<T> | null {
  const c = makeRef(subject, 'candidate')

  for (const ref of refs) {
    if (c.url && c.url === ref.url) {
      const nameRatio = ratio(c.name, ref.name)
      if (nameRatio >= 0.35) return { kind: 'high_confidence_duplicate', reason: 'exact normalized URL', similarity: 1, ref }
      return { kind: 'manual_review', reason: 'same URL but different program name', similarity: nameRatio, ref }
    }
    if (c.key === ref.key) {
      return { kind: 'high_confidence_duplicate', reason: 'same sponsor + program + cycle', similarity: 1, ref }
    }
  }

  let best: Match<T> | null = null
  for (const ref of refs) {
    const r = ratio(c.title, ref.title)
    let hit: { score: number; reason: string } | null = null
    if (r >= 0.85) {
      const otherCycle = (c.cycle || ref.cycle) && c.cycle !== ref.cycle
      hit = {
        score: r,
        reason: otherCycle
          ? `same program title (${r.toFixed(2)}), different cycle ('${ref.subject.programCycle}' vs '${subject.programCycle}')`
          : `sponsor+title similarity ${r.toFixed(2)}`,
      }
    } else if (c.host && c.host === ref.host && c.cycle !== ref.cycle) {
      const nameRatio = ratio(c.name, ref.name)
      if ((c.sponsor && c.sponsor === ref.sponsor) || nameRatio >= 0.5) {
        hit = {
          score: Math.max(r, 0.5),
          reason: `same domain, different cycle ('${ref.subject.programCycle}' vs '${subject.programCycle}')`,
        }
      }
    }
    if (hit && (!best || hit.score > best.similarity)) {
      best = { kind: 'manual_review', reason: hit.reason, similarity: hit.score, ref }
    }
  }
  return best
}
