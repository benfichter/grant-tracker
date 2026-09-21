import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEngineResponse, parsePaste, cleanValue } from './parse.ts'
import { classify, makeRef } from './dedupe.ts'
import { clusterCandidates, attachClaims, materialsFromText } from './merge.ts'
import { buildReview } from './review.ts'
import { evaluateEligibility } from './eligibility.ts'
import { NOBLEREACH, TEST_PROFILE, makeOpp } from './fixtures.ts'

const TODAY = '2026-09-20'
const codes = (flags: { code: string }[]) => flags.map((f) => f.code)

// ---------- parse ----------

test('parses a fenced JSON array wrapped in prose, stripping citation markers', () => {
  const text = `Here you go:\n\n\`\`\`json\n[{"program_name":"Quantum Fellowship [1]","sponsor":"Fake Inst","official_url":"https://fake.edu/q","deadline_date":"January 15, 2027","deadline_time":"11:59 PM","deadline_timezone":"ET","funding_details":"$5,000 stipend"}]\n\`\`\`\nSources: [1] fake.edu`
  const p = parsePaste(text, 'perplexity')
  assert.equal(p.format, 'json')
  assert.equal(p.candidates.length, 1)
  const c = p.candidates[0]!
  assert.equal(c.programName, 'Quantum Fellowship')
  assert.equal(c.deadlineDate, '2027-01-15')
  assert.equal(c.deadlineTime, '23:59')
  assert.equal(c.deadlineTimezone, 'America/New_York')
})

test('parses nested deadline objects, arrays and null-ish values', () => {
  const rows = parsePaste(
    JSON.stringify({ results: [{ name: 'X Program', organization: 'Y', url: 'https://y.org/x', deadline: { date: '2027-02-01', time: '17:00' }, materials: ['CV', 'Transcript'], notes: 'N/A' }] }),
    'chatgpt',
  )
  const c = rows.candidates[0]!
  assert.equal(c.deadlineDate, '2027-02-01')
  assert.equal(c.deadlineTime, '17:00')
  assert.equal(c.materials, 'CV; Transcript')
  assert.equal(c.notes, '')
})

test('keeps unparseable deadline text instead of guessing', () => {
  const c = parsePaste('```json\n[{"program_name":"Rolling Thing","deadline":"Rolling, apply by mid-spring"}]\n```', 'claude').candidates[0]!
  assert.equal(c.deadlineDate, undefined)
  assert.equal(c.deadlineText, 'Rolling, apply by mid-spring')
})

test('falls back to markdown tables (links become official_url) and CSV', () => {
  const md = '| Program | Sponsor | Deadline |\n|---|---|---|\n| [Alpha Fellowship](https://alpha.org/f) | Alpha | 2027-03-01 |\n'
  const m = parsePaste(md, 'perplexity')
  assert.equal(m.format, 'markdown')
  assert.equal(m.candidates[0]!.officialUrl, 'https://alpha.org/f')
  assert.equal(m.candidates[0]!.deadlineDate, '2027-03-01')

  const csv = 'program_name,sponsor,official_url\n"Beta, The Program",Beta,https://beta.org/p\nGamma,Gamma Inc,https://gamma.org\n'
  const c = parsePaste(csv, 'chatgpt')
  assert.equal(c.format, 'csv')
  assert.equal(c.candidates.length, 2)
  assert.equal(c.candidates[0]!.programName, 'Beta, The Program')
})

test('reports unparseable pastes and drops nameless rows', () => {
  assert.equal(parseEngineResponse('I could not find anything, sorry.').format, 'none')
  const p = parsePaste('```json\n[{"sponsor":"No Name Org"},{"program_name":"Has Name"}]\n```', 'claude')
  assert.equal(p.candidates.length, 1)
  assert.equal(p.invalidRows, 1)
})

test('cleanValue removes ChatGPT cite tokens and bold markers', () => {
  assert.equal(cleanValue('**Big** dealciteturn0search1 here 【4†source】 [2, 3]'), 'Big deal here')
})

test('cleanValue removes Gemini cite markers', () => {
  assert.equal(cleanValue('[cite_start]Apply by Jan 15 [cite: 1, 2] for **all** majors [cite: 3]'), 'Apply by Jan 15 for all majors')
})

// ---------- dedupe ----------

test('classify: exact URL, key, fuzzy title, same host different cycle, and new', () => {
  const refs = [makeRef(NOBLEREACH, NOBLEREACH.id)]
  const c = (over: Record<string, string>) => classify({ programName: 'Something Else Entirely', sponsor: 'Other', officialUrl: '', programCycle: '', ...over }, refs)

  assert.equal(c({ programName: 'NobleReach Scholars (dup)', officialUrl: 'https://www.noblereach.smapply.us/prog/february_2027_noblereach_scholars/?utm=x' })?.kind, 'high_confidence_duplicate')
  assert.equal(c({ programName: 'NobleReach Scholars', sponsor: 'NobleReach', programCycle: 'Feb 2027', officialUrl: 'https://example.org/other' })?.kind, 'high_confidence_duplicate')
  const fuzzy = c({ programName: 'NobleReach Scholar Program', sponsor: 'NobleReach', programCycle: 'August 2027', officialUrl: 'https://example.org/x' })
  assert.equal(fuzzy?.kind, 'manual_review')
  const sameHost = c({ programName: 'NobleReach Scholars', sponsor: 'NobleReach', programCycle: 'August 2027', officialUrl: 'https://noblereach.smapply.us/prog/august_2027_noblereach_scholars/' })
  assert.equal(sameHost?.kind, 'manual_review')
  assert.match(sameHost!.reason, /different cycle/)
  assert.equal(c({ programName: 'Totally New Quantum Fellowship', sponsor: 'Fake Institute', officialUrl: 'https://fake.example.edu/q', programCycle: '2027' }), null)
  // Dissimilar title, but same sponsor + host and a different cycle: the domain rule is what catches it.
  const domain = c({ programName: 'Summer Cohort', sponsor: 'NobleReach', programCycle: 'Summer 2027', officialUrl: 'https://noblereach.smapply.us/prog/summer_2027/' })
  assert.equal(domain?.kind, 'manual_review')
  assert.match(domain!.reason, /^same domain, different cycle/)
})

test('classify: unrelated programs on a shared host are not flagged; homepage URL matches only need review', () => {
  const refs = [makeRef(makeOpp({ programName: 'Chess Club Grant', sponsor: 'Student Affairs', officialUrl: 'https://umd.edu/', programCycle: '2026' }), 'a')]
  assert.equal(classify({ programName: 'Quantum Summer School', sponsor: 'Physics Dept', officialUrl: 'https://umd.edu/quantum', programCycle: '2027' }, refs), null)
  assert.equal(classify({ programName: 'Quantum Summer School', sponsor: 'Physics Dept', officialUrl: 'https://umd.edu', programCycle: '2027' }, refs)?.kind, 'manual_review')
})

// ---------- cross-engine merge ----------

const row = (_label: string, over: Record<string, unknown> = {}) =>
  '```json\n' +
  JSON.stringify([
    { program_name: 'Quantum Leap Fellowship', sponsor: 'Fake Institute', official_url: 'https://fake.edu/qlf', program_cycle: 'Summer 2027', deadline_date: '2027-01-15', funding_details: '$5,000 stipend', ...over },
  ]) +
  '\n```'

test('three engines describing one program merge into a single draft with provenance', () => {
  const cands = [
    ...parsePaste(row('p'), 'perplexity').candidates,
    ...parsePaste(row('g', { official_url: 'https://www.fake.edu/qlf/' }), 'chatgpt').candidates,
    ...parsePaste(row('c', { program_name: 'Quantum Leap Fellowship Program' }), 'claude').candidates,
  ]
  assert.equal(clusterCandidates(cands).length, 1)
  const [item] = buildReview({ candidates: cands, existing: [], profile: TEST_PROFILE, runId: 'r1', categoryId: 'research_program', today: TODAY })
  assert.equal(item!.outcome, 'new')
  assert.deepEqual(item!.engines.sort(), ['chatgpt', 'claude', 'perplexity'])
  assert.equal(item!.draft.deadline.date, '2027-01-15')
  assert.equal(item!.draft.claims.deadlineDate!.length, 1)
  assert.equal(item!.draft.sourceVerified, 'unverified')
  assert.equal(item!.draft.flags.filter((f) => f.kind === 'conflict').length, 0)
})

test('engines that disagree on the deadline raise a conflict; a 1-1 tie leaves the date unset', () => {
  const cands = [
    ...parsePaste(row('p'), 'perplexity').candidates,
    ...parsePaste(row('g', { deadline_date: '2027-01-19' }), 'chatgpt').candidates,
  ]
  const [item] = buildReview({ candidates: cands, existing: [], profile: TEST_PROFILE, runId: 'r1', categoryId: 'research_program', today: TODAY })
  assert.equal(item!.draft.deadline.date, undefined, 'never guess between two equally-supported deadlines')
  const conflict = item!.draft.flags.find((f) => f.code === 'conflict_deadlineDate')
  assert.ok(conflict)
  assert.match(conflict!.message, /2027-01-15 \(Perplexity\)/)
  assert.match(conflict!.message, /2027-01-19 \(ChatGPT\)/)
  assert.ok(codes(item!.draft.flags).includes('no_deadline'))

  const three = [...cands, ...parsePaste(row('c'), 'claude').candidates]
  const [maj] = buildReview({ candidates: three, existing: [], profile: TEST_PROFILE, runId: 'r1', categoryId: 'research_program', today: TODAY })
  assert.equal(maj!.draft.deadline.date, '2027-01-15', '2-vs-1 picks the majority but keeps the conflict visible')
  assert.ok(codes(maj!.draft.flags).includes('conflict_deadlineDate'))
})

test('funding amounts that disagree are flagged; different phrasing of the same amount is not', () => {
  const same = [
    ...parsePaste(row('p', { funding_details: 'Up to $5,000 stipend' }), 'perplexity').candidates,
    ...parsePaste(row('g', { funding_details: '$5,000 per summer' }), 'chatgpt').candidates,
  ]
  const [a] = buildReview({ candidates: same, existing: [], profile: TEST_PROFILE, runId: 'r', categoryId: 'research_program', today: TODAY })
  assert.ok(!codes(a!.draft.flags).includes('conflict_fundingAmounts'))
  const diff = [
    ...parsePaste(row('p', { funding_details: '$5,000 stipend' }), 'perplexity').candidates,
    ...parsePaste(row('g', { funding_details: '$8,000 stipend' }), 'chatgpt').candidates,
  ]
  const [b] = buildReview({ candidates: diff, existing: [], profile: TEST_PROFILE, runId: 'r', categoryId: 'research_program', today: TODAY })
  assert.ok(codes(b!.draft.flags).includes('conflict_fundingAmounts'))
})

test('a run re-finding a tracked program is a duplicate that reports where its deadline differs', () => {
  const cands = parsePaste(
    row('p', { program_name: 'NobleReach Scholars', sponsor: 'NobleReach', official_url: 'https://noblereach.smapply.us/prog/february_2027_noblereach_scholars/', program_cycle: 'February 2027', deadline_date: '2026-10-21' }),
    'perplexity',
  ).candidates
  const [item] = buildReview({ candidates: cands, existing: [NOBLEREACH], profile: TEST_PROFILE, runId: 'r', categoryId: 'public_interest_cohort', today: TODAY })
  assert.equal(item!.outcome, 'duplicate')
  assert.equal(item!.match!.id, NOBLEREACH.id)
  assert.deepEqual(item!.diffs, [{ field: 'deadline date', tracker: '2026-10-14', incoming: '2026-10-21' }])

  const attached = attachClaims(NOBLEREACH, item!.draft)
  assert.equal(attached.deadline.date, '2026-10-14', 'attaching never changes the tracker value')
  const flag = attached.flags.find((f) => f.code === 'conflict_deadlineDate')
  assert.match(flag!.message, /2026-10-14 \(Tracker\/manual\)/)
})

test('review orders new, review, duplicate, excluded and auto-excludes blocked leads', () => {
  const list = [
    { program_name: 'Gilman Scholarship', sponsor: 'US State Dept', official_url: 'https://gilman.example.gov' },
    { program_name: 'Good Fellowship', sponsor: 'Good Org', official_url: 'https://good.org/f' },
  ]
  const cands = parsePaste('```json\n' + JSON.stringify(list) + '\n```', 'claude').candidates
  const items = buildReview({ candidates: cands, existing: [], profile: TEST_PROFILE, runId: 'r', categoryId: 'study_abroad', today: TODAY })
  assert.deepEqual(items.map((i) => [i.draft.programName, i.outcome]), [['Good Fellowship', 'new'], ['Gilman Scholarship', 'excluded']])
})

// ---------- eligibility ----------

const elig = (over: Partial<Parameters<typeof evaluateEligibility>[0]>) =>
  evaluateEligibility({ programName: 'P', sponsor: 'S', officialUrl: 'https://p.org', eligibilitySummary: '', fundingDetails: '', notes: '', deadlineDate: '2027-01-01', ...over }, TEST_PROFILE, TODAY)

test('NobleReach: recent-graduates-only / current undergraduates not accepted is a blocking flag', () => {
  const flags = elig({
    programName: 'NobleReach Scholars',
    eligibilitySummary:
      "RECENT GRADUATES ONLY: bachelor's/master's/doctoral degree obtained Dec 2023-Dec 2026; min 3.2 GPA. Page states current undergraduates are NOT accepted.",
  })
  const f = flags.find((x) => x.code === 'degree_required')
  assert.equal(f?.severity, 'block')
  assert.match(f!.message, /2028-05/)
})

test('"current students and recent graduates" is only a warning; explicit exclusions still block', () => {
  assert.equal(elig({ eligibilitySummary: 'Open to current undergraduates and recent graduates.' }).find((f) => f.code === 'degree_required')?.severity, 'warn')
  assert.equal(elig({ eligibilitySummary: 'Open to recent graduates.' }).find((f) => f.code === 'degree_required')?.severity, 'block')
  assert.equal(elig({ eligibilitySummary: 'Undergraduates are not eligible.' }).find((f) => f.code === 'degree_required')?.severity, 'block')
  assert.equal(elig({ eligibilitySummary: 'Open to all undergraduate majors.' }).find((f) => f.code === 'degree_required'), undefined)
})

test('Pell / Gilman', () => {
  assert.equal(elig({ programName: 'Gilman Scholarship' }).find((f) => f.code === 'pell_restricted')?.severity, 'block')
  assert.equal(elig({ eligibilitySummary: 'Must be a Pell Grant recipient.' }).find((f) => f.code === 'pell_restricted')?.severity, 'block')
  assert.equal(elig({ eligibilitySummary: 'Pell-eligible students only.' }).find((f) => f.code === 'pell_restricted')?.severity, 'block')
  assert.equal(elig({ eligibilitySummary: 'No Pell requirement; merit-based.' }).find((f) => f.code === 'pell_restricted'), undefined)
  // One Pell-only sub-award inside a larger program is a warning, not a block (the UMD Education Abroad case).
  const sub = elig({ eligibilitySummary: 'Merit awards need a 3.0 GPA. Gilman Guarantee is Pell-only (n/a).' })
  assert.equal(sub.find((f) => f.code === 'pell_restricted'), undefined)
  assert.equal(sub.find((f) => f.code === 'pell_mention')?.severity, 'warn')
})

test('grad-only, class-year, need-based, fee, commercial, aggregator, clearance, deadline sanity', () => {
  assert.equal(elig({ eligibilitySummary: 'Graduate students only.' }).find((f) => f.code === 'grad_only')?.severity, 'block')
  assert.equal(elig({ eligibilitySummary: 'Rising seniors only.' }).find((f) => f.code === 'class_year')?.severity, 'warn')
  assert.equal(elig({ eligibilitySummary: 'FAFSA required; demonstrated need.' }).find((f) => f.code === 'need_based')?.severity, 'warn')
  assert.equal(elig({ notes: 'Program fee of $3,200 applies.' }).find((f) => f.code === 'fee_based')?.severity, 'warn')
  assert.equal(elig({ sponsor: 'WorldStrides' }).find((f) => f.code === 'commercial')?.severity, 'block')
  assert.equal(elig({ officialUrl: 'https://scholarships.af/opportunity/x' }).find((f) => f.code === 'aggregator')?.severity, 'block')
  assert.equal(elig({ eligibilitySummary: 'Requires U.S. citizenship and clearance eligibility.' }).find((f) => f.code === 'citizenship_required')?.severity, 'info')
  assert.ok(codes(elig({ deadlineDate: undefined })).includes('no_deadline'))
  assert.ok(codes(elig({ deadlineDate: '2026-01-01' })).includes('deadline_passed'))
  assert.ok(codes(elig({ officialUrl: '' })).includes('no_url'))
  assert.deepEqual(codes(elig({})), [])
})

// ---------- materials ----------

test('materialsFromText classifies items and counts recommenders', () => {
  const m = materialsFromText('Resume; unofficial transcripts; two recommendation letters; four short answer responses')
  assert.deepEqual(m.map((x) => x.kind), ['document', 'document', 'recommendation', 'essay'])
  assert.equal(m[2]!.count, 2)
  assert.equal(materialsFromText('CV, Transcript, Statement of purpose').length, 3)
  assert.deepEqual(materialsFromText(''), [])
})
