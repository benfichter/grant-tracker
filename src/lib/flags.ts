import type { Flag, Opportunity, Profile } from './types.ts'
import { evaluateEligibility } from './eligibility.ts'

/**
 * Recompute the derived flags (eligibility, verify, excluded) from the row's current text, keeping the
 * engine-conflict flags as they are and preserving any flag the user has dismissed.
 */
export function refreshFlags(o: Opportunity, profile: Profile, today: string): Flag[] {
  const dismissed = new Set(o.flags.filter((f) => f.dismissed).map((f) => f.code))
  const conflicts = o.flags.filter((f) => f.kind === 'conflict')
  const derived = evaluateEligibility(
    {
      programName: o.programName,
      sponsor: o.sponsor,
      officialUrl: o.officialUrl,
      eligibilitySummary: o.eligibilitySummary,
      fundingDetails: o.funding.details,
      notes: o.notes,
      materialsText: o.materialsText,
      deadlineDate: o.deadline.date,
    },
    profile,
    today,
  )
  return [...conflicts, ...derived].map((f) => (dismissed.has(f.code) ? { ...f, dismissed: true } : f))
}
