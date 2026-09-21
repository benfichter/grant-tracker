// Shared types. Type-only TypeScript (no enums / namespaces / parameter properties) so Node's
// native type stripping can load this from the server with no build step.

export type Engine = 'perplexity' | 'chatgpt' | 'claude' | 'gemini' | 'manual'
export type Verification = 'official' | 'secondary' | 'recurring_estimate' | 'unverified'
export type Status =
  | 'candidate'
  | 'researching'
  | 'preparing'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'skipped'
export type CategoryId =
  | 'research_program'
  | 'conference_travel'
  | 'public_interest_cohort'
  | 'study_abroad'
  | 'summer_school'
  | 'competition'
  | 'other'
export type Effort = 'low' | 'medium' | 'high'

export interface Claim {
  value: string
  engines: Engine[]
  runIds: string[]
}

export type ClaimField =
  | 'sponsor'
  | 'officialUrl'
  | 'programCycle'
  | 'location'
  | 'deadlineDate'
  | 'deadlineTime'
  | 'deadlineTimezone'
  | 'deadlineEvidence'
  | 'fundingDetails'
  | 'eligibilitySummary'
  | 'materials'
  | 'travelComponent'

export interface Flag {
  code: string
  kind: 'eligibility' | 'conflict' | 'verify' | 'excluded'
  severity: 'block' | 'warn' | 'info'
  message: string
  field?: string
  dismissed?: boolean
}

export interface Material {
  id: string
  label: string
  kind: 'document' | 'essay' | 'recommendation' | 'form' | 'other'
  required: boolean
  done: boolean
  wordLimit?: number
  charLimit?: number
  /** The essay question or instructions, pasted from the application. */
  prompt?: string
  /** For recommendations: how many are needed. */
  count?: number
}

export interface FitInputs {
  funding: number
  academic: number
  travel: number
  chance: number
  network: number
}

export interface PageDate {
  text: string
  iso?: string
  snippet: string
}

export interface PageVerification {
  checkedAt: string
  url: string
  ok: boolean
  httpStatus?: number
  finalUrl?: string
  title?: string
  textLength?: number
  nameFound: boolean
  deadlineMatch: 'exact' | 'partial' | 'none' | 'not_checked'
  dates: PageDate[]
  error?: string
  confirmedAt?: string
}

export interface Opportunity {
  id: string
  programName: string
  sponsor: string
  officialUrl: string
  programCycle: string
  category: CategoryId
  location: string
  deadline: { date?: string; time?: string; timezone?: string }
  funding: { type: string; details: string }
  eligibilitySummary: string
  materials: Material[]
  materialsText: string
  travelComponent: string
  notes: string
  fit?: FitInputs
  fitOverride?: number
  effort?: Effort
  sourceVerified: Verification
  status: Status
  duplicateKey: string
  claims: Partial<Record<ClaimField, Claim[]>>
  flags: Flag[]
  lastChecked?: string
  /** Ids of rows the person has confirmed are NOT duplicates of this one (stops the duplicate check re-flagging them). */
  notDuplicateOf?: string[]
  verification?: PageVerification
  origin?: { runId?: string; engines: Engine[]; addedAt: string; via: 'seed' | 'run' | 'manual' }
}

/** One row parsed out of a search engine's response, before merging. */
export interface Candidate {
  engine: Engine
  programName: string
  sponsor: string
  officialUrl: string
  programCycle: string
  location: string
  deadlineDate?: string
  deadlineTime?: string
  deadlineTimezone?: string
  /** Raw deadline text we could not turn into one unambiguous date. */
  deadlineText?: string
  deadlineEvidence?: string
  fundingType: string
  fundingDetails: string
  eligibilitySummary: string
  materials: string
  travelComponent: string
  notes: string
}

export type ReviewOutcome = 'new' | 'duplicate' | 'review' | 'excluded'

export interface ClaimDiff {
  field: string
  tracker: string
  incoming: string
}

export interface ReviewItem {
  key: string
  outcome: ReviewOutcome
  draft: Opportunity
  engines: Engine[]
  mergeReasons: string[]
  match?: { id: string; programName: string; reason: string; similarity: number }
  diffs: ClaimDiff[]
}

export interface Snippet {
  id: string
  title: string
  tags: string[]
  text: string
}

export interface Profile {
  summary: string
  facts: {
    citizenship: string
    pellEligible: boolean
    standing: 'undergraduate' | 'graduate'
    graduation: string
    gradCourseworkFrom?: string
    classNote: string
  }
  goals: string[]
  snippets: Snippet[]
}

export interface AuditCheck {
  code: string
  label: string
  status: 'pass' | 'warn' | 'fail' | 'info'
  detail: string
}

export interface AuditReport {
  words: number
  chars: number
  checks: AuditCheck[]
}

export interface DraftVersion {
  n: number
  createdAt: string
  source: Engine | 'me'
  text: string
  note?: string
  audit: AuditReport
}

export interface DraftFile {
  oppId: string
  materialId: string
  versions: DraftVersion[]
}

export interface PasteRecord {
  text: string
  pastedAt: string
  format: 'json' | 'csv' | 'markdown' | 'none'
  rowCount: number
  errors: string[]
}

export interface RunRecord {
  id: string
  categoryId: CategoryId
  createdAt: string
  prompts: Partial<Record<Engine, string>>
  pastes: Partial<Record<Engine, PasteRecord>>
  review: ReviewItem[]
  invalidRows: number
  decisions: Record<string, { action: 'add' | 'attach' | 'skip'; at: string; oppId?: string }>
}
