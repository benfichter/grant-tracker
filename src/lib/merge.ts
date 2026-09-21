import type { Candidate, CategoryId, Claim, ClaimField, Engine, Flag, Material, Opportunity } from './types.ts'
import { duplicateKey, hostOf, makeId, normalizeUrl, normCycle, normText } from './normalize.ts'
import { makeRef } from './dedupe.ts'
import { ratio } from './similarity.ts'
import { AGGREGATOR_HOSTS } from './eligibility.ts'

export const ENGINE_LABEL: Record<Engine, string> = {
  perplexity: 'Perplexity',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  manual: 'Tracker/manual',
}

// ---------- clustering ----------

export interface Cluster {
  members: Candidate[]
  reasons: string[]
}

/**
 * Group candidates that are the same program, across engines and within one engine's list.
 * Same normalized URL (with a related name), same sponsor+program+cycle, or a near-identical
 * title with a matching cycle all merge automatically.
 */
export function clusterCandidates(cands: Candidate[]): Cluster[] {
  const refs = cands.map((c) => makeRef(c, c.engine))
  const parent = cands.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const links: { a: number; b: number; reason: string }[] = []

  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const A = refs[i]!
      const B = refs[j]!
      let reason: string | undefined
      if (A.url && A.url === B.url && ratio(A.name, B.name) >= 0.4) reason = 'same URL'
      else if (A.key === B.key) reason = 'same sponsor + program + cycle'
      else if (ratio(A.title, B.title) >= 0.85 && (A.cycle === B.cycle || !A.cycle || !B.cycle)) reason = 'near-identical title'
      if (reason) {
        parent[find(i)] = find(j)
        links.push({ a: i, b: j, reason })
      }
    }
  }

  const groups = new Map<number, Cluster>()
  cands.forEach((c, i) => {
    const root = find(i)
    const g = groups.get(root) ?? { members: [], reasons: [] }
    g.members.push(c)
    groups.set(root, g)
  })
  for (const l of links) {
    const g = groups.get(find(l.a))!
    if (!g.reasons.includes(l.reason)) g.reasons.push(l.reason)
  }
  return [...groups.values()]
}

// ---------- claims ----------

const CLAIM_FIELDS: ClaimField[] = [
  'sponsor',
  'officialUrl',
  'programCycle',
  'location',
  'deadlineDate',
  'deadlineTime',
  'deadlineTimezone',
  'deadlineEvidence',
  'fundingDetails',
  'eligibilitySummary',
  'materials',
  'travelComponent',
]
/** Fields where several values mean the engines genuinely disagree (free-text fields differ by phrasing). */
const CONFLICT_FIELDS: ClaimField[] = ['deadlineDate', 'deadlineTime', 'deadlineTimezone', 'officialUrl', 'programCycle']
const MAJORITY_FIELDS = new Set<ClaimField>(['sponsor', 'officialUrl', 'programCycle', 'location', 'deadlineDate', 'deadlineTime', 'deadlineTimezone'])

function claimGroupKey(field: ClaimField, value: string): string {
  if (field === 'officialUrl') return normalizeUrl(value)
  if (field === 'programCycle') return normCycle(value)
  if (field === 'deadlineDate' || field === 'deadlineTime' || field === 'deadlineTimezone') return value
  return normText(value)
}

function valueOf(c: Candidate, field: ClaimField): string {
  const v = (c as unknown as Record<string, string | undefined>)[field]
  return (v ?? '').trim()
}

export function buildClaims(members: Candidate[], runId: string): Opportunity['claims'] {
  const claims: Opportunity['claims'] = {}
  for (const field of CLAIM_FIELDS) {
    const groups = new Map<string, Claim>()
    for (const m of members) {
      const value = valueOf(m, field)
      if (!value) continue
      const key = claimGroupKey(field, value)
      const g = groups.get(key) ?? { value, engines: [], runIds: [] }
      if (!g.engines.includes(m.engine)) g.engines.push(m.engine)
      if (runId && !g.runIds.includes(runId)) g.runIds.push(runId)
      groups.set(key, g)
    }
    if (groups.size) claims[field] = [...groups.values()]
  }
  return claims
}

const isAggregator = (url: string) => {
  const h = hostOf(url)
  return !!h && AGGREGATOR_HOSTS.some((a) => h === a || h.endsWith('.' + a))
}

/** Pick the claim most engines agree on. A tie returns undefined for `strict` (deadlines) so we never guess. */
export function pickClaim(field: ClaimField, claims: Claim[] | undefined, strict = false): string | undefined {
  if (!claims?.length) return undefined
  if (!MAJORITY_FIELDS.has(field)) return [...claims].sort((a, b) => b.value.length - a.value.length)[0]!.value
  const top = Math.max(...claims.map((c) => c.engines.length))
  const best = claims.filter((c) => c.engines.length === top)
  if (best.length > 1 && strict) return undefined
  if (field === 'officialUrl') return (best.find((c) => !isAggregator(c.value)) ?? best[0]!).value
  return best[0]!.value
}

export function fundingAmounts(text: string): number[] {
  const out = new Set<number>()
  for (const m of text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s?[kK])?/g)) {
    let n = parseFloat(m[1]!.replace(/,/g, ''))
    if (m[2]) n *= 1000
    if (n >= 50) out.add(n)
  }
  return [...out].sort((a, b) => a - b)
}

const engineList = (c: Claim) => c.engines.map((e) => ENGINE_LABEL[e]).join(' + ')

/** Rebuild the conflict flags from the claim table. Deterministic, so safe to call after every merge. */
export function conflictFlags(claims: Opportunity['claims']): Flag[] {
  const flags: Flag[] = []
  const LABEL: Partial<Record<ClaimField, string>> = {
    deadlineDate: 'Deadline date',
    deadlineTime: 'Deadline time',
    deadlineTimezone: 'Deadline timezone',
    officialUrl: 'Official URL',
    programCycle: 'Program cycle',
  }
  for (const field of CONFLICT_FIELDS) {
    const list = claims[field]
    if (list && list.length > 1) {
      flags.push({
        code: `conflict_${field}`,
        kind: 'conflict',
        severity: field === 'deadlineDate' ? 'warn' : 'info',
        field,
        message: `${LABEL[field]} disagreement: ${list.map((c) => `${c.value} (${engineList(c)})`).join(' vs ')}`,
      })
    }
  }
  const funding = claims.fundingDetails
  if (funding && funding.length > 1) {
    const sets = funding.map((c) => fundingAmounts(c.value)).filter((s) => s.length)
    const distinct = new Set(sets.map((s) => s.join(',')))
    if (distinct.size > 1) {
      flags.push({
        code: 'conflict_fundingAmounts',
        kind: 'conflict',
        severity: 'warn',
        field: 'fundingDetails',
        message: `Funding amounts disagree: ${funding
          .filter((c) => fundingAmounts(c.value).length)
          .map((c) => `${fundingAmounts(c.value).map((n) => '$' + n.toLocaleString('en-US')).join('/')} (${engineList(c)})`)
          .join(' vs ')}`,
      })
    }
  }
  return flags
}

// ---------- materials ----------

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, a: 1, an: 1 }

export function materialsFromText(text: string): Material[] {
  if (!text.trim()) return []
  let parts = text.split(/;|\n|•|•/).map((s) => s.trim()).filter(Boolean)
  if (parts.length === 1) {
    const commas = parts[0]!.split(/,\s*/).map((s) => s.trim()).filter(Boolean)
    if (commas.length >= 2 && commas.every((s) => s.length < 45)) parts = commas
  }
  const used = new Set<string>()
  return parts.map((label) => {
    let id = normText(label).replace(/ /g, '-').slice(0, 40) || 'item'
    for (let i = 2; used.has(id); i++) id = `${id}-${i}`
    used.add(id)
    const rec = /(\d+|one|two|three|four)\s+(?:professional\s+|academic\s+)?(?:letters?\s+of\s+)?(?:recommendations?|references?|recommenders?)/i.exec(label)
    const kind: Material['kind'] = rec
      ? 'recommendation'
      : /essay|statement|short[- ]answer|personal|question|responses?|proposal|cover letter/i.test(label)
        ? 'essay'
        : /resume|cv|transcript|passport|portfolio|certificate/i.test(label)
          ? 'document'
          : /form|fafsa|myea|application/i.test(label)
            ? 'form'
            : 'other'
    const m: Material = { id, label, kind, required: true, done: false }
    if (rec) {
      const raw = rec[1]!.toLowerCase()
      m.count = /^\d+$/.test(raw) ? +raw : (WORDS[raw] ?? 1)
    }
    return m
  })
}

// ---------- draft opportunity ----------

export interface DraftContext {
  runId: string
  categoryId: CategoryId
  now: string
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? ''
}

export function draftFromCluster(cluster: Cluster, ctx: DraftContext): Opportunity {
  const { members } = cluster
  const claims = buildClaims(members, ctx.runId)
  const programName = mostCommon(members.map((m) => m.programName))
  const sponsor = pickClaim('sponsor', claims.sponsor) ?? ''
  const programCycle = pickClaim('programCycle', claims.programCycle) ?? ''
  const notes = [
    ...new Set(members.map((m) => m.notes).filter(Boolean)),
  ].join('; ')
  const chosenDate = pickClaim('deadlineDate', claims.deadlineDate, true)
  const unparsed = members.find((m) => m.deadlineText && !m.deadlineDate)?.deadlineText
  const materialsText = pickClaim('materials', claims.materials) ?? ''

  return {
    id: '',
    programName,
    sponsor,
    officialUrl: pickClaim('officialUrl', claims.officialUrl) ?? '',
    programCycle,
    category: ctx.categoryId,
    location: pickClaim('location', claims.location) ?? '',
    deadline: {
      date: chosenDate,
      time: pickClaim('deadlineTime', claims.deadlineTime, true),
      timezone: pickClaim('deadlineTimezone', claims.deadlineTimezone, true),
    },
    funding: { type: members.map((m) => m.fundingType).find(Boolean) ?? '', details: pickClaim('fundingDetails', claims.fundingDetails) ?? '' },
    eligibilitySummary: pickClaim('eligibilitySummary', claims.eligibilitySummary) ?? '',
    materials: materialsFromText(materialsText),
    materialsText,
    travelComponent: pickClaim('travelComponent', claims.travelComponent) ?? '',
    notes: [notes, !chosenDate && unparsed ? `Unparsed deadline text: ${unparsed}` : ''].filter(Boolean).join('; '),
    sourceVerified: 'unverified',
    status: 'candidate',
    duplicateKey: duplicateKey(sponsor, programName, programCycle),
    claims,
    flags: conflictFlags(claims),
    origin: { runId: ctx.runId, engines: [...new Set(members.map((m) => m.engine))], addedAt: ctx.now, via: 'run' },
  }
}

/** Give a draft its final id (unique among `taken`) and refresh derived fields. */
export function finalizeDraft(draft: Opportunity, taken: Set<string>): Opportunity {
  return {
    ...draft,
    id: draft.id || makeId(draft.programName, draft.programCycle, taken),
    duplicateKey: duplicateKey(draft.sponsor, draft.programName, draft.programCycle),
  }
}

/**
 * Fold a new run's claims into an existing tracker row WITHOUT changing its values. The row's own values are
 * added as 'manual' claims first so any disagreement with the engines shows up as a conflict flag.
 */
export function attachClaims(existing: Opportunity, draft: Opportunity): Opportunity {
  const claims: Opportunity['claims'] = JSON.parse(JSON.stringify(existing.claims ?? {}))
  const own: Partial<Record<ClaimField, string | undefined>> = {
    deadlineDate: existing.deadline.date,
    deadlineTime: existing.deadline.time,
    deadlineTimezone: existing.deadline.timezone,
    officialUrl: existing.officialUrl,
    programCycle: existing.programCycle,
    fundingDetails: existing.funding.details,
  }
  const add = (field: ClaimField, value: string, engines: Engine[], runIds: string[]) => {
    const list = (claims[field] ??= [])
    const key = claimGroupKey(field, value)
    const hit = list.find((c) => claimGroupKey(field, c.value) === key)
    if (hit) {
      for (const e of engines) if (!hit.engines.includes(e)) hit.engines.push(e)
      for (const r of runIds) if (!hit.runIds.includes(r)) hit.runIds.push(r)
    } else list.push({ value, engines: [...engines], runIds: [...runIds] })
  }
  for (const [field, value] of Object.entries(own) as [ClaimField, string | undefined][]) {
    if (value) add(field, value, ['manual'], [])
  }
  for (const [field, list] of Object.entries(draft.claims) as [ClaimField, Claim[]][]) {
    for (const c of list) add(field, c.value, c.engines, c.runIds)
  }
  return {
    ...existing,
    claims,
    flags: [...existing.flags.filter((f) => f.kind !== 'conflict'), ...conflictFlags(claims)],
    origin: existing.origin
      ? { ...existing.origin, engines: [...new Set([...existing.origin.engines, ...(draft.origin?.engines ?? [])])] }
      : existing.origin,
  }
}
