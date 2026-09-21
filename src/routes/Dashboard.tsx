import { useMemo } from 'react'
import { buildIcs, deadlineGroups, isActive, verifyList } from '../lib/deadlines.ts'
import type { DeadlineEntry } from '../lib/deadlines.ts'
import { link } from '../router.ts'
import { useApp } from '../state.tsx'
import { Badge, DeadlineCell, VerifBadge, blocked } from '../components/ui.tsx'

function DeadlineList({ entries, empty }: { entries: DeadlineEntry[]; empty: string }) {
  const { today } = useApp()
  if (!entries.length) return <div className="muted small">{empty}</div>
  return (
    <table>
      <tbody>
        {entries.map((e) => (
          <tr key={e.opp.id}>
            <td>
              <a href={link('tracker', e.opp.id)}>{e.opp.programName}</a>
              {blocked(e.opp) && (
                <>
                  {' '}
                  <Badge tone="bad">eligibility blocker</Badge>
                </>
              )}
            </td>
            <td>
              <DeadlineCell o={e.opp} today={today} />
            </td>
            <td>
              <VerifBadge v={e.opp.sourceVerified} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Dashboard() {
  const { opps, today } = useApp()
  const g = useMemo(() => deadlineGroups(opps, today), [opps, today])
  const verify = useMemo(() => verifyList(opps), [opps])
  const ics = useMemo(() => buildIcs(opps, today).count, [opps, today])
  const active = opps.filter(isActive)
  const conflicts = active.filter((o) => o.flags.some((f) => f.kind === 'conflict' && f.severity !== 'info' && !f.dismissed))
  const blockedRows = active.filter(blocked)
  const next = [...g.urgent, ...g.soon, ...g.upcoming][0]

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="muted">Today is {today}. {active.length} active opportunities tracked.</div>
        </div>
        <a className="btn" href="/api/calendar.ics">
          Download calendar (.ics)
        </a>
      </div>

      <div className="grid cols-4">
        <div className="card">
          <div className="muted small">Next deadline</div>
          <div className="stat">{next ? `${next.days}d` : 'none'}</div>
          <div className="small">{next ? next.opp.programName : 'Nothing in the next 45 days'}</div>
        </div>
        <a className="card" href={link('verify')} style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="muted small">Needs verification</div>
          <div className="stat">{verify.length}</div>
          <div className="small">rows with an unconfirmed deadline, open conflict or blocker</div>
        </a>
        <div className="card">
          <div className="muted small">Engine conflicts</div>
          <div className="stat">{conflicts.length}</div>
          <div className="small">Search engines disagree</div>
        </div>
        <div className="card">
          <div className="muted small">Eligibility blockers</div>
          <div className="stat">{blockedRows.length}</div>
          <div className="small">tracked but probably ineligible</div>
        </div>
      </div>

      <div className="section-title">
        <h2>Urgent: within 7 days</h2>
      </div>
      <div className="card">
        <DeadlineList entries={g.urgent} empty="Nothing due this week." />
      </div>
      <div className="section-title">
        <h2>Soon: 8 to 21 days</h2>
      </div>
      <div className="card">
        <DeadlineList entries={g.soon} empty="Nothing in this window." />
      </div>
      <div className="section-title">
        <h2>Upcoming: 22 to 45 days</h2>
      </div>
      <div className="card">
        <DeadlineList entries={g.upcoming} empty="Nothing in this window." />
      </div>
      {g.past.length > 0 && (
        <>
          <div className="section-title">
            <h2>Past deadline, still open</h2>
          </div>
          <div className="card">
            <DeadlineList entries={g.past} empty="" />
          </div>
        </>
      )}

      <p className="muted small">
        The calendar file has {ics} event{ics === 1 ? '' : 's'} with reminders at 28, 21, 14, 7, 3 and 1 days. Only rows verified as official and with no
        unresolved eligibility blocker are included.
      </p>
    </div>
  )
}
