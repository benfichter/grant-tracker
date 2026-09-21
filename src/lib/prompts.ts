import type { Category } from './categories.ts'
import type { Engine, Material, Opportunity, Profile, Snippet } from './types.ts'
import { hostOf } from './normalize.ts'

const ENGINE_NOTE: Record<Exclude<Engine, 'manual'>, string> = {
  perplexity: 'Use Labs / Deep Research mode and open the official pages rather than relying on search snippets.',
  chatgpt: 'Use Deep Research and open the official pages rather than relying on search snippets.',
  claude: 'Use web search / research mode and open the official pages rather than relying on search snippets.',
  gemini: 'Use Deep Research and open the official pages rather than relying on search snippets.',
}

export const OUTPUT_SCHEMA = `[
  {
    "program_name": "string, exact official name",
    "sponsor": "string, the organization that runs/funds it",
    "official_url": "string, the program's OWN page (sponsor domain), or null",
    "program_cycle": "string, e.g. 'Summer 2027' or 'February 2027'",
    "location": "string, country / city / 'remote'",
    "deadline_date": "YYYY-MM-DD, or null if the upcoming cycle's deadline is not posted",
    "deadline_time": "HH:MM 24-hour, or null",
    "deadline_timezone": "IANA zone like America/New_York, or null",
    "deadline_evidence": "the exact sentence from the official page that states the deadline, or why it is null",
    "funding_type": "stipend | scholarship | travel_grant | fee_waiver | salary | none",
    "funding_details": "exactly what is covered and any dollar amounts, from the official page",
    "eligibility_summary": "quote how the page treats current undergraduates; note citizenship and class-year limits",
    "materials": "application materials, incl. number of recommenders and essay prompts",
    "travel_component": "yes / no / details",
    "notes": "anything else worth knowing"
  }
]`

export interface DiscoveryPromptInput {
  category: Category
  profile: Profile
  opportunities: Opportunity[]
  engine: Exclude<Engine, 'manual'>
  today: string
}

export function buildDiscoveryPrompt(i: DiscoveryPromptInput): string {
  const tracked = i.opportunities
    .slice(0, 80)
    .map((o) => `- ${o.programName}${o.programCycle ? ` (${o.programCycle})` : ''}${o.officialUrl ? ` - ${hostOf(o.officialUrl)}` : ''}`)
    .join('\n')
  return `Today is ${i.today}. You are helping me find funded opportunities. ${ENGINE_NOTE[i.engine]}

## About me
${i.profile.summary}

## Task: ${i.category.label}
${i.category.focus}

Suggested searches (adapt them, do not limit yourself to them):
${i.category.queryHints.map((q) => `- ${q}`).join('\n')}

## Hard rules
1. Only programs that accept a CURRENT U.S. undergraduate graduating ${i.profile.facts.graduation}. Skip recent-graduate-only, degree-holder-only, graduate-only and professional-only programs. If a page is unclear about undergraduates, include it and say so in eligibility_summary.
2. I am NOT Pell-eligible: exclude Gilman and any Pell-restricted award.
3. Skip fee-based leadership conferences, commercial study-tour companies, and any lead whose only source is an aggregator or listicle site.
4. official_url must be the program's own page. If you cannot find it, use null. Do not link to aggregators.
5. NEVER guess. If the upcoming cycle's deadline is not posted, set deadline_date to null and say so in deadline_evidence. If a program recurs but the next date is unposted, include it with program_cycle set to the most recent cycle you can confirm.
6. Prefer cycles whose deadline is after ${i.today} and within the next 12 months.
7. deadline_evidence and eligibility_summary must be quotes or close paraphrases from the official page, not your inference.
8. Return 8 to 20 results, best fits first.

## Already in my tracker (skip these unless you found a DIFFERENT deadline for them)
${tracked || '(nothing yet)'}

## Output format
Return ONLY one JSON array inside a \`\`\`json code block, with no commentary before or after. Use null for unknown values. Each element:

${OUTPUT_SCHEMA}`
}

export interface DraftPromptInput {
  opportunity: Opportunity
  material: Material
  profile: Profile
  snippets: Snippet[]
  today: string
}

export function buildDraftPrompt(i: DraftPromptInput): string {
  const o = i.opportunity
  const m = i.material
  const limit = m.wordLimit
    ? `Hard limit: ${m.wordLimit} words. Aim for ${Math.round(m.wordLimit * 0.92)}-${m.wordLimit}.`
    : m.charLimit
      ? `Hard limit: ${m.charLimit} characters including spaces.`
      : 'No stated length limit; keep it tight.'
  return `Write a draft of one application material. Today is ${i.today}.

## Program
${o.programName}${o.sponsor ? `, run by ${o.sponsor}` : ''}${o.programCycle ? ` (${o.programCycle})` : ''}
${o.officialUrl ? `Page: ${o.officialUrl}\n` : ''}${o.funding.details ? `What it offers: ${o.funding.details}\n` : ''}${o.eligibilitySummary ? `Who it is for: ${o.eligibilitySummary}\n` : ''}
## What I need
${m.label}
${m.prompt ? `\nPrompt / question, verbatim:\n"""\n${m.prompt}\n"""\n` : ''}
${limit}

## Facts about me (the ONLY facts you may use)
${i.profile.summary}
${i.snippets.length ? '\nMy own wording for specific pieces:\n' + i.snippets.map((s) => `### ${s.title}\n${s.text}`).join('\n\n') : ''}

## Rules
- Do not invent achievements, numbers, affiliations or quotes. If the draft needs a fact I have not given you, write [NEED: what you need] and keep going.
- Do not claim Pell eligibility, first-generation status, financial hardship, or graduate-student standing. I am an undergraduate who will begin graduate-level coursework in ${i.profile.facts.gradCourseworkFrom ?? 'the future'}.
- Answer every part of the prompt above, in the order asked.
- Write in my voice: direct, specific, no filler. Return only the draft text.`
}
