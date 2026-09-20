// One-time, idempotent import of tracker.csv and profile/profile.md into data/*.json.
// Existing rows in data/opportunities.json and an existing data/profile.json are never overwritten.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { CategoryId, Opportunity, Profile, Status, Verification } from '../src/lib/types.ts'
import { parseCsv } from '../src/lib/parse.ts'
import { duplicateKey } from '../src/lib/normalize.ts'
import { materialsFromText } from '../src/lib/merge.ts'
import { refreshFlags } from '../src/lib/flags.ts'
import { todayIso } from '../src/lib/dates.ts'
import { ROOT, readJson, writeJson } from './store.ts'

const STATUSES: Status[] = ['candidate', 'researching', 'preparing', 'submitted', 'accepted', 'rejected', 'skipped']
const VERIFICATIONS: Verification[] = ['official', 'secondary', 'recurring_estimate', 'unverified']
const CATEGORY_MAP: Record<string, CategoryId> = {
  cohort: 'public_interest_cohort',
  study_abroad: 'study_abroad',
  research: 'research_program',
  travel_grant: 'conference_travel',
  summer_school: 'summer_school',
  competition: 'competition',
}

export function defaultProfile(summary: string): Profile {
  return {
    summary,
    facts: {
      citizenship: 'US',
      pellEligible: false,
      standing: 'undergraduate',
      graduation: '2028-05',
      gradCourseworkFrom: '2027',
      classNote: 'Graduating May 2028, so likely a junior in AY2026-27 and a senior in AY2027-28 (edit if that is wrong).',
    },
    goals: [
      'Funded travel',
      'Study abroad',
      'Research placements',
      'Conference travel grants',
      'Selective cohorts: public-interest tech, cybersecurity, AI, quantum, math',
    ],
    snippets: [
      { id: 'bio', title: 'Who I am', tags: ['bio'], text: 'UMD mathematics major graduating May 2028, with a 3.9 GPA, University Honors, and National Merit Scholar.' },
      { id: 'research', title: 'Research', tags: ['research'], text: 'Research in analytic number theory, combinatorics, and quantum algorithms; NSF-funded MathQuantum fellow.' },
      { id: 'grad', title: 'Graduate coursework', tags: ['academics'], text: 'Starting graduate-level coursework at UMD in 2027 while still an undergraduate.' },
      { id: 'technical', title: 'Technical background', tags: ['technical'], text: 'Lockheed Martin software engineering internship. Technical background: embedded systems, Verilog, Python, C++, Kubernetes/Docker/Istio.' },
      { id: 'leadership', title: 'Leadership', tags: ['leadership'], text: 'Led a 45-person STEM nonprofit serving 1,600+ students.' },
    ],
  }
}

export async function seed() {
  const today = todayIso()

  // ---- profile ----
  const existingProfile = await readJson<Profile | null>('profile.json', null)
  let profile = existingProfile
  if (!profile) {
    const md = await readFile(path.join(ROOT, 'profile', 'profile.md'), 'utf8')
    profile = defaultProfile(md.replace(/^##\s*Context\s*/i, '').trim())
    await writeJson('profile.json', profile)
    console.log('profile.json created')
  } else console.log('profile.json already exists, left alone')

  // ---- opportunities ----
  const existing = await readJson<Opportunity[]>('opportunities.json', [])
  const have = new Set(existing.map((o) => o.id))
  const csv = parseCsv(await readFile(path.join(ROOT, 'tracker.csv'), 'utf8'))
  const header = csv[0] ?? []
  const added: Opportunity[] = []
  for (const cells of csv.slice(1)) {
    const r = Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]))
    if (!r.program_name || !r.opportunity_id || have.has(r.opportunity_id)) continue
    const sourceVerified = (VERIFICATIONS as string[]).includes(r.source_verified) ? (r.source_verified as Verification) : 'unverified'
    const opp: Opportunity = {
      id: r.opportunity_id,
      programName: r.program_name,
      sponsor: r.sponsor ?? '',
      officialUrl: r.official_url ?? '',
      programCycle: r.program_cycle ?? '',
      category: CATEGORY_MAP[r.category ?? ''] ?? 'other',
      location: r.country_or_location ?? '',
      deadline: { date: r.deadline_date || undefined, time: r.deadline_time || undefined, timezone: r.deadline_timezone || undefined },
      funding: { type: r.funding_type ?? '', details: r.funding_details ?? '' },
      eligibilitySummary: r.eligibility_summary ?? '',
      materials: materialsFromText(r.materials ?? ''),
      materialsText: r.materials ?? '',
      travelComponent: r.travel_component ?? '',
      notes: r.notes ?? '',
      fitOverride: r.fit_score_100 ? Number(r.fit_score_100) : undefined,
      sourceVerified,
      status: (STATUSES as string[]).includes(r.status ?? '') ? (r.status as Status) : 'researching',
      duplicateKey: duplicateKey(r.sponsor ?? '', r.program_name, r.program_cycle ?? ''),
      claims: {},
      flags: [],
      lastChecked: r.last_checked || undefined,
      origin: { engines: ['manual'], addedAt: new Date().toISOString(), via: 'seed' },
    }
    // Rows the CSV marked official were confirmed against the official page before migration.
    if (sourceVerified === 'official' && opp.officialUrl) {
      opp.verification = {
        checkedAt: `${r.last_checked || today}T00:00:00.000Z`,
        url: opp.officialUrl,
        ok: true,
        nameFound: true,
        deadlineMatch: opp.deadline.date ? 'exact' : 'not_checked',
        dates: [],
        confirmedAt: `${r.last_checked || today}T00:00:00.000Z`,
      }
    }
    opp.flags = refreshFlags(opp, profile, today)
    added.push(opp)
  }
  await writeJson('opportunities.json', [...existing, ...added])
  console.log(`opportunities.json: ${added.length} added, ${existing.length} already present`)
  for (const o of added) {
    console.log(`  ${o.id}  ${o.deadline.date ?? 'no deadline'}  ${o.sourceVerified}  flags: ${o.flags.filter((f) => !f.dismissed).map((f) => `${f.severity}:${f.code}`).join(', ') || 'none'}`)
  }
}

if (import.meta.main) {
  seed().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
