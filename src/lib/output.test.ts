import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIcs, deadlineGroups, fold, verifyList } from './deadlines.ts'
import { htmlToText, scanPage } from './pageScan.ts'
import { auditDraft, extractRequirements } from './audit.ts'
import { buildDiscoveryPrompt, buildDraftPrompt } from './prompts.ts'
import { CATEGORIES } from './categories.ts'
import { NOBLEREACH, TEST_PROFILE, makeOpp } from './fixtures.ts'

const TODAY = '2026-09-20'
const NOW = new Date('2026-09-20T21:00:00Z')

// ---------- deadlines ----------

test('deadline groups split by urgency and ignore closed rows', () => {
  const opps = [
    makeOpp({ id: 'a', deadline: { date: '2026-09-25' } }),
    makeOpp({ id: 'b', deadline: { date: '2026-09-30' } }),
    makeOpp({ id: 'c', deadline: { date: '2026-10-14' } }),
    makeOpp({ id: 'd', deadline: { date: '2027-03-01' } }),
    makeOpp({ id: 'e', deadline: { date: '2026-09-10' } }),
    makeOpp({ id: 'f', deadline: { date: '2026-09-22' }, status: 'submitted' }),
    makeOpp({ id: 'g', deadline: {} }),
  ]
  const g = deadlineGroups(opps, TODAY)
  assert.deepEqual(g.urgent.map((e) => e.opp.id), ['a'])
  assert.deepEqual(g.soon.map((e) => e.opp.id), ['b'])
  assert.deepEqual(g.upcoming.map((e) => e.opp.id), ['c'])
  assert.deepEqual(g.past.map((e) => e.opp.id), ['e'])
})

test('verify list: missing deadline, unverified source, open conflicts and blocking flags', () => {
  const opps = [
    makeOpp({ id: 'ok' }),
    makeOpp({ id: 'nodate', deadline: {} }),
    makeOpp({ id: 'sec', sourceVerified: 'secondary' }),
    makeOpp({ id: 'conf', flags: [{ code: 'conflict_deadlineDate', kind: 'conflict', severity: 'warn', message: 'Deadline disagreement' }] }),
    makeOpp({ id: 'blocked', flags: [{ code: 'degree_required', kind: 'eligibility', severity: 'block', message: 'Needs degree' }] }),
    makeOpp({ id: 'dismissed', flags: [{ code: 'degree_required', kind: 'eligibility', severity: 'block', message: 'Needs degree', dismissed: true }] }),
  ]
  const v = verifyList(opps)
  assert.deepEqual(v.map((x) => x.opp.id), ['nodate', 'sec', 'conf', 'blocked'])
  assert.match(v[3]!.reasons[0]!, /^ELIGIBILITY/)
})

test('ICS only includes verified-official, unblocked, active, future rows, with the right alarms', () => {
  const opps = [
    NOBLEREACH,
    makeOpp({ id: 'unverified', sourceVerified: 'unverified', deadline: { date: '2026-12-01' } }),
    makeOpp({ id: 'secondary', sourceVerified: 'secondary', deadline: { date: '2026-12-01' } }),
    makeOpp({ id: 'estimate', sourceVerified: 'recurring_estimate', deadline: { date: '2026-12-01' } }),
    makeOpp({ id: 'past', deadline: { date: '2026-09-01' } }),
    makeOpp({ id: 'done', deadline: { date: '2026-12-02' }, status: 'submitted' }),
    makeOpp({ id: 'blocked', deadline: { date: '2026-12-03' }, flags: [{ code: 'degree_required', kind: 'eligibility', severity: 'block', message: 'x' }] }),
    makeOpp({ id: 'far', programName: 'Far, Future; Program', deadline: { date: '2026-12-01' } }),
    makeOpp({ id: 'nodate', deadline: {} }),
  ]
  const { ics, count } = buildIcs(opps, TODAY, NOW)
  assert.equal(count, 2)
  assert.ok(ics.includes('UID:noblereach-2027-02@'))
  assert.ok(ics.includes('UID:far@'))
  for (const id of ['unverified', 'secondary', 'estimate', 'past', 'done', 'blocked', 'nodate']) assert.ok(!ics.includes(`UID:${id}@`), id)
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
  assert.ok(ics.includes('SUMMARY:DEADLINE: Far\\, Future\\; Program'))

  const events = ics.split('BEGIN:VEVENT').slice(1)
  const noble = events.find((e) => e.includes('noblereach'))!
  assert.ok(noble.includes('DTSTART:20261015T035900Z'), '23:59 EDT is 03:59Z the next day')
  // 24 days out: the 28-day alarm is already past, so 21/14/7/3/1 remain.
  assert.deepEqual([...noble.matchAll(/TRIGGER:-P(\d+)D/g)].map((m) => +m[1]!), [21, 14, 7, 3, 1])
  const far = events.find((e) => e.includes('UID:far@'))!
  assert.ok(far.includes('DTSTART;VALUE=DATE:20261201'))
  assert.deepEqual([...far.matchAll(/TRIGGER:-P(\d+)D/g)].map((m) => +m[1]!), [28, 21, 14, 7, 3, 1])
})

test('ICS lines are folded at 75 octets', () => {
  const long = 'DESCRIPTION:' + 'é'.repeat(80)
  for (const line of fold(long).split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75)
  assert.equal(fold(long).split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join(''), long)
})

// ---------- page scan ----------

const PAGE = `<html><head><title>NobleReach Scholars February 2027</title><style>.x{}</style></head><body>
<script>var d="Oct 1 2026"</script>
<h1>NobleReach Scholars</h1><p>Application opens September 9, 2026.</p>
<p>Application deadline: Oct 14 2026 11:59 PM (EDT)</p><p>Current undergraduates: not accepted &amp; more</p></body></html>`

test('scanPage finds the program name and the stated deadline, ignoring scripts', () => {
  const s = scanPage(PAGE, { programName: 'NobleReach Scholars', deadlineDate: '2026-10-14' })
  assert.equal(s.title, 'NobleReach Scholars February 2027')
  assert.equal(s.nameFound, true)
  assert.equal(s.deadlineMatch, 'exact')
  assert.deepEqual(s.dates.map((d) => d.iso), ['2026-10-14', '2026-09-09'], 'deadline-keyword dates sort first; script dates are dropped')
  assert.match(s.dates[0]!.snippet, /Application deadline/)
})

test('scanPage: partial match without a year, and no match', () => {
  const noYear = '<p>Applications close October 14.</p>'
  assert.equal(scanPage(noYear, { programName: 'X Prog', deadlineDate: '2026-10-14' }).deadlineMatch, 'partial')
  assert.equal(scanPage(PAGE, { programName: 'NobleReach Scholars', deadlineDate: '2026-11-30' }).deadlineMatch, 'none')
  assert.equal(scanPage(PAGE, { programName: 'NobleReach Scholars' }).deadlineMatch, 'not_checked')
  assert.equal(scanPage(PAGE, { programName: 'Completely Different Thing' }).nameFound, false)
  assert.ok(htmlToText('<p>a&nbsp;&amp;&#39;b</p>').includes("a &'b"))
})

// ---------- audit ----------

const KNOWN = TEST_PROFILE.summary + ' Write about why you want this and how it fits.'

test('audit: word limit over / near / under', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ')
  const status = (n: number) => auditDraft(words(n), { material: { wordLimit: 100 }, knownText: KNOWN, pellEligible: false }).checks.find((c) => c.code === 'length')!.status
  assert.equal(status(101), 'fail')
  assert.equal(status(97), 'warn')
  assert.equal(status(80), 'pass')
})

test('audit: prompt coverage flags an unanswered part', () => {
  const prompt = 'Why do you want to join this cohort? Describe a public-service project and its impact on your community.'
  assert.equal(extractRequirements(prompt).length, 2)
  const draft = 'I want to join this cohort because cryptography protects ordinary people, and I have wanted to work on that since my first number theory course.'
  const c = auditDraft(draft, { material: { prompt }, knownText: KNOWN, pellEligible: false }).checks.find((x) => x.code === 'coverage')!
  assert.equal(c.status, 'warn')
  assert.match(c.detail, /public-service project/)
  const full = draft + ' As a public-service project I led a nonprofit; its impact on our community reached students.'
  assert.equal(auditDraft(full, { material: { prompt }, knownText: KNOWN, pellEligible: false }).checks.find((x) => x.code === 'coverage')!.status, 'pass')
})

test('audit: unsupported claims, figures, placeholders and reuse', () => {
  const bad = 'As a first-generation, low-income Pell recipient and graduate student I led 200 volunteers and raised $12,000 [NEED: exact amount].'
  const r = auditDraft(bad, { knownText: KNOWN, pellEligible: false })
  const by = (code: string) => r.checks.find((c) => c.code === code)!
  assert.equal(by('claims').status, 'fail')
  assert.match(by('claims').detail, /Pell.*first-generation.*financial hardship.*graduate standing/)
  assert.equal(by('figures').status, 'warn')
  assert.match(by('figures').detail, /200/)
  assert.match(by('figures').detail, /12000/)
  assert.equal(by('placeholders').status, 'fail')

  const good = 'I led a 45-person STEM nonprofit serving 1,600+ students while keeping a 3.9 GPA.'
  const g = auditDraft(good, { knownText: KNOWN, pellEligible: false })
  assert.equal(g.checks.find((c) => c.code === 'figures')!.status, 'pass', '45, 1,600 and 3.9 all come from the profile')
  assert.equal(g.checks.find((c) => c.code === 'claims')!.status, 'pass')

  const shared = 'I built a small research group around number theory and taught it to first year students every single week last spring semester.'
  const reuse = auditDraft(shared, { knownText: KNOWN, pellEligible: false, others: [{ label: 'Other app', text: shared + ' Extra.' }] }).checks.find((c) => c.code === 'reuse')
  assert.equal(reuse?.status, 'warn')
})

// ---------- prompts ----------

test('discovery prompt carries the profile, hard rules, tracked programs and the JSON contract', () => {
  const p = buildDiscoveryPrompt({ category: CATEGORIES[2]!, profile: TEST_PROFILE, opportunities: [NOBLEREACH], engine: 'perplexity', today: TODAY })
  for (const s of ['Today is 2026-09-20', 'CURRENT U.S. undergraduate', 'NOT Pell-eligible', 'NEVER guess', 'NobleReach Scholars (February 2027)', '"deadline_evidence"', '```json', 'Labs']) {
    assert.ok(p.includes(s), `missing: ${s}`)
  }
})

test('draft prompt includes the verbatim question, limit, snippets and the no-invention rules', () => {
  const p = buildDraftPrompt({
    opportunity: NOBLEREACH,
    material: { id: 'sa2', label: 'Short answer 2', kind: 'essay', required: true, done: false, wordLimit: 250, prompt: 'Why now?' },
    profile: TEST_PROFILE,
    snippets: [{ id: 's', title: 'Leadership', tags: [], text: 'I led a nonprofit.' }],
    today: TODAY,
  })
  for (const s of ['"""\nWhy now?\n"""', 'Hard limit: 250 words', '### Leadership', '[NEED:', 'first-generation']) assert.ok(p.includes(s), `missing: ${s}`)
})
