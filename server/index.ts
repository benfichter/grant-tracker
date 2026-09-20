import express from 'express'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { access } from 'node:fs/promises'
import path from 'node:path'
import type { CategoryId, DraftFile, Engine, Material, Opportunity, PageVerification, Profile, ReviewItem, RunRecord } from '../src/lib/types.ts'
import { CATEGORIES, categoryById } from '../src/lib/categories.ts'
import { parsePaste } from '../src/lib/parse.ts'
import { buildReview } from '../src/lib/review.ts'
import { attachClaims, finalizeDraft, materialsFromText } from '../src/lib/merge.ts'
import { classify, makeRef } from '../src/lib/dedupe.ts'
import { refreshFlags } from '../src/lib/flags.ts'
import { buildDiscoveryPrompt } from '../src/lib/prompts.ts'
import { buildIcs } from '../src/lib/deadlines.ts'
import { auditDraft } from '../src/lib/audit.ts'
import { duplicateKey, makeId, normalizeUrl } from '../src/lib/normalize.ts'
import { todayIso } from '../src/lib/dates.ts'
import { DATA_DIR, HttpError, listJson, readJson, safeId, update, writeJson } from './store.ts'
import { checkPage } from './verify.ts'
import { seed } from './seed.ts'

const ENGINES = ['perplexity', 'chatgpt', 'claude'] as const
type RunEngine = (typeof ENGINES)[number]
const isRunEngine = (e: unknown): e is RunEngine => (ENGINES as readonly unknown[]).includes(e)

const OPPS = 'opportunities.json'
const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => {
  fn(req, res).catch(next)
}

const param = (req: Request, name: string): string => {
  const v = req.params[name]
  return safeId(Array.isArray(v) ? v[0]! : String(v))
}

async function getProfile(): Promise<Profile> {
  const p = await readJson<Profile | null>('profile.json', null)
  if (!p) throw new HttpError(409, 'No profile yet. Run `npm run seed`.')
  return p
}
const getOpps = () => readJson<Opportunity[]>(OPPS, [])
async function getRun(id: string): Promise<RunRecord> {
  const run = await readJson<RunRecord | null>(`runs/${id}.json`, null)
  if (!run) throw new HttpError(404, `No such run: ${id}`)
  return run
}

// ---------- opportunity patching (shared by PATCH, manual add and run commit) ----------

const TEXT_PATCH = ['programName', 'sponsor', 'officialUrl', 'programCycle', 'location', 'eligibilitySummary', 'materialsText', 'travelComponent', 'notes'] as const
const PLAIN_PATCH = ['category', 'materials', 'fit', 'fitOverride', 'effort', 'status', 'flags'] as const
const VERIFICATIONS = ['secondary', 'recurring_estimate', 'unverified']

export function applyPatch(o: Opportunity, patch: Record<string, unknown>, profile: Profile, today: string): { opp: Opportunity; warnings: string[] } {
  const warnings: string[] = []
  const next: Opportunity = { ...o, deadline: { ...o.deadline }, funding: { ...o.funding } }
  const rec = next as unknown as Record<string, unknown>

  if ('sourceVerified' in patch) {
    if (patch.sourceVerified === 'official') throw new HttpError(400, 'A row only becomes official through POST /api/opportunities/:id/confirm.')
    if (!VERIFICATIONS.includes(String(patch.sourceVerified))) throw new HttpError(400, `Invalid sourceVerified: ${String(patch.sourceVerified)}`)
    next.sourceVerified = patch.sourceVerified as Opportunity['sourceVerified']
  }
  for (const k of TEXT_PATCH) if (typeof patch[k] === 'string') rec[k] = (patch[k] as string).trim()
  for (const k of PLAIN_PATCH) if (k in patch) rec[k] = patch[k] === null ? undefined : patch[k]
  if (typeof patch.materialsText === 'string' && !('materials' in patch)) {
    // Keep completed-state for materials that survive the re-split.
    const done = new Map(o.materials.map((m) => [m.id, m]))
    next.materials = materialsFromText(next.materialsText).map((m) => ({ ...m, ...(done.get(m.id) ? { done: done.get(m.id)!.done, wordLimit: done.get(m.id)!.wordLimit, charLimit: done.get(m.id)!.charLimit, prompt: done.get(m.id)!.prompt } : {}) }))
  }
  if (patch.deadline && typeof patch.deadline === 'object') {
    const d = patch.deadline as Record<string, unknown>
    for (const k of ['date', 'time', 'timezone'] as const) if (k in d) next.deadline[k] = d[k] ? String(d[k]) : undefined
    if (next.deadline.date && !/^\d{4}-\d{2}-\d{2}$/.test(next.deadline.date)) throw new HttpError(400, 'deadline.date must be YYYY-MM-DD')
    if (next.deadline.time && !/^\d{2}:\d{2}$/.test(next.deadline.time)) throw new HttpError(400, 'deadline.time must be HH:MM')
  }
  if (patch.funding && typeof patch.funding === 'object') {
    const f = patch.funding as Record<string, unknown>
    if (typeof f.type === 'string') next.funding.type = f.type
    if (typeof f.details === 'string') next.funding.details = f.details
  }

  // Editing anything the verification vouched for takes the row back to unverified.
  const changedKey =
    o.deadline.date !== next.deadline.date ||
    o.deadline.time !== next.deadline.time ||
    o.deadline.timezone !== next.deadline.timezone ||
    normalizeUrl(o.officialUrl) !== normalizeUrl(next.officialUrl)
  if (o.sourceVerified === 'official' && changedKey) {
    next.sourceVerified = 'unverified'
    if (next.verification) next.verification = { ...next.verification, confirmedAt: undefined }
    warnings.push('You changed the deadline or URL of an official row, so it is back to unverified. Re-check the page and confirm again.')
  }

  next.duplicateKey = duplicateKey(next.sponsor, next.programName, next.programCycle)
  next.flags = refreshFlags(next, profile, today)
  return { opp: next, warnings }
}

const newOpp = (over: Partial<Opportunity>): Opportunity => ({
  id: '',
  programName: '',
  sponsor: '',
  officialUrl: '',
  programCycle: '',
  category: 'other',
  location: '',
  deadline: {},
  funding: { type: '', details: '' },
  eligibilitySummary: '',
  materials: [],
  materialsText: '',
  travelComponent: '',
  notes: '',
  sourceVerified: 'unverified',
  status: 'researching',
  duplicateKey: '',
  claims: {},
  flags: [],
  ...over,
})

// ---------- runs ----------

function rebuildRun(run: RunRecord, opps: Opportunity[], profile: Profile): RunRecord {
  const candidates = ENGINES.flatMap((e) => {
    const p = run.pastes[e]
    return p ? parsePaste(p.text, e).candidates : []
  })
  const invalidRows = ENGINES.reduce((n, e) => n + (run.pastes[e] ? parsePaste(run.pastes[e]!.text, e).invalidRows : 0), 0)
  const review = buildReview({ candidates, existing: opps, profile, runId: run.id, categoryId: run.categoryId, today: todayIso() })
  return { ...run, review, invalidRows }
}

const auditKnownText = (profile: Profile, opp: Opportunity, material: Material) =>
  [profile.summary, ...profile.snippets.map((s) => s.text), material.prompt ?? '', opp.programName, opp.sponsor, opp.funding.details, opp.eligibilitySummary].join('\n')

export function createApp() {
  const app = express()
  app.use(express.json({ limit: '10mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, dataDir: DATA_DIR, today: todayIso() })
  })

  // ----- profile -----
  app.get('/api/profile', h(async (_req, res) => void res.json(await getProfile())))
  app.put('/api/profile', h(async (req, res) => {
    const p = req.body as Profile
    if (!p || typeof p.summary !== 'string' || !p.facts || !Array.isArray(p.snippets)) throw new HttpError(400, 'Profile needs summary, facts and snippets.')
    await writeJson('profile.json', p)
    // Eligibility flags depend on the profile, so refresh them everywhere.
    await update<Opportunity[], void>(OPPS, [], (opps) => ({ next: opps.map((o) => ({ ...o, flags: refreshFlags(o, p, todayIso()) })), result: undefined }))
    res.json(p)
  }))

  // ----- opportunities -----
  app.get('/api/opportunities', h(async (_req, res) => void res.json(await getOpps())))

  app.post('/api/opportunities', h(async (req, res) => {
    const body = req.body as Record<string, unknown>
    if (typeof body.programName !== 'string' || !body.programName.trim()) throw new HttpError(400, 'programName is required.')
    const profile = await getProfile()
    const out = await update<Opportunity[], Opportunity>(OPPS, [], (opps) => {
      const probe = newOpp({ programName: body.programName as string, sponsor: String(body.sponsor ?? ''), officialUrl: String(body.officialUrl ?? ''), programCycle: String(body.programCycle ?? '') })
      const dup = classify(probe, opps.map((o) => makeRef(o, o.id)))
      if (dup?.kind === 'high_confidence_duplicate' && !body.force) throw new HttpError(409, `Already tracked as "${dup.ref.subject.programName}" (${dup.reason}).`)
      const base = newOpp({ origin: { engines: ['manual'], addedAt: new Date().toISOString(), via: 'manual' } })
      const { opp } = applyPatch(base, { ...body, force: undefined }, profile, todayIso())
      const final = finalizeDraft(opp, new Set(opps.map((o) => o.id)))
      return { next: [...opps, final], result: final }
    })
    res.status(201).json(out)
  }))

  app.patch('/api/opportunities/:id', h(async (req, res) => {
    const id = param(req, 'id')
    const profile = await getProfile()
    const out = await update<Opportunity[], { opportunity: Opportunity; warnings: string[] }>(OPPS, [], (opps) => {
      const i = opps.findIndex((o) => o.id === id)
      if (i < 0) throw new HttpError(404, `No such opportunity: ${id}`)
      const { opp, warnings } = applyPatch(opps[i]!, req.body ?? {}, profile, todayIso())
      const next = [...opps]
      next[i] = opp
      return { next, result: { opportunity: opp, warnings } }
    })
    res.json(out)
  }))

  app.delete('/api/opportunities/:id', h(async (req, res) => {
    const id = param(req, 'id')
    await update<Opportunity[], void>(OPPS, [], (opps) => {
      if (!opps.some((o) => o.id === id)) throw new HttpError(404, `No such opportunity: ${id}`)
      return { next: opps.filter((o) => o.id !== id), result: undefined }
    })
    res.status(204).end()
  }))

  // The only way a row becomes official: an explicit human confirmation.
  app.post('/api/opportunities/:id/confirm', h(async (req, res) => {
    const id = param(req, 'id')
    const profile = await getProfile()
    const out = await update<Opportunity[], Opportunity>(OPPS, [], (opps) => {
      const i = opps.findIndex((o) => o.id === id)
      if (i < 0) throw new HttpError(404, `No such opportunity: ${id}`)
      const { opp } = applyPatch(opps[i]!, { deadline: req.body?.deadline, officialUrl: req.body?.officialUrl }, profile, todayIso())
      if (!opp.officialUrl) throw new HttpError(400, 'Cannot confirm a row that has no official URL.')
      const now = new Date().toISOString()
      const confirmed: Opportunity = {
        ...opp,
        sourceVerified: 'official',
        lastChecked: todayIso(),
        status: opp.status === 'candidate' ? 'researching' : opp.status,
        verification: {
          ...(opp.verification ?? { checkedAt: now, url: opp.officialUrl, ok: false, nameFound: false, deadlineMatch: 'not_checked' as const, dates: [] }),
          confirmedAt: now,
        },
        notes: req.body?.note ? [opp.notes, `Confirmed ${todayIso()}: ${String(req.body.note)}`].filter(Boolean).join('; ') : opp.notes,
      }
      const next = [...opps]
      next[i] = confirmed
      return { next, result: confirmed }
    })
    res.json(out)
  }))

  // ----- page check (reports only) -----
  app.post('/api/verify', h(async (req, res) => {
    const { oppId } = req.body as { oppId?: string }
    const opps = await getOpps()
    const opp = oppId ? opps.find((o) => o.id === safeId(oppId)) : undefined
    if (oppId && !opp) throw new HttpError(404, `No such opportunity: ${oppId}`)
    const url = String(req.body.url ?? opp?.officialUrl ?? '')
    if (!url) throw new HttpError(400, 'No URL to check.')
    const result: PageVerification = await checkPage({
      url,
      programName: String(req.body.programName ?? opp?.programName ?? ''),
      deadlineDate: (req.body.deadlineDate as string | undefined) ?? opp?.deadline.date,
    })
    if (opp) {
      await update<Opportunity[], void>(OPPS, [], (all) => ({
        next: all.map((o) => (o.id === opp.id ? { ...o, lastChecked: todayIso(), verification: { ...result, confirmedAt: o.verification?.url === result.url ? o.verification.confirmedAt : undefined } } : o)),
        result: undefined,
      }))
    }
    res.json(result)
  }))

  // ----- searches and runs -----
  app.get('/api/searches', h(async (_req, res) => {
    const runs = await Promise.all((await listJson('runs')).map((id) => readJson<RunRecord | null>(`runs/${id}.json`, null)))
    res.json({
      categories: CATEGORIES,
      runs: runs
        .filter((r): r is RunRecord => !!r)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r) => ({ id: r.id, categoryId: r.categoryId, createdAt: r.createdAt, engines: Object.keys(r.pastes), items: r.review.length, decided: Object.keys(r.decisions).length })),
    })
  }))

  app.post('/api/searches/:categoryId/runs', h(async (req, res) => {
    const cat = categoryById(param(req, 'categoryId'))
    if (!cat) throw new HttpError(404, 'Unknown category.')
    const [profile, opps] = await Promise.all([getProfile(), getOpps()])
    const today = todayIso()
    const prompts = Object.fromEntries(ENGINES.map((engine) => [engine, buildDiscoveryPrompt({ category: cat, profile, opportunities: opps, engine, today })])) as RunRecord['prompts']
    const run: RunRecord = { id: `run-${Date.now().toString(36)}`, categoryId: cat.id as CategoryId, createdAt: new Date().toISOString(), prompts, pastes: {}, review: [], invalidRows: 0, decisions: {} }
    await writeJson(`runs/${run.id}.json`, run)
    res.status(201).json(run)
  }))

  app.get('/api/runs/:id', h(async (req, res) => void res.json(await getRun(param(req, 'id')))))

  app.post('/api/runs/:id/paste', h(async (req, res) => {
    const id = param(req, 'id')
    const { engine, text } = req.body as { engine?: string; text?: string }
    if (!isRunEngine(engine)) throw new HttpError(400, 'engine must be perplexity, chatgpt or claude.')
    if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'Paste some text first.')
    const [profile, opps] = await Promise.all([getProfile(), getOpps()])
    const out = await update<RunRecord | null, RunRecord>(`runs/${id}.json`, null, (run) => {
      if (!run) throw new HttpError(404, `No such run: ${id}`)
      const parsed = parsePaste(text, engine)
      const withPaste: RunRecord = { ...run, pastes: { ...run.pastes, [engine]: { text, pastedAt: new Date().toISOString(), format: parsed.format, rowCount: parsed.candidates.length, errors: parsed.errors } } }
      const rebuilt = rebuildRun(withPaste, opps, profile)
      return { next: rebuilt, result: rebuilt }
    })
    res.json(out)
  }))

  app.delete('/api/runs/:id/paste/:engine', h(async (req, res) => {
    const id = param(req, 'id')
    const engine = param(req, 'engine')
    if (!isRunEngine(engine)) throw new HttpError(400, 'Unknown engine.')
    const [profile, opps] = await Promise.all([getProfile(), getOpps()])
    const out = await update<RunRecord | null, RunRecord>(`runs/${id}.json`, null, (run) => {
      if (!run) throw new HttpError(404, `No such run: ${id}`)
      const pastes = { ...run.pastes }
      delete pastes[engine]
      const rebuilt = rebuildRun({ ...run, pastes }, opps, profile)
      return { next: rebuilt, result: rebuilt }
    })
    res.json(out)
  }))

  interface Decision { key: string; action: 'add' | 'attach' | 'skip'; matchId?: string; edits?: Record<string, unknown> }
  app.post('/api/runs/:id/commit', h(async (req, res) => {
    const id = param(req, 'id')
    const decisions = (req.body?.decisions ?? []) as Decision[]
    if (!Array.isArray(decisions) || !decisions.length) throw new HttpError(400, 'No decisions to commit.')
    const profile = await getProfile()
    const run = await getRun(id)
    const byKey = new Map<string, ReviewItem>(run.review.map((it) => [it.key, it]))
    const errors: { key: string; error: string }[] = []
    const added: string[] = []
    const attached: string[] = []
    const applied: RunRecord['decisions'] = {}
    const at = new Date().toISOString()

    await update<Opportunity[], void>(OPPS, [], (opps) => {
      let list = [...opps]
      for (const d of decisions) {
        const item = byKey.get(d.key)
        if (!item) { errors.push({ key: d.key, error: 'No such review item (paste changed?).' }); continue }
        if (d.action === 'skip') { applied[d.key] = { action: 'skip', at }; continue }
        if (d.action === 'add') {
          if (item.outcome === 'duplicate') { errors.push({ key: d.key, error: `Already tracked as "${item.match?.programName}". Attach the new claims instead.` }); continue }
          const { opp } = applyPatch(item.draft, { ...(d.edits ?? {}), status: 'researching' }, profile, todayIso())
          const final = finalizeDraft({ ...opp, id: '' }, new Set(list.map((o) => o.id)))
          list = [...list, final]
          added.push(final.id)
          applied[d.key] = { action: 'add', at, oppId: final.id }
        } else if (d.action === 'attach') {
          const targetId = d.matchId ?? item.match?.id
          const i = list.findIndex((o) => o.id === targetId)
          if (i < 0) { errors.push({ key: d.key, error: 'No tracker row to attach to.' }); continue }
          list[i] = attachClaims(list[i]!, item.draft)
          attached.push(list[i]!.id)
          applied[d.key] = { action: 'attach', at, oppId: list[i]!.id }
        } else errors.push({ key: d.key, error: `Unknown action: ${String(d.action)}` })
      }
      return { next: list, result: undefined }
    })
    const saved = await update<RunRecord | null, RunRecord>(`runs/${id}.json`, null, (cur) => {
      const r = cur ?? run
      const next = { ...r, decisions: { ...r.decisions, ...applied } }
      return { next, result: next }
    })
    res.json({ added, attached, errors, run: saved })
  }))

  // ----- drafts -----
  app.get('/api/drafts/:oppId', h(async (req, res) => {
    const oppId = param(req, 'oppId')
    const ids = await listJson(`drafts/${oppId}`)
    const files = await Promise.all(ids.map((m) => readJson<DraftFile | null>(`drafts/${oppId}/${m}.json`, null)))
    res.json(files.filter(Boolean))
  }))

  app.get('/api/drafts/:oppId/:materialId', h(async (req, res) => {
    const [oppId, materialId] = [param(req, 'oppId'), param(req, 'materialId')]
    res.json(await readJson<DraftFile>(`drafts/${oppId}/${materialId}.json`, { oppId, materialId, versions: [] }))
  }))

  app.post('/api/drafts/:oppId/:materialId', h(async (req, res) => {
    const [oppId, materialId] = [param(req, 'oppId'), param(req, 'materialId')]
    const { text, source, note } = req.body as { text?: string; source?: string; note?: string }
    if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'Draft text is empty.')
    const src = (['perplexity', 'chatgpt', 'claude', 'me'] as const).find((s) => s === source) ?? 'me'
    const [profile, opps] = await Promise.all([getProfile(), getOpps()])
    const opp = opps.find((o) => o.id === oppId)
    const material = opp?.materials.find((m) => m.id === materialId)
    if (!opp || !material) throw new HttpError(404, 'No such opportunity or material.')

    // Other applications' latest drafts, to spot reused text.
    const others: { label: string; text: string }[] = []
    for (const o of opps) {
      for (const m of o.materials) {
        if (o.id === oppId && m.id === materialId) continue
        const f = await readJson<DraftFile | null>(`drafts/${o.id}/${m.id}.json`, null)
        const last = f?.versions.at(-1)
        if (last) others.push({ label: `${o.programName}: ${m.label}`, text: last.text })
      }
    }
    const audit = auditDraft(text, { material, knownText: auditKnownText(profile, opp, material), pellEligible: profile.facts.pellEligible, others })
    const out = await update<DraftFile, DraftFile>(`drafts/${oppId}/${materialId}.json`, { oppId, materialId, versions: [] }, (file) => {
      const next: DraftFile = { ...file, versions: [...file.versions, { n: file.versions.length + 1, createdAt: new Date().toISOString(), source: src, text, note: note || undefined, audit }] }
      return { next, result: next }
    })
    res.status(201).json(out)
  }))

  // ----- calendar -----
  app.get('/api/calendar.ics', h(async (_req, res) => {
    const { ics } = buildIcs(await getOpps(), todayIso())
    res.setHeader('content-type', 'text/calendar; charset=utf-8')
    res.setHeader('content-disposition', 'attachment; filename="application-calendar.ics"')
    res.send(ics)
  }))

  app.use('/api', (_req, res) => void res.status(404).json({ error: 'Not found' }))
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { status?: number; type?: string; message?: string }
    const status = e.status ?? (e.type === 'entity.parse.failed' ? 400 : 500)
    if (status >= 500) console.error(err)
    res.status(status).json({ error: e.message ?? 'Server error' })
  })
  return app
}

export async function start(port = Number(process.env.PORT ?? 5174)) {
  const exists = await access(path.join(DATA_DIR, OPPS)).then(() => true, () => false)
  if (!exists) {
    console.log('No data yet: seeding from tracker.csv and profile/profile.md')
    await seed()
  }
  // Loopback only: there is no auth and this server writes files.
  return createApp().listen(port, '127.0.0.1', () => console.log(`api listening on http://127.0.0.1:${port}  (data: ${DATA_DIR})`))
}

if (import.meta.main) void start()
