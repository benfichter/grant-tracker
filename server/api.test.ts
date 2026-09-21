import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import type { DraftFile, Opportunity, RunRecord } from '../src/lib/types.ts'

// The store reads DATA_DIR when it is first imported, so set it before the dynamic imports below.
let dir: string
let server: Server
let base: string
const realFetch = globalThis.fetch

const PAGE = `<html><head><title>Quantum Leap Fellowship</title></head><body><h1>Quantum Leap Fellowship</h1>
<p>Application deadline: January 15, 2027 at 11:59 PM ET.</p><p>Open to current undergraduates. ${'Filler sentence for length. '.repeat(20)}</p></body></html>`

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tracker-test-'))
  process.env.DATA_DIR = dir
  const { seed } = await import('./seed.ts')
  const { createApp } = await import('./index.ts')
  const origLog = console.log
  console.log = () => undefined
  await seed()
  console.log = origLog
  server = createApp().listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  // Serve a fake official page for outbound verification; everything else (our own API) is real.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.hostname === 'pages.test') {
      if (url.pathname === '/missing') return Promise.resolve(new Response('nope', { status: 404 }))
      return Promise.resolve(new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html' } }))
    }
    return realFetch(input, init)
  }) as typeof fetch
})

after(async () => {
  globalThis.fetch = realFetch
  await new Promise((r) => server.close(r))
  await rm(dir, { recursive: true, force: true })
})

async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T; text: string }> {
  const res = await realFetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    /* not json */
  }
  return { status: res.status, body: parsed as T, text }
}

const fence = (rows: unknown[]) => '```json\n' + JSON.stringify(rows) + '\n```'
const QLF = { program_name: 'Quantum Leap Fellowship', sponsor: 'Fake Institute', official_url: 'https://pages.test/qlf', program_cycle: 'Summer 2027', funding_details: '$5,000 stipend', eligibility_summary: 'Open to current undergraduates.', materials: 'Resume; two recommendation letters; one short answer essay' }
const NOBLE = { program_name: 'NobleReach Scholars', sponsor: 'NobleReach', official_url: 'https://noblereach.smapply.us/prog/february_2027_noblereach_scholars/', program_cycle: 'February 2027', deadline_date: '2026-10-21' }

let runId = ''
let qlfId = ''

test('seed data: both rows present, official, and NobleReach is auto-flagged as blocked', async () => {
  const { body } = await api<Opportunity[]>('GET', '/api/opportunities')
  assert.deepEqual(body.map((o) => o.id).sort(), ['noblereach-2027-02', 'umd-education-abroad-scholarship'])
  const noble = body.find((o) => o.id === 'noblereach-2027-02')!
  assert.equal(noble.deadline.date, '2026-10-14')
  assert.equal(noble.flags.find((f) => f.code === 'degree_required')?.severity, 'block')
  const umd = body.find((o) => o.id === 'umd-education-abroad-scholarship')!
  assert.equal(umd.deadline.date, '2026-09-30')
  assert.ok(!umd.flags.some((f) => f.severity === 'block'), 'UMD is not blocked by a Pell-only sub-award')
})

test('starting a run generates one prompt per engine that includes the tracked programs', async () => {
  const r = await api<RunRecord>('POST', '/api/searches/public_interest_cohort/runs')
  assert.equal(r.status, 201)
  runId = r.body.id
  assert.deepEqual(Object.keys(r.body.prompts).sort(), ['chatgpt', 'claude', 'gemini', 'perplexity'])
  assert.match(r.body.prompts.gemini!, /NobleReach Scholars \(February 2027\)/)
  assert.match(r.body.prompts.claude!, /NobleReach Scholars \(February 2027\)/)
  assert.equal((await api('POST', '/api/searches/nonsense/runs')).status, 404)
})

test('a run saved before an engine existed gets that engine\'s prompt on read', async () => {
  const file = path.join(dir, 'runs', `${runId}.json`)
  const saved = JSON.parse(await readFile(file, 'utf8')) as RunRecord
  delete saved.prompts.gemini
  await writeFile(file, JSON.stringify(saved))
  const r = await api<RunRecord>('GET', `/api/runs/${runId}`)
  assert.match(r.body.prompts.gemini!, /NobleReach Scholars \(February 2027\)/)
})

test('pasting three engines merges them, flags the deadline conflict and recognises the tracked program', async () => {
  const perplexity = fence([{ ...QLF, deadline_date: '2027-01-15' }, NOBLE])
  const chatgpt = fence([{ ...QLF, deadline_date: 'January 19, 2027' }])
  const claude = fence([{ ...QLF, program_name: 'Quantum Leap Fellowship Program', deadline_date: '2027-01-15' }])
  await api('POST', `/api/runs/${runId}/paste`, { engine: 'perplexity', text: perplexity })
  await api('POST', `/api/runs/${runId}/paste`, { engine: 'chatgpt', text: chatgpt })
  const r = await api<RunRecord>('POST', `/api/runs/${runId}/paste`, { engine: 'claude', text: claude })

  assert.equal(r.body.review.length, 2)
  const qlf = r.body.review.find((i) => i.draft.programName.startsWith('Quantum Leap'))!
  assert.equal(qlf.outcome, 'new')
  assert.deepEqual([...qlf.engines].sort(), ['chatgpt', 'claude', 'perplexity'])
  assert.equal(qlf.draft.deadline.date, '2027-01-15', '2 of 3 engines agree')
  assert.match(qlf.draft.flags.find((f) => f.code === 'conflict_deadlineDate')!.message, /2027-01-19 \(ChatGPT\)/)
  assert.equal(qlf.draft.sourceVerified, 'unverified')

  const noble = r.body.review.find((i) => i.draft.programName === 'NobleReach Scholars')!
  assert.equal(noble.outcome, 'duplicate')
  assert.deepEqual(noble.diffs, [{ field: 'deadline date', tracker: '2026-10-14', incoming: '2026-10-21' }])

  assert.equal((await api('POST', `/api/runs/${runId}/paste`, { engine: 'claude', text: '   ' })).status, 400)
  assert.equal((await api('POST', `/api/runs/${runId}/paste`, { engine: 'bard', text: 'x' })).status, 400)
  const bad = await api<RunRecord>('POST', `/api/runs/${runId}/paste`, { engine: 'chatgpt', text: 'Sorry, nothing found.' })
  assert.equal(bad.body.pastes.chatgpt!.format, 'none')
  await api('POST', `/api/runs/${runId}/paste`, { engine: 'chatgpt', text: chatgpt })
})

test('commit: adds the new program, attaches to the tracked one without changing it, refuses to add a duplicate', async () => {
  const run = (await api<RunRecord>('GET', `/api/runs/${runId}`)).body
  const qlf = run.review.find((i) => i.draft.programName.startsWith('Quantum Leap'))!
  const noble = run.review.find((i) => i.outcome === 'duplicate')!

  const refused = await api<{ errors: { error: string }[] }>('POST', `/api/runs/${runId}/commit`, { decisions: [{ key: noble.key, action: 'add' }] })
  assert.equal(refused.body.errors.length, 1)
  assert.match(refused.body.errors[0]!.error, /Already tracked/)

  const r = await api<{ added: string[]; attached: string[]; errors: unknown[]; run: RunRecord }>('POST', `/api/runs/${runId}/commit`, {
    decisions: [{ key: qlf.key, action: 'add' }, { key: noble.key, action: 'attach' }],
  })
  assert.equal(r.body.errors.length, 0)
  assert.equal(r.body.added.length, 1)
  qlfId = r.body.added[0]!
  assert.deepEqual(r.body.attached, ['noblereach-2027-02'])
  assert.equal(r.body.run.decisions[qlf.key]!.action, 'add')

  const opps = (await api<Opportunity[]>('GET', '/api/opportunities')).body
  const added = opps.find((o) => o.id === qlfId)!
  assert.equal(added.status, 'researching')
  assert.equal(added.sourceVerified, 'unverified')
  assert.equal(added.materials.find((m) => m.kind === 'recommendation')?.count, 2)
  const nb = opps.find((o) => o.id === 'noblereach-2027-02')!
  assert.equal(nb.deadline.date, '2026-10-14', 'attach never overwrites the tracker')
  assert.match(nb.flags.find((f) => f.code === 'conflict_deadlineDate')!.message, /2026-10-14 \(Tracker\/manual\) vs 2026-10-21 \(Perplexity\)/)
})

test('official is only reachable through confirm; editing an official deadline drops it back to unverified', async () => {
  const direct = await api('PATCH', `/api/opportunities/${qlfId}`, { sourceVerified: 'official' })
  assert.equal(direct.status, 400)

  const check = await api<{ ok: boolean; nameFound: boolean; deadlineMatch: string }>('POST', '/api/verify', { oppId: qlfId })
  assert.equal(check.body.ok, true)
  assert.equal(check.body.nameFound, true)
  assert.equal(check.body.deadlineMatch, 'exact')
  let opp = (await api<Opportunity[]>('GET', '/api/opportunities')).body.find((o) => o.id === qlfId)!
  assert.equal(opp.sourceVerified, 'unverified', 'a passing page check alone never verifies a row')
  assert.equal(opp.verification?.deadlineMatch, 'exact')

  const noUrl = await api('POST', '/api/opportunities', { programName: 'No Url Program' })
  assert.equal(noUrl.status, 201)
  const noUrlId = (noUrl.body as Opportunity).id
  assert.equal((await api('POST', `/api/opportunities/${noUrlId}/confirm`, {})).status, 400)

  const confirmed = await api<Opportunity>('POST', `/api/opportunities/${qlfId}/confirm`, { note: 'checked the page' })
  assert.equal(confirmed.body.sourceVerified, 'official')
  assert.ok(confirmed.body.verification?.confirmedAt)

  const edited = await api<{ opportunity: Opportunity; warnings: string[] }>('PATCH', `/api/opportunities/${qlfId}`, { deadline: { date: '2027-01-20' } })
  assert.equal(edited.body.opportunity.sourceVerified, 'unverified')
  assert.equal(edited.body.warnings.length, 1)
  await api('PATCH', `/api/opportunities/${qlfId}`, { deadline: { date: '2027-01-15' } })
  const again = await api<Opportunity>('POST', `/api/opportunities/${qlfId}/confirm`, {})
  assert.equal(again.body.sourceVerified, 'official')
  opp = again.body
  assert.equal(opp.deadline.date, '2027-01-15')
})

test('page check reports failures and refuses local addresses', async () => {
  const missing = await api<{ ok: boolean; httpStatus: number; error: string }>('POST', '/api/verify', { url: 'https://pages.test/missing', programName: 'X' })
  assert.equal(missing.body.ok, false)
  assert.equal(missing.body.httpStatus, 404)
  for (const u of ['http://localhost:5174/api/opportunities', 'http://127.0.0.1/', 'http://192.168.1.1/', 'http://10.0.0.5/', 'file:///etc/passwd']) {
    assert.equal((await api('POST', '/api/verify', { url: u, programName: 'X' })).status, 400, u)
  }
})

test('calendar: official + unblocked rows only', async () => {
  const r = await api('GET', '/api/calendar.ics')
  assert.equal(r.status, 200)
  assert.ok(r.text.includes(`UID:${qlfId}@`))
  assert.ok(!r.text.includes('UID:noblereach-2027-02@'), 'blocked (recent-graduates-only) rows are left out')
  assert.ok(r.text.includes('UID:umd-education-abroad-scholarship@'))
  assert.ok(!r.text.includes('No Url Program'))
})

test('drafts: versions accumulate and the audit catches unsupported claims', async () => {
  const opp = (await api<Opportunity[]>('GET', '/api/opportunities')).body.find((o) => o.id === qlfId)!
  const essay = opp.materials.find((m) => m.kind === 'essay')!
  await api('PATCH', `/api/opportunities/${qlfId}`, { materials: opp.materials.map((m) => (m.id === essay.id ? { ...m, wordLimit: 20, prompt: 'Why do you want this fellowship?' } : m)) })

  const v1 = await api<DraftFile>('POST', `/api/drafts/${qlfId}/${essay.id}`, { text: 'As a first-generation student I led 200 volunteers and I want this fellowship because it fits my research.', source: 'claude' })
  assert.equal(v1.status, 201)
  assert.equal(v1.body.versions.length, 1)
  const a1 = v1.body.versions[0]!.audit
  assert.equal(a1.checks.find((c) => c.code === 'claims')!.status, 'fail')
  assert.equal(a1.checks.find((c) => c.code === 'figures')!.status, 'warn')
  assert.equal(a1.checks.find((c) => c.code === 'length')!.status, 'pass')

  const v2 = await api<DraftFile>('POST', `/api/drafts/${qlfId}/${essay.id}`, { text: 'I want this fellowship because it fits my research in number theory and quantum algorithms.', source: 'me' })
  assert.equal(v2.body.versions.length, 2)
  assert.equal(v2.body.versions[1]!.audit.checks.find((c) => c.code === 'claims')!.status, 'pass')
  assert.equal(v2.body.versions[0]!.text.startsWith('As a first'), true, 'earlier versions are kept')
  assert.equal((await api('POST', `/api/drafts/${qlfId}/${essay.id}`, { text: '' })).status, 400)
  assert.equal((await api('POST', `/api/drafts/${qlfId}/nope`, { text: 'x' })).status, 404)
})

test('ids cannot escape the data directory', async () => {
  assert.equal((await api('GET', '/api/runs/..%2F..%2Fprofile')).status, 400)
  assert.equal((await api('GET', '/api/drafts/..%2Fx')).status, 400)
  assert.equal((await api('DELETE', '/api/opportunities/does-not-exist')).status, 404)
})

test('commit re-checks the live tracker: a lead that became a duplicate after its run was reviewed is refused, and add-all adds the rest', async () => {
  const ZETA = { program_name: 'Zeta Prize Fellowship', sponsor: 'Zeta Foundation', official_url: 'https://pages.test/zeta', program_cycle: 'Summer 2027', deadline_date: '2027-02-01', eligibility_summary: 'Open to current undergraduates.' }
  const OMEGA = { program_name: 'Omega Robotics Award', sponsor: 'Omega Labs', official_url: 'https://pages.test/omega', program_cycle: 'Fall 2027', deadline_date: '2027-03-15', eligibility_summary: 'Open to current undergraduates.' }
  const runA = (await api<RunRecord>('POST', '/api/searches/competition/runs')).body
  const runB = (await api<RunRecord>('POST', '/api/searches/competition/runs')).body
  const a = (await api<RunRecord>('POST', `/api/runs/${runA.id}/paste`, { engine: 'perplexity', text: fence([ZETA, OMEGA]) })).body
  const b = (await api<RunRecord>('POST', `/api/runs/${runB.id}/paste`, { engine: 'gemini', text: fence([ZETA]) })).body
  assert.deepEqual(a.review.map((i) => i.outcome), ['new', 'new'])
  assert.deepEqual(b.review.map((i) => i.outcome), ['new'])
  assert.deepEqual(b.review[0]!.engines, ['gemini'])

  const first = await api<{ added: string[]; errors: unknown[] }>('POST', `/api/runs/${runB.id}/commit`, { decisions: [{ key: b.review[0]!.key, action: 'add' }] })
  assert.equal(first.body.added.length, 1)

  // "Add all" for the first run: Zeta is now already tracked, Omega is genuinely new.
  const all = await api<{ added: string[]; errors: { key: string; error: string }[]; run: RunRecord }>('POST', `/api/runs/${runA.id}/commit`, {
    decisions: a.review.map((i) => ({ key: i.key, action: 'add' })),
  })
  assert.equal(all.body.added.length, 1)
  assert.equal(all.body.errors.length, 1)
  assert.match(all.body.errors[0]!.error, /duplicate of "Zeta Prize Fellowship" \(.*same official page/)
  assert.equal(Object.keys(all.body.run.decisions).length, 1, 'a refused lead is not recorded as decided')

  const opps = (await api<Opportunity[]>('GET', '/api/opportunities')).body
  assert.equal(opps.filter((o) => o.programName === 'Zeta Prize Fellowship').length, 1)
  const omega = opps.find((o) => o.programName === 'Omega Robotics Award')!
  assert.equal(omega.sourceVerified, 'unverified', 'add-all never makes anything official')

  // "Not a duplicate" is stored on the row so the Verify screen stops re-flagging the pair.
  const patched = await api<{ opportunity: Opportunity }>('PATCH', `/api/opportunities/${omega.id}`, { notDuplicateOf: ['zeta-prize-fellowship-2027'] })
  assert.deepEqual(patched.body.opportunity.notDuplicateOf, ['zeta-prize-fellowship-2027'])
})
