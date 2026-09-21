import { useMemo, useState } from 'react'
import type { CategoryId, Effort, FitInputs, Opportunity, Status } from '../lib/types.ts'
import { CATEGORIES } from '../lib/categories.ts'
import { verifyList } from '../lib/deadlines.ts'
import { FIT_LABELS, effectiveFit, fitScore } from '../lib/fit.ts'
import { api } from '../api.ts'
import { go, link } from '../router.ts'
import { useApp } from '../state.tsx'
import { Badge, Claims, DeadlineCell, Field, Flags, VerifBadge, blocked } from '../components/ui.tsx'
import { VerifyCard } from '../components/VerifyCard.tsx'

const STATUSES: Status[] = ['candidate', 'researching', 'preparing', 'submitted', 'accepted', 'rejected', 'skipped']
const CAT_LABEL = Object.fromEntries([...CATEGORIES.map((c) => [c.id, c.label]), ['other', 'Other']]) as Record<string, string>
const VERIF_ORDER = ['unverified', 'recurring_estimate', 'secondary', 'official']

interface SortDef {
  label: string
  /** The value to order by; rows where this is undefined always sort last, whichever direction is chosen. */
  val: (o: Opportunity) => string | number | undefined
  /** The direction that makes sense first for this column. */
  first: 'asc' | 'desc'
}
const SORTS = {
  deadline: { label: 'Deadline (soonest first)', val: (o) => o.deadline.date, first: 'asc' },
  fit: { label: 'Fit score', val: (o) => effectiveFit(o), first: 'desc' },
  name: { label: 'Name', val: (o) => o.programName.toLowerCase(), first: 'asc' },
  status: { label: 'Status', val: (o) => STATUSES.indexOf(o.status), first: 'asc' },
  verification: { label: 'Verification (least verified first)', val: (o) => VERIF_ORDER.indexOf(o.sourceVerified), first: 'asc' },
  added: { label: 'Date added', val: (o) => o.origin?.addedAt, first: 'desc' },
  category: { label: 'Category', val: (o) => CAT_LABEL[o.category], first: 'asc' },
} satisfies Record<string, SortDef>
type SortKey = keyof typeof SORTS

// ---------------------------------------------------------------- list

export function TrackerList() {
  const { opps, today } = useApp()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('active')
  const [cat, setCat] = useState('')
  const [ver, setVer] = useState('')
  const [sort, setSort] = useState<SortKey>('deadline')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')
  const [view, setView] = useState<'all' | 'verify'>('all')
  const [adding, setAdding] = useState(false)

  const needVerify = useMemo(() => new Set(verifyList(opps).map((r) => r.opp.id)), [opps])
  const pickSort = (k: SortKey) => {
    // Clicking the active column flips its direction; a different one starts in its natural direction.
    if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(k)
      setDir(SORTS[k].first)
    }
  }

  const rows = useMemo(() => {
    const closed = new Set(['submitted', 'accepted', 'rejected', 'skipped'])
    const list = opps.filter((o) => {
      if (status === 'active' ? closed.has(o.status) : status && o.status !== status) return false
      if (cat && o.category !== cat) return false
      if (ver && o.sourceVerified !== ver) return false
      if (view === 'verify' && !needVerify.has(o.id)) return false
      if (q && !`${o.programName} ${o.sponsor} ${o.notes}`.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
    const sign = dir === 'asc' ? 1 : -1
    const val = SORTS[sort].val
    return [...list].sort((a, b) => {
      const x = val(a)
      const y = val(b)
      if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return sign * c || a.programName.localeCompare(b.programName)
    })
  }, [opps, q, status, cat, ver, sort, dir, view, needVerify])

  const th = (label: string, k: SortKey) => (
    <th className="sortable" onClick={() => pickSort(k)}>
      {label} {sort === k ? (dir === 'asc' ? '▴' : '▾') : ''}
    </th>
  )

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Tracker</h1>
          <div className="muted">{rows.length} of {opps.length} rows</div>
        </div>
        <button className="btn" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : 'Add by hand'}
        </button>
      </div>
      {adding && <AddByHand onDone={() => setAdding(false)} />}

      <div className="row" style={{ marginBottom: 10 }}>
        <button className={`btn ${view === 'all' ? 'primary' : ''}`} onClick={() => setView('all')}>
          All rows
        </button>
        <button className={`btn ${view === 'verify' ? 'primary' : ''}`} onClick={() => setView('verify')}>
          Needs verification ({needVerify.size})
        </button>
        <a className="small" href={link('verify')}>
          Open the Verify queue
        </a>
      </div>

      <div className="card flat">
        <div className="fields">
          <Field label="Search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name, sponsor, notes" />
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active (not closed)</option>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">All</option>
              {Object.entries(CAT_LABEL).map(([id, l]) => (
                <option key={id} value={id}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sort by">
            <span className="row">
              <select value={sort} onChange={(e) => pickSort(e.target.value as SortKey)}>
                {(Object.keys(SORTS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORTS[k].label}
                  </option>
                ))}
              </select>
              <button className="btn small" title="Reverse the order" onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))}>
                {dir === 'asc' ? '▴ asc' : '▾ desc'}
              </button>
            </span>
          </Field>
          <Field label="Verification">
            <select value={ver} onChange={(e) => setVer(e.target.value)}>
              <option value="">All</option>
              {['official', 'secondary', 'recurring_estimate', 'unverified'].map((v) => (
                <option key={v} value={v}>
                  {v.replace('_', ' ')}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="card scroll-x" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty">No rows match. Run a search from the Search tab, or add one by hand.</div>
        ) : (
          <table>
            <thead>
              <tr>
                {th('Program', 'name')}
                {th('Category', 'category')}
                {th('Deadline', 'deadline')}
                {th('Fit', 'fit')}
                {th('Source', 'verification')}
                {th('Status', 'status')}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const conflict = o.flags.some((f) => f.kind === 'conflict' && f.severity !== 'info' && !f.dismissed)
                return (
                  <tr key={o.id} className="click" onClick={() => go('tracker', o.id)}>
                    <td>
                      <strong>{o.programName}</strong> <span className="muted">{o.programCycle}</span>
                      <div className="muted small">{o.sponsor}</div>
                      <div className="row" style={{ gap: 4 }}>
                        {blocked(o) && <Badge tone="bad">blocker</Badge>}
                        {conflict && <Badge tone="warn">engines disagree</Badge>}
                      </div>
                    </td>
                    <td className="small">{CAT_LABEL[o.category]}</td>
                    <td>
                      <DeadlineCell o={o} today={today} />
                    </td>
                    <td>{effectiveFit(o) ?? <span className="muted">-</span>}</td>
                    <td>
                      <VerifBadge v={o.sourceVerified} />
                    </td>
                    <td>{o.status}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function AddByHand({ onDone }: { onDone: () => void }) {
  const { act } = useApp()
  const [f, setF] = useState({ programName: '', sponsor: '', officialUrl: '', programCycle: '', category: 'other' as CategoryId, date: '' })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  return (
    <div className="card">
      <div className="fields">
        <Field label="Program name" wide>
          <input value={f.programName} onChange={set('programName')} />
        </Field>
        <Field label="Sponsor">
          <input value={f.sponsor} onChange={set('sponsor')} />
        </Field>
        <Field label="Official URL">
          <input value={f.officialUrl} onChange={set('officialUrl')} />
        </Field>
        <Field label="Cycle">
          <input value={f.programCycle} onChange={set('programCycle')} placeholder="Summer 2027" />
        </Field>
        <Field label="Category">
          <select value={f.category} onChange={set('category')}>
            {Object.entries(CAT_LABEL).map(([id, l]) => (
              <option key={id} value={id}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Deadline date (if you have the official date)">
          <input type="date" value={f.date} onChange={set('date')} />
        </Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <button
          className="btn primary"
          disabled={!f.programName.trim()}
          onClick={async () => {
            const r = await act(() => api.addOpp({ programName: f.programName, sponsor: f.sponsor, officialUrl: f.officialUrl, programCycle: f.programCycle, category: f.category, deadline: f.date ? { date: f.date } : undefined }), 'Added (unverified).')
            if (r) {
              onDone()
              go('tracker', r.id)
            }
          }}
        >
          Add
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- detail

export function TrackerDetail({ id }: { id: string }) {
  const { opps } = useApp()
  const opp = opps.find((o) => o.id === id)
  if (!opp) {
    return (
      <div className="card empty">
        No such row. <a href={link('tracker')}>Back to the tracker</a>
      </div>
    )
  }
  // Re-key on the saved values so the form refreshes after a save but survives a page check.
  const sig = JSON.stringify([opp.programName, opp.sponsor, opp.officialUrl, opp.programCycle, opp.category, opp.location, opp.deadline, opp.funding, opp.eligibilitySummary, opp.materialsText, opp.travelComponent, opp.notes, opp.status, opp.effort, opp.fit, opp.fitOverride])
  return <DetailForm key={opp.id + sig} opp={opp} />
}

const FIT_KEYS = Object.keys(FIT_LABELS) as (keyof FitInputs)[]

function DetailForm({ opp }: { opp: Opportunity }) {
  const { act, today, toast, reload } = useApp()
  const [f, setF] = useState({
    programName: opp.programName,
    sponsor: opp.sponsor,
    programCycle: opp.programCycle,
    category: opp.category,
    location: opp.location,
    fundingType: opp.funding.type,
    fundingDetails: opp.funding.details,
    eligibilitySummary: opp.eligibilitySummary,
    materialsText: opp.materialsText,
    travelComponent: opp.travelComponent,
    notes: opp.notes,
    status: opp.status,
    effort: opp.effort ?? '',
    fitOverride: opp.fitOverride?.toString() ?? '',
  })
  const [fit, setFit] = useState<Partial<FitInputs>>(opp.fit ?? {})
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const fitComplete = FIT_KEYS.every((k) => typeof fit[k] === 'number')
  const computed = fitComplete ? fitScore(fit as FitInputs) : undefined

  const save = async () => {
    const body: Record<string, unknown> = {
      programName: f.programName,
      sponsor: f.sponsor,
      programCycle: f.programCycle,
      category: f.category,
      location: f.location,
      funding: { type: f.fundingType, details: f.fundingDetails },
      eligibilitySummary: f.eligibilitySummary,
      materialsText: f.materialsText,
      travelComponent: f.travelComponent,
      notes: f.notes,
      status: f.status,
      fitOverride: f.fitOverride === '' ? null : Number(f.fitOverride),
    }
    if (f.effort) body.effort = f.effort as Effort
    if (fitComplete) body.fit = fit
    const r = await act(() => api.patchOpp(opp.id, body), 'Saved.')
    r?.warnings.forEach((w) => toast(w))
  }
  const toggleFlag = (code: string) =>
    act(() => api.patchOpp(opp.id, { flags: opp.flags.map((x) => (x.code === code ? { ...x, dismissed: !x.dismissed } : x)) }))

  return (
    <div>
      <div className="page-head">
        <div>
          <a href={link('tracker')} className="small">
            Back to tracker
          </a>
          <h1>{opp.programName}</h1>
          <div className="row">
            <VerifBadge v={opp.sourceVerified} />
            <span className="muted">{opp.sponsor}</span>
            <DeadlineCell o={opp} today={today} />
          </div>
        </div>
        <div className="row">
          <a className="btn" href={link('drafts', opp.id)}>
            Materials and drafts
          </a>
          <button className="btn primary" onClick={save}>
            Save changes
          </button>
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm(`Delete "${opp.programName}" from the tracker?`)) return
              try {
                await api.deleteOpp(opp.id)
                await reload()
                go('tracker')
              } catch (e) {
                toast((e as Error).message)
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {opp.flags.length > 0 && (
        <div className="card">
          <h2>Flags</h2>
          <Flags flags={opp.flags} onToggle={toggleFlag} />
          <div className="muted small" style={{ marginTop: 6 }}>
            Dismissing a flag means you have looked and it does not apply. It stops counting toward blockers and the calendar filter.
          </div>
        </div>
      )}

      <div className="card">
        <h2>Verify against the official page</h2>
        <VerifyCard opp={opp} />
      </div>

      <div className="card">
        <h2>Details</h2>
        <div className="fields">
          <Field label="Program name" wide>
            <input value={f.programName} onChange={set('programName')} />
          </Field>
          <Field label="Sponsor">
            <input value={f.sponsor} onChange={set('sponsor')} />
          </Field>
          <Field label="Cycle">
            <input value={f.programCycle} onChange={set('programCycle')} />
          </Field>
          <Field label="Category">
            <select value={f.category} onChange={set('category')}>
              {Object.entries(CAT_LABEL).map(([id, l]) => (
                <option key={id} value={id}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location">
            <input value={f.location} onChange={set('location')} />
          </Field>
          <Field label="Status">
            <select value={f.status} onChange={set('status')}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Effort">
            <select value={f.effort} onChange={set('effort')}>
              <option value="">-</option>
              <option>low</option>
              <option>medium</option>
              <option>high</option>
            </select>
          </Field>
          <Field label="Funding type">
            <input value={f.fundingType} onChange={set('fundingType')} />
          </Field>
          <Field label="Funding details" wide>
            <textarea rows={2} value={f.fundingDetails} onChange={set('fundingDetails')} />
          </Field>
          <Field label="Eligibility summary (the rules that flag blockers read this)" wide>
            <textarea rows={3} value={f.eligibilitySummary} onChange={set('eligibilitySummary')} />
          </Field>
          <Field label="Materials (separate with semicolons)" wide>
            <textarea rows={2} value={f.materialsText} onChange={set('materialsText')} />
          </Field>
          <Field label="Travel component" wide>
            <textarea rows={2} value={f.travelComponent} onChange={set('travelComponent')} />
          </Field>
          <Field label="Notes" wide>
            <textarea rows={3} value={f.notes} onChange={set('notes')} />
          </Field>
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>
          Deadline and URL are edited in the verification box above, so a change there is always re-checked.
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <h2>Fit score</h2>
          <span>
            {computed !== undefined ? <Badge tone="info">computed {computed}/100</Badge> : <span className="muted small">rate all five to compute</span>}
          </span>
        </div>
        <div className="fields">
          {FIT_KEYS.map((k) => (
            <Field key={k} label={`${FIT_LABELS[k]} (1-5)`}>
              <select value={fit[k] ?? ''} onChange={(e) => setFit((s) => ({ ...s, [k]: e.target.value ? Number(e.target.value) : undefined }))}>
                <option value="">-</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
          ))}
          <Field label="Manual override (0-100)">
            <input type="number" min={0} max={100} value={f.fitOverride} onChange={set('fitOverride')} />
          </Field>
        </div>
        <div className="muted small">Weights: funding 30, academic fit 25, travel value 20, selectivity-adjusted chance 15, network 10. An override wins over the computed value.</div>
      </div>

      <div className="card">
        <h2>Where each value came from</h2>
        <Claims claims={opp.claims} />
      </div>
    </div>
  )
}
