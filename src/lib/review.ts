import type { Candidate, CategoryId, ClaimDiff, Opportunity, Profile, ReviewItem, ReviewOutcome } from './types.ts'
import { classify, makeRef } from './dedupe.ts'
import { clusterCandidates, draftFromCluster, fundingAmounts } from './merge.ts'
import { evaluateEligibility, hasBlock } from './eligibility.ts'
import { normalizeUrl, normCycle, slugify } from './normalize.ts'

export interface BuildReviewInput {
  candidates: Candidate[]
  existing: Opportunity[]
  profile: Profile
  runId: string
  categoryId: CategoryId
  today: string
  now?: string
}

/** Where the engines' merged claims differ from what the tracker already holds. */
export function diffAgainst(existing: Opportunity, draft: Opportunity): ClaimDiff[] {
  const diffs: ClaimDiff[] = []
  const push = (field: string, tracker: string | undefined, incoming: string | undefined, same: boolean) => {
    if (tracker && incoming && !same) diffs.push({ field, tracker, incoming })
  }
  const dc = (field: 'deadlineDate' | 'deadlineTime' | 'deadlineTimezone') => draft.claims[field] ?? []
  // Deadline: report every incoming value that differs from the tracker's.
  for (const c of dc('deadlineDate')) push('deadline date', existing.deadline.date, c.value, c.value === existing.deadline.date)
  for (const c of dc('deadlineTime')) push('deadline time', existing.deadline.time, c.value, c.value === existing.deadline.time)
  push(
    'official URL',
    existing.officialUrl,
    draft.officialUrl,
    normalizeUrl(existing.officialUrl) === normalizeUrl(draft.officialUrl),
  )
  push('program cycle', existing.programCycle, draft.programCycle, normCycle(existing.programCycle) === normCycle(draft.programCycle))
  const a = fundingAmounts(existing.funding.details).join(',')
  const b = fundingAmounts(draft.funding.details).join(',')
  if (a && b && a !== b) diffs.push({ field: 'funding amounts', tracker: existing.funding.details, incoming: draft.funding.details })
  return diffs
}

const ORDER: Record<ReviewOutcome, number> = { new: 0, review: 1, duplicate: 2, excluded: 3 }

/**
 * Turn every engine's parsed rows into review items: cluster across engines, merge claims, apply the
 * eligibility rules, then classify each cluster against the tracker.
 */
export function buildReview(input: BuildReviewInput): ReviewItem[] {
  const { candidates, existing, profile, runId, categoryId, today } = input
  const now = input.now ?? new Date().toISOString()
  const refs = existing.map((o) => makeRef(o, o.id))
  const items: ReviewItem[] = []

  for (const cluster of clusterCandidates(candidates)) {
    const draft = draftFromCluster(cluster, { runId, categoryId, now })
    draft.flags.push(
      ...evaluateEligibility(
        {
          programName: draft.programName,
          sponsor: draft.sponsor,
          officialUrl: draft.officialUrl,
          eligibilitySummary: draft.eligibilitySummary,
          fundingDetails: draft.funding.details,
          notes: draft.notes,
          materialsText: draft.materialsText,
          deadlineDate: draft.deadline.date,
        },
        profile,
        today,
      ),
    )

    const match = classify(draft, refs)
    let outcome: ReviewOutcome
    let diffs: ClaimDiff[] = []
    if (match?.kind === 'high_confidence_duplicate') {
      outcome = 'duplicate'
      const tracked = existing.find((o) => o.id === match.ref.label)
      if (tracked) diffs = diffAgainst(tracked, draft)
    } else if (match) outcome = 'review'
    else if (hasBlock(draft.flags)) outcome = 'excluded'
    else outcome = 'new'

    items.push({
      key: '',
      outcome,
      draft,
      engines: draft.origin?.engines ?? [],
      mergeReasons: cluster.reasons,
      match: match
        ? { id: match.ref.label, programName: match.ref.subject.programName, reason: match.reason, similarity: match.similarity }
        : undefined,
      diffs,
    })
  }

  items.sort((a, b) => ORDER[a.outcome] - ORDER[b.outcome] || b.engines.length - a.engines.length)
  // Keys come from the program identity, not the row position, so a decision made on one paste still
  // applies to the same program after another engine's paste is added and the review is rebuilt.
  const used = new Set<string>()
  for (const it of items) {
    const base = it.draft.duplicateKey || slugify(it.draft.programName) || 'row'
    let key = base
    for (let n = 2; used.has(key); n++) key = `${base}#${n}`
    used.add(key)
    it.key = key
  }
  return items
}
