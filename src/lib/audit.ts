import type { AuditCheck, AuditReport, Material } from './types.ts'

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

const STOP = new Set([
  'about', 'above', 'after', 'again', 'also', 'answer', 'because', 'been', 'being', 'both', 'could', 'describe',
  'discuss', 'does', 'each', 'explain', 'from', 'have', 'here', 'include', 'into', 'more', 'most', 'must', 'other',
  'please', 'should', 'some', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'through', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your', 'you', 'yourself',
  'application', 'essay', 'response', 'words', 'word', 'limit',
])

/** Pull the separate asks out of an essay prompt: questions and imperative sentences. */
export function extractRequirements(prompt: string): string[] {
  const sentences = prompt
    .replace(/\s+/g, ' ')
    .split(/(?<=[.?!])\s+|\s*[\n•]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12)
  return sentences.filter((s) => /\?$/.test(s) || /^(describe|explain|discuss|tell|share|why|how|what|outline|identify|reflect|address|highlight|detail|give|provide)\b/i.test(s))
}

const stem = (w: string) => w.slice(0, 5)
const contentWords = (s: string) =>
  [...new Set((s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)))]

export function coverage(requirement: string, draft: string): number {
  const words = contentWords(requirement)
  if (!words.length) return 1
  const have = new Set(contentWords(draft).map(stem))
  return words.filter((w) => have.has(stem(w))).length / words.length
}

const NUM = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?%?/g
const numbersIn = (s: string) => [...s.matchAll(NUM)].map((m) => m[0].replace(/,/g, '').replace(/%$/, ''))

function shingles(text: string, n = 8): Set<string> {
  const w = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const out = new Set<string>()
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '))
  return out
}

export interface AuditContext {
  material?: Pick<Material, 'wordLimit' | 'charLimit' | 'prompt'>
  /** Everything the draft is allowed to draw its facts from (profile, snippets, prompt, program page text). */
  knownText: string
  pellEligible: boolean
  /** Other drafts to compare for reused text. */
  others?: { label: string; text: string }[]
}

export function auditDraft(text: string, ctx: AuditContext): AuditReport {
  const words = countWords(text)
  const chars = text.length
  const checks: AuditCheck[] = []
  const add = (code: string, label: string, status: AuditCheck['status'], detail: string) => checks.push({ code, label, status, detail })

  // length
  const { wordLimit, charLimit } = ctx.material ?? {}
  if (wordLimit) {
    if (words > wordLimit) add('length', 'Word limit', 'fail', `${words}/${wordLimit} words: over by ${words - wordLimit}.`)
    else if (words > wordLimit * 0.95) add('length', 'Word limit', 'warn', `${words}/${wordLimit} words: within 5% of the limit.`)
    else add('length', 'Word limit', 'pass', `${words}/${wordLimit} words.`)
  }
  if (charLimit) {
    if (chars > charLimit) add('chars', 'Character limit', 'fail', `${chars}/${charLimit} characters: over by ${chars - charLimit}.`)
    else add('chars', 'Character limit', 'pass', `${chars}/${charLimit} characters.`)
  }
  if (!wordLimit && !charLimit) add('length', 'Length', 'info', `${words} words, ${chars} characters (no limit set).`)

  // placeholders
  const placeholders = text.match(/\[NEED[^\]]*\]|\[(?:TODO|insert|fill)[^\]]*\]|\bTBD\b|lorem ipsum/gi)
  if (placeholders) add('placeholders', 'Placeholders', 'fail', `${placeholders.length} unresolved: ${[...new Set(placeholders)].slice(0, 4).join(', ')}`)
  else add('placeholders', 'Placeholders', 'pass', 'None left.')

  // prompt coverage (keyword heuristic)
  const prompt = ctx.material?.prompt?.trim()
  if (prompt) {
    const reqs = extractRequirements(prompt)
    if (reqs.length) {
      const missing = reqs.filter((r) => coverage(r, text) < 0.4)
      if (missing.length) {
        add('coverage', 'Answers every part of the prompt', 'warn', `Possibly not addressed (keyword check): ${missing.map((m) => `"${m.slice(0, 90)}"`).join('; ')}`)
      } else add('coverage', 'Answers every part of the prompt', 'pass', `${reqs.length} ask${reqs.length > 1 ? 's' : ''} found and each has matching content (keyword check, not a substitute for reading it).`)
    } else add('coverage', 'Answers every part of the prompt', 'info', 'Could not split the prompt into separate asks; read it against the draft yourself.')
  } else add('coverage', 'Answers every part of the prompt', 'info', 'No prompt saved for this material, so nothing to check against.')

  // claims that do not match the profile
  const claimed: string[] = []
  if (!ctx.pellEligible && /\bpell\b/i.test(text)) claimed.push('Pell')
  if (/\bfirst[- ]gen(?:eration)?\b/i.test(text)) claimed.push('first-generation')
  if (/low[- ]income|financial hardship|underprivileged|economically disadvantaged/i.test(text)) claimed.push('financial hardship / low income')
  if (/\b(?:graduate student|master'?s student|ph\.?d\.? (?:student|candidate)|doctoral (?:student|candidate))\b/i.test(text)) claimed.push('graduate standing')
  if (claimed.length) add('claims', 'Claims not in your profile', 'fail', `Mentions ${claimed.join(', ')}. None of these is in your profile.`)
  else add('claims', 'Claims not in your profile', 'pass', 'No Pell, first-gen, hardship or graduate-standing claims.')

  // numbers that do not trace back to anything you provided
  const known = new Set(numbersIn(ctx.knownText))
  const unknown = [...new Set(numbersIn(text))].filter((n) => !known.has(n) && !/^(19|20)\d{2}$/.test(n) && (n.includes('.') || Number(n) >= 10))
  if (unknown.length) add('figures', 'Figures you did not supply', 'warn', `Not found in your profile or the prompt: ${unknown.join(', ')}. Confirm each or remove it.`)
  else add('figures', 'Figures you did not supply', 'pass', 'Every number traces back to your profile or the prompt.')

  // reuse
  if (ctx.others?.length) {
    const mine = shingles(text)
    if (mine.size) {
      for (const o of ctx.others) {
        const theirs = shingles(o.text)
        const shared = [...mine].filter((s) => theirs.has(s)).length / mine.size
        if (shared >= 0.2) add('reuse', `Reuse: ${o.label}`, shared >= 0.5 ? 'warn' : 'info', `${Math.round(shared * 100)}% of this draft's phrasing appears in "${o.label}".`)
      }
    }
  }

  return { words, chars, checks }
}
