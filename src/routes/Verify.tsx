import { useMemo, useState } from 'react'
import type { Opportunity } from '../lib/types.ts'
import { verifyList } from '../lib/deadlines.ts'
import { findDuplicatePairs } from '../lib/duplicates.ts'
import type { DupPair } from '../lib/duplicates.ts'
import { api } from '../api.ts'
import { link } from '../router.ts'
import { useApp } from '../state.tsx'
import { Badge, DeadlineCell, VerifBadge } from '../components/ui.tsx'
import { VerifyCard } from '../components/VerifyCard.tsx'

function DuplicateRow({ o, other, onSkip, busy }: { o: Opportunity; other: Opportunity; onSkip: (o: Opportunity, other: Opportunity) => void; busy: boolean }) {
  return (
    <div className="stack small">
      <div>
        <a href={link('tracker', o.id)}>
          <strong>{o.programName}</strong>
        </a>
      </div>
      <div className="muted">{o.sponsor || 'no sponsor'}</div>
      <div>
        <span className="muted">Cycle:</span> {o.programCycle || '-'} <span className="muted">Where:</span> {o.location || '-'}
      </div>
      <div>
        <span className="muted">Deadline:</span> {o.deadline.date ?? '-'} <VerifBadge v={o.sourceVerified} />
      </div>
      <div style={{ overflowWrap: 'anywhere' }}>
        <span className="muted">URL:</span>{' '}
        {o.officialUrl ? (
          <a href={o.officialUrl} target="_blank" rel="noreferrer">
            {o.officialUrl}
          </a>
        ) : (
          '-'
        )}
      </div>
      <div>
        <button className="btn small" disabled={busy} onClick={() => onSkip(o, other)}>
          This is the extra one: mark skipped
        </button>
      </div>
    </div>
  )
}

function DuplicateSection({ pairs }: { pairs: DupPair[] }) {
  const { act } = useApp()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    await act(fn, ok)
    setBusy(false)
  }
  const notDuplicate = (p: DupPair) =>
    run(() => api.patchOpp(p.a.id, { notDuplicateOf: [...(p.a.notDuplicateOf ?? []), p.b.id] }), 'Marked as not a duplicate.')
  const skip = (o: Opportunity, other: Opportunity) =>
    run(
      () => api.patchOpp(o.id, { status: 'skipped', notes: `${o.notes}${o.notes ? '\n' : ''}Skipped as a duplicate of "${other.programName}" (${other.id}).` }),
      'Marked skipped. Change its status on the row if you skipped the wrong one.',
    )
  return (
    <>
      <div className="section-title">
        <h2>Possible duplicates ({pairs.length})</h2>
        <span className="muted small">
          A second check that weighs URL, name, sponsor, cycle year, deadline, funding and location together. Nothing is deleted: skipping just closes the extra row.
        </span>
      </div>
      {pairs.map((p) => (
        <div className="card" key={`${p.a.id}|${p.b.id}`}>
          <div className="row between">
            <span className="row">
              <Badge tone={p.level === 'likely' ? 'bad' : 'warn'}>{p.level} duplicate</Badge>
              <span className="muted small">score {p.score.toFixed(2)}</span>
            </span>
            <button className="btn small" disabled={busy} onClick={() => notDuplicate(p)}>
              Not a duplicate
            </button>
          </div>
          <div className="row" style={{ margin: '6px 0', flexWrap: 'wrap' }}>
            {p.signals.map((s) => (
              <Badge key={s.code} tone={s.weight < 0 ? 'muted' : 'info'} title={`${s.weight > 0 ? '+' : ''}${s.weight}`}>
                {s.label}
              </Badge>
            ))}
          </div>
          <div className="grid cols-2">
            <DuplicateRow o={p.a} other={p.b} onSkip={skip} busy={busy} />
            <DuplicateRow o={p.b} other={p.a} onSkip={skip} busy={busy} />
          </div>
        </div>
      ))}
    </>
  )
}

export function VerifyQueue() {
  const { opps, today, act } = useApp()
  const list = useMemo(() => verifyList(opps), [opps])
  const pairs = useMemo(() => findDuplicatePairs(opps), [opps])
  const isBlocked = (r: (typeof list)[number]) => r.reasons.some((x) => x.startsWith('ELIGIBILITY'))
  const work = list.filter((r) => !isBlocked(r))
  const blockedRows = list.filter(isBlocked)

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Verify queue</h1>
          <div className="muted">
            Every active row whose deadline is missing or not confirmed against the official page, has engines disagreeing, or has an eligibility blocker.
          </div>
        </div>
      </div>

      {pairs.length > 0 && <DuplicateSection pairs={pairs} />}

      {list.length === 0 && <div className="card empty">Everything is verified. Nothing to do.</div>}

      {pairs.length > 0 && list.length > 0 && (
        <div className="section-title">
          <h2>To verify ({list.length})</h2>
        </div>
      )}

      {work.map((r) => (
        <div className="card" key={r.opp.id}>
          <div className="row between">
            <div>
              <a href={link('tracker', r.opp.id)}>
                <strong>{r.opp.programName}</strong>
              </a>{' '}
              <span className="muted">{r.opp.programCycle}</span>
            </div>
            <DeadlineCell o={r.opp} today={today} />
          </div>
          <div className="row" style={{ margin: '6px 0' }}>
            {r.reasons.map((x) => (
              <Badge key={x} tone={x.includes('disagree') ? 'warn' : 'bad'}>
                {x.length > 90 ? x.slice(0, 90) + '...' : x}
              </Badge>
            ))}
          </div>
          <details>
            <summary>Check and confirm</summary>
            <div style={{ marginTop: 8 }}>
              <VerifyCard opp={r.opp} />
            </div>
          </details>
        </div>
      ))}

      {blockedRows.length > 0 && (
        <>
          <div className="section-title">
            <h2>Probably ineligible</h2>
            <span className="muted small">These have a blocking eligibility flag. Skip them, or open the row and dismiss the flag if it is wrong.</span>
          </div>
          {blockedRows.map((r) => (
            <div className="card" key={r.opp.id}>
              <div className="row between">
                <a href={link('tracker', r.opp.id)}>
                  <strong>{r.opp.programName}</strong>
                </a>
                <span className="row">
                  <DeadlineCell o={r.opp} today={today} />
                  <button className="btn small" onClick={() => act(() => api.patchOpp(r.opp.id, { status: 'skipped' }), 'Marked skipped.')}>
                    Mark skipped
                  </button>
                </span>
              </div>
              {r.reasons
                .filter((x) => x.startsWith('ELIGIBILITY'))
                .map((x) => (
                  <div key={x} className="flag block" style={{ marginTop: 6 }}>
                    {x.replace('ELIGIBILITY: ', '')}
                  </div>
                ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
