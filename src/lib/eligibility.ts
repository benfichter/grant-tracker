import type { Flag, Profile } from './types.ts'
import { hostOf } from './normalize.ts'
import { daysBetween } from './dates.ts'

export interface EligibilityInput {
  programName: string
  sponsor: string
  officialUrl: string
  eligibilitySummary: string
  fundingDetails: string
  notes: string
  materialsText?: string
  deadlineDate?: string
}

/** Aggregator / listicle sites: a lead whose only URL is one of these still needs an official page. */
export const AGGREGATOR_HOSTS = [
  'scholarships.af',
  'opportunitiesforyouth.org',
  'globalsouthopportunities.com',
  'grantedai.com',
  'fastweb.com',
  'scholarships.com',
  'scholarshipdb.net',
  'scholarshipportal.com',
  'youthop.com',
  'opportunitydesk.org',
  'cybersecurityguide.org',
  'onthinktanks.org',
  'niche.com',
  'bold.org',
  'internationalscholarships.com',
  'studyportals.com',
]

/** Fee-based leadership conferences and commercial study-tour operators. */
const COMMERCIAL = [
  /worldstrides/i,
  /national youth leadership forum/i,
  /global youth leadership/i,
  /envision (by wl|experience)/i,
  /lead(ership)? ambassadors/i,
  /\bef (tours|educational tours)\b/i,
  /global leadership adventures/i,
  /congress of future (science|medical)/i,
  /youth summit/i,
]

function has(text: string, re: RegExp): RegExpExecArray | null {
  return re.exec(text)
}

const flag = (code: string, kind: Flag['kind'], severity: Flag['severity'], message: string, field?: string): Flag => ({
  code,
  kind,
  severity,
  message,
  field,
})

/**
 * Screen a lead against the profile's hard constraints. Block flags mean "you probably cannot or should not
 * apply"; they are advisory and the reviewer can override them. Text is matched loosely on purpose: a false
 * flag costs a glance, a missed one costs an application.
 */
export function evaluateEligibility(o: EligibilityInput, profile: Profile, today: string): Flag[] {
  const flags: Flag[] = []
  const text = [o.programName, o.sponsor, o.eligibilitySummary, o.fundingDetails, o.notes, o.materialsText ?? ''].join(' \n ')
  const ident = `${o.programName} ${o.sponsor}`

  // --- Pell / Gilman ---
  if (!profile.facts.pellEligible) {
    if (/\bgilman\b/i.test(ident)) {
      flags.push(flag('pell_restricted', 'excluded', 'block', 'Gilman Scholarship is Pell-restricted; you are not Pell-eligible.'))
    } else {
      const negated = has(text, /\b(?:no|not|without|regardless of)\b[^.]{0,30}\bpell\b/i)
      // Explicit whole-program wording blocks. Anything looser (e.g. "the Gilman Guarantee is Pell-only", a single
      // sub-award of a bigger program) only warns, so one restricted award does not hide the rest of the program.
      const strong = has(
        text,
        /\bmust\s+(?:be|receive|have received|be receiving)\s+(?:a\s+|an\s+)?(?:current\s+)?(?:federal\s+)?pell\b|\bpell[- ](?:eligible|grant)?\s*(?:recipients?|students?)\s+only\b|\bpell[- ]eligible\s+only\b|\bonly\s+(?:open\s+)?to\s+(?:federal\s+)?pell\b|\brestricted\s+to\s+(?:federal\s+)?pell\b/i,
      )
      const weak = has(text, /pell[- ]?(?:grant)?[- ]?(?:eligible|recipients?|restricted|only)|(?:for|to|open to|limited to)\s+pell\b|federal pell grant recipients?/i)
      if (strong && !negated) {
        flags.push(flag('pell_restricted', 'excluded', 'block', `Looks Pell-restricted ("${strong[0].trim()}"); you are not Pell-eligible.`))
      } else if (weak && !negated) {
        flags.push(flag('pell_mention', 'eligibility', 'warn', `Mentions a Pell restriction ("${weak[0].trim()}"): check whether it covers the whole program or just one award.`, 'eligibilitySummary'))
      }
    }
  }

  // --- must already hold a degree ---
  // Explicit exclusions of current undergrads always block; softer "recent graduates" wording only blocks
  // when nothing in the text says current students / undergraduates are welcome too.
  const strongDegree =
    has(text, /\bcurrent\s+undergraduates?\W+(?:\w+\W+){0,3}?(?:not|ineligible)\s*(?:accepted|eligible|permitted|considered)?/i) ||
    has(text, /\bundergraduates?\s+(?:are\s+)?(?:not|ineligible)\b/i) ||
    has(text, /\b(?:must|should)\s+(?:have\s+)?(?:already\s+)?(?:earned|obtained|completed|hold|received)\s+(?:a|an|their)\s+(?:bachelor|master|doctoral|phd|undergraduate|graduate)/i)
  const weakDegree =
    has(text, /\brecent (?:college |university )?graduates?\b/i) ||
    has(text, /\bdegree[- ]holders?\b/i) ||
    has(text, /\bdegree\s+(?:obtained|earned|conferred|awarded)\s+(?:between|in|within)\b/i) ||
    has(text, /\bgraduated\s+(?:between|within|in the (?:last|past))\b/i)
  const inclusive = has(
    text,
    /\b(?:current\s+(?:students?|undergraduates?)|undergraduates?)\s+(?:and|or|,|&)\s+(?:recent\s+)?graduates?\b|\b(?:undergraduates?|current students?)\s+(?:are\s+)?(?:eligible|welcome|encouraged)\b|\bopen to (?:current )?(?:undergraduates?|students)\b/i,
  )
  const degreeHolder = strongDegree ?? weakDegree
  if (degreeHolder && profile.facts.standing === 'undergraduate') {
    const soft = !strongDegree && !!inclusive
    flags.push(
      flag(
        'degree_required',
        'eligibility',
        soft ? 'warn' : 'block',
        soft
          ? `Mentions recent graduates ("${degreeHolder[0].trim().slice(0, 60)}") but also says current students may apply: VERIFY.`
          : `Requires an already-completed degree ("${degreeHolder[0].trim().slice(0, 60)}"). You are a current undergraduate until ${profile.facts.graduation}.`,
        'eligibilitySummary',
      ),
    )
  }

  // --- graduate-student-only ---
  const gradOnly =
    has(text, /\b(?:graduate|grad|phd|doctoral|master'?s)\s+(?:students?\s+)?only\b/i) ||
    has(text, /\bopen (?:only )?to\s+(?:current\s+)?(?:graduate|phd|doctoral|master'?s)\s+students?\b/i) ||
    has(text, /\bpostdoc(?:toral)?s?\s+(?:only|fellows?)\b/i)
  if (gradOnly && !degreeHolder) {
    const gc = profile.facts.gradCourseworkFrom
    flags.push(
      flag(
        'grad_only',
        'eligibility',
        'block',
        `Graduate-students-only ("${gradOnly[0].trim()}"). You are an undergraduate${gc ? ` (grad coursework starts ${gc})` : ''}: VERIFY with the program whether that counts.`,
        'eligibilitySummary',
      ),
    )
  }

  // --- excludes U.S. citizens ---
  if (has(text, /\bnon-?u\.?s\.?\s+citizens?\s+only\b|\bopen only to international students\b|\bnot open to u\.?s\.? citizens\b/i)) {
    flags.push(flag('citizenship', 'eligibility', 'block', 'Appears closed to U.S. citizens.', 'eligibilitySummary'))
  }

  // --- class-year limits ---
  const classYear = has(
    text,
    /\b(?:rising|entering)\s+(?:sophomores?|juniors?|seniors?)\b|\b(?:sophomores?|juniors?)\s+(?:and|or|&)\s+(?:juniors?|seniors?)\b|\b(?:first[- ]year|freshm[ae]n|sophomores?|juniors?|seniors?)\s+only\b/i,
  )
  if (classYear) {
    flags.push(
      flag('class_year', 'eligibility', 'warn', `Class-year limit ("${classYear[0].trim()}"). ${profile.facts.classNote}`, 'eligibilitySummary'),
    )
  }

  // --- need-based ---
  const need = has(text, /\bFAFSA\b|\bfinancial need\b|\bneed[- ]based\b|\bdemonstrated need\b|\blow[- ]income\b|\bincome[- ]eligible\b/i)
  if (need) {
    flags.push(flag('need_based', 'eligibility', 'warn', `Need-based component ("${need[0]}"). You are not Pell-eligible; check whether a merit portion exists.`, 'eligibilitySummary'))
  }

  // --- fee-based ---
  const fee = has(text, /\b(?:program|registration|participation|application)\s+fee\s+(?:of\s+)?\$?\d|\bself[- ]funded\b|\btuition\s+of\s+\$\d|\bpay(?:ing)?\s+(?:a\s+)?(?:fee|tuition)\b/i)
  if (fee) {
    flags.push(flag('fee_based', 'eligibility', 'warn', `Possibly fee-based ("${fee[0].trim()}"): confirm funding covers the cost.`, 'fundingDetails'))
  }

  // --- commercial operators ---
  const commercial = COMMERCIAL.find((re) => re.test(ident))
  if (commercial) {
    flags.push(flag('commercial', 'excluded', 'block', 'Matches a fee-based leadership / commercial study-tour operator.'))
  }

  // --- aggregators ---
  const host = hostOf(o.officialUrl)
  if (host && AGGREGATOR_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
    flags.push(flag('aggregator', 'excluded', 'block', `URL is an aggregator (${host}). Find the program's own page.`, 'officialUrl'))
  }

  // --- clearance / citizenship-required (informational) ---
  if (has(text, /security clearance|clearance eligib|u\.?s\.? citizenship (?:is )?required|must be a u\.?s\.? citizen/i)) {
    flags.push(flag('citizenship_required', 'eligibility', 'info', 'Requires U.S. citizenship and/or clearance eligibility (you are a U.S. citizen).'))
  }

  // --- deadline sanity ---
  if (!o.officialUrl) flags.push(flag('no_url', 'verify', 'warn', 'No official URL supplied.', 'officialUrl'))
  if (!o.deadlineDate) flags.push(flag('no_deadline', 'verify', 'warn', 'No parseable deadline: VERIFY on the official page.', 'deadlineDate'))
  else if (daysBetween(today, o.deadlineDate) < 0) {
    flags.push(flag('deadline_passed', 'verify', 'warn', `Listed deadline ${o.deadlineDate} has already passed (may be a prior cycle).`, 'deadlineDate'))
  }

  return flags
}

export function hasBlock(flags: Flag[]): boolean {
  return flags.some((f) => f.severity === 'block' && !f.dismissed)
}
